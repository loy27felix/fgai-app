"""On-demand, actor-isolated ArcReel provisioning on the FG host."""
import hashlib
import hmac
import ipaddress
import json
import pathlib
import re
import subprocess

ROOT=pathlib.Path('/Users/server/work/fg-six-yingce')
D='/usr/local/bin/docker'
env={}
for line in (ROOT/'.env').read_text().splitlines():
    if '=' in line and not line.startswith('#'):
        key,value=line.split('=',1);env[key]=value
nas=pathlib.Path(env['NAS_MEDIA_PATH'])
assert (nas/'.fg-studio-nas-ready').read_text().strip()=='fg-studio-media:v1'

def run(*args,optional=False):
    try: result=subprocess.run([D,*args],capture_output=True,text=True,timeout=45)
    except subprocess.TimeoutExpired:
        if optional:return None
        raise RuntimeError('ArcReel provisioning timed out; private arguments omitted') from None
    if result.returncode and not optional:raise RuntimeError('ArcReel provisioning failed; private arguments omitted')
    return result.stdout.strip() if result.returncode==0 else None

users=json.loads(run('exec','fg-six-yingce-postgres-1','psql','-U','fg_yingce','-d','fg_yingce','-tAc',"SELECT COALESCE(json_agg(r.actor_id),'[]') FROM fg_arcreel_runtimes r JOIN users u ON u.id=r.actor_id WHERE u.status='active'"))
if not users:raise SystemExit(0)
image=env.get('ARCREEL_RUNTIME_IMAGE','fg-six-arcreel:v130')
image_id=json.loads(run('image','inspect',image))[0]['Id']
gateway='fg-six-yingce-gateway-1'
attached=json.loads(run('inspect',gateway))[0]['NetworkSettings']['Networks']
metrics=ROOT/'host-metrics'
try:endpoints=json.loads((metrics/'arcreel-runtimes.json').read_text())
except FileNotFoundError:endpoints={}

def safe_subnet(actor):
    names=run('network','ls','-q').split()
    occupied=[ipaddress.ip_network(row['Subnet']) for network in json.loads(run('network','inspect',*names)) for row in (network.get('IPAM',{}).get('Config') or []) if row.get('Subnet')]
    first=int(hashlib.sha256(('arcreel:'+actor).encode()).hexdigest()[:4],16)
    for offset in range(65536):
        index=(first+offset)%65536
        candidate=ipaddress.ip_network((int(ipaddress.ip_address('10.208.0.0'))+index*16,28))
        if not any(other.version==4 and candidate.overlaps(other) for other in occupied):return str(candidate)
    raise RuntimeError('Private director address pool exhausted')

def idle(name,actor):
    pending=run('exec','fg-six-yingce-postgres-1','psql','-U','fg_yingce','-d','fg_yingce','-tAc',"SELECT count(*) FROM tasks t JOIN fg_arcreel_workspaces w ON w.native_project_id=t.project_id WHERE w.owner_id='"+actor+"' AND t.status NOT IN ('succeeded','failed','cancelled')")
    if pending!='0':return False
    probe="""import sqlite3
from contextlib import closing
with closing(sqlite3.connect('file:/state/arcreel.db?mode=ro',uri=True)) as db:
 tables={row[0] for row in db.execute("SELECT name FROM sqlite_master WHERE type='table'")}
 for table in ('tasks','agent_sessions'):
  if table not in tables:continue
  columns={row[1] for row in db.execute('PRAGMA table_info("'+table+'")')}
  if 'status' in columns:assert db.execute('SELECT count(*) FROM "'+table+'" WHERE status IN (?,?,?,?,?,?)',('running','queued','pending','generating','submitted','processing')).fetchone()[0]==0
"""
    return run('exec',name,'/app/.venv/bin/python','-c',probe,optional=True) is not None

for actor in users:
    assert re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',actor)
    name='fg-arcreel-'+actor.replace('-','');network=name+'-private'
    root=nas/'arcreel/users';directory=root/actor
    directory.mkdir(parents=True,exist_ok=True)
    assert directory.resolve().parent==root.resolve() and not directory.is_symlink()
    (directory/'.fg-arcreel-ready').write_text('FG private ArcReel workspace\n')
    capability=hmac.new(env['FG_ADCRAFT_SECRET'].encode(),('fg-creator-v1:'+actor).encode(),hashlib.sha256).hexdigest()
    net=run('network','inspect',network,optional=True)
    if not net:run('network','create','--subnet',safe_subnet(actor),network)
    subnet=ipaddress.ip_network(json.loads(run('network','inspect',network))[0]['IPAM']['Config'][0]['Subnet'])
    assert subnet.subnet_of(ipaddress.ip_network('10.208.0.0/12'))
    address=str(subnet.network_address+2);gateway_ip=str(subnet.network_address+3)
    existing=run('inspect',name,optional=True)
    if existing:
        state=json.loads(existing)[0]
        rebound=run('exec',name,'/app/.venv/bin/python','-c',"from pathlib import Path;p=Path('/workspace/.fg-arcreel-probe');p.write_text('FG storage check');assert p.read_text()=='FG storage check'",optional=True) is not None
        if state['Image']!=image_id or not state['State']['Running'] or not rebound:
            if state['State']['Running'] and not idle(name,actor):continue
            run('rm','-f',name);existing=None
    if not existing:
        run('run','-d','--name',name,'--user','1000:1000','--restart','unless-stopped','--network',network,'--ip',address,'--add-host','fg-gateway:'+gateway_ip,'--memory','1024m','--cpus','1','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--mount','type=volume,source='+name+'-state,target=/state','--mount','type=bind,source='+str(directory)+',target=/workspace','-e','FG_ARC_ACTOR='+actor,'-e','FG_ARC_CAPABILITY='+capability,image)
    if network not in attached:run('network','connect','--alias','fg-gateway','--ip',gateway_ip,network,gateway)
    endpoints[actor]=address
    temporary=metrics/'arcreel-runtimes.new';temporary.write_text(json.dumps(endpoints));temporary.chmod(0o644);temporary.replace(metrics/'arcreel-runtimes.json')
    # Snapshot the private SQLite DB without exposing scoped capabilities on NAS.
    # Project files already live in this actor's NAS directory; DB backups remain
    # in the actor's private volume because they contain the runtime credential.
    backup="""import pathlib,sqlite3,os
from contextlib import closing
out=pathlib.Path('/state/arcreel-backup.db.tmp')
with closing(sqlite3.connect('file:/state/arcreel.db?mode=ro',uri=True)) as db,closing(sqlite3.connect(out)) as target:
 db.backup(target);assert target.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
os.replace(out,'/state/arcreel-backup.db')
"""
    run('exec',name,'/app/.venv/bin/python','-c',backup,optional=True)
    print(json.dumps({'actor':actor,'directorProvisioned':True}),flush=True)
