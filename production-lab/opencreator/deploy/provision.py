"""Host-only FG provisioning. Never expose a Docker socket to an Agent."""
import pathlib,subprocess,json,hmac,hashlib,re,os,ipaddress

ROOT=pathlib.Path('/Users/server/work/fg-six-yingce')
DOCKER='/usr/local/bin/docker'
env={}
for line in (ROOT/'.env').read_text().splitlines():
 if '=' in line and not line.startswith('#'):
  key,value=line.split('=',1);env[key]=value
nas=pathlib.Path(env['NAS_MEDIA_PATH'])
assert (nas/'.fg-studio-nas-ready').is_file(),'NAS unavailable; no runtime provisioned'
def run(args,optional=False):
 try:result=subprocess.run([DOCKER,*args],capture_output=True,text=True,timeout=30)
 except subprocess.TimeoutExpired:
  if optional:return None
  raise RuntimeError('Creator Docker operation timed out; private arguments omitted') from None
 if result.returncode and not optional:raise RuntimeError('Creator Docker operation failed; private arguments omitted')
 return result.stdout.strip() if result.returncode==0 else None
users=json.loads(run(['exec','fg-six-yingce-postgres-1','psql','-U','fg_yingce','-d','fg_yingce','-tAc',"SELECT COALESCE(json_agg(id),'[]') FROM users WHERE status='active' AND id IN(SELECT user_id FROM fg_accounts)"]))
gateway='fg-six-yingce-gateway-1'
image=env.get('CREATOR_RUNTIME_IMAGE','fg-six-creator-runtime:v128')
image_id=json.loads(run(['image','inspect',image]))[0]['Id']
attached=json.loads(run(['inspect',gateway]))[0]['NetworkSettings']['Networks']
metrics=ROOT/'host-metrics';metrics.mkdir(exist_ok=True)
endpoints={}
try:endpoints=json.loads((metrics/'creator-runtimes.json').read_text())
except FileNotFoundError:pass
def idle(name):
 state=json.loads(run(['inspect',name]))[0]['State']
 # A restart loop has no running process to interrupt. Keep its state volume
 # while replacing the broken bootstrap connection with a pinned address.
 if state.get('Restarting') and state.get('Pid')==0:return True
 script="""fetch('http://127.0.0.1:8060/runs',{headers:{'x-fg-runtime':process.env.FG_CREATOR_CAPABILITY},signal:AbortSignal.timeout(5000)}).then(async r=>{if(!r.ok)process.exit(2);const d=await r.json();const terminal=new Set(['succeeded','failed','canceled','cancelled','orphaned']);process.exit(Array.isArray(d.runs)&&d.runs.every(r=>terminal.has(r.status))?0:2);}).catch(()=>process.exit(2));"""
 return run(['exec',name,'node','-e',script],optional=True) is not None

def safe_subnet(user):
 # Docker's automatic pools reach 192.168.0.0/20 after many user bridges,
 # overlapping the company LAN. Allocate exclusively in 10.208.0.0/12.
 networks=run(['network','ls','-q']).split()
 occupied={subnet['Subnet'] for net in json.loads(run(['network','inspect',*networks])) for subnet in (net.get('IPAM',{}).get('Config') or []) if 'Subnet' in subnet}
 initial=int(hashlib.sha256(user.encode()).hexdigest()[:4],16)
 for offset in range(65536):
  index=(initial+offset)%65536
  subnet=str(ipaddress.ip_network((int(ipaddress.ip_address('10.208.0.0'))+index*16,28)))
  if not any(ipaddress.ip_network(other).version==4 and ipaddress.ip_network(subnet).overlaps(ipaddress.ip_network(other)) for other in occupied):return subnet
 raise RuntimeError('Creator private address pool exhausted')
for user in users:
 assert re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',user)
 identity=user.replace('-','');name='fg-creator-'+identity;network=name+'-private';directory=nas/'opencreator/users'/user
 directory.mkdir(parents=True,exist_ok=True);(directory/'.fg-creator-ready').write_text('FG private creator workspace\n')
 token=hmac.new(env['FG_ADCRAFT_SECRET'].encode(),('fg-creator-v1:'+user).encode(),hashlib.sha256).hexdigest()
 existing=run(['inspect',name],optional=True)
 net=run(['network','inspect',network],optional=True)
 if net:
  details=json.loads(net)[0]
  subnets=[ipaddress.ip_network(c['Subnet']) for c in details.get('IPAM',{}).get('Config',[]) if 'Subnet' in c]
  if any(not subnet.subnet_of(ipaddress.ip_network('10.208.0.0/12')) for subnet in subnets if subnet.version==4):
   # Replace only this user's two-endpoint bridge, preserving every volume.
   assert set(details.get('Containers',{})).issubset({c['Id'] for c in json.loads(run(['inspect',gateway]+([name] if existing else [])))})
   if existing:
    state=json.loads(existing)[0]
    if state['State']['Running'] and not idle(name):
     print(json.dumps({'actor':user,'deferred':'active or unavailable Agent'}),flush=True);continue
    run(['rm','-f',name]);existing=None
   if network in attached:run(['network','disconnect',network,gateway]);attached.pop(network,None)
   run(['network','rm',network]);net=None
 if not net:run(['network','create','--subnet',safe_subnet(user),network])
 subnet=ipaddress.ip_network(json.loads(run(['network','inspect',network]))[0]['IPAM']['Config'][0]['Subnet'])
 runtime_ip=str(subnet.network_address+2);gateway_ip=str(subnet.network_address+3)
 if existing:
  state=json.loads(existing)[0]
  rebound=run(['exec',name,'python3','-c',"from pathlib import Path; import os; Path('/workspace/.fg-creator-ready').read_text(); p=Path('/workspace/.fg-creator-probe'); p.write_text('FG creator write check'); assert p.read_text()=='FG creator write check'"],optional=True) is not None
  if state['Image']!=image_id or not state['State']['Running'] or not rebound or 'fg-gateway:'+gateway_ip not in (state['HostConfig'].get('ExtraHosts') or []):
   if state['State']['Running'] and not idle(name):
    print(json.dumps({'actor':user,'deferred':'active or unavailable Agent'}),flush=True);continue
   # Preserve the private state volume when updating an image or stale SMB bind.
   run(['rm','-f',name]);existing=None
 if not existing:
  run(['run','-d','--name',name,'--restart','unless-stopped','--network',network,'--ip',runtime_ip,'--add-host','fg-gateway:'+gateway_ip,'--memory','768m','--cpus','1','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--mount','type=volume,source='+name+'-state,target=/state','--mount','type=bind,source='+str(directory)+',target=/workspace','-e','FG_CREATOR_ACTOR='+user,'-e','FG_CREATOR_CAPABILITY='+token,image])
 if network not in attached:run(['network','connect','--alias','fg-gateway','--ip',gateway_ip,network,gateway])
 endpoints[user]=runtime_ip
 temporary=metrics/'creator-runtimes.new';temporary.write_text(json.dumps(endpoints));temporary.chmod(0o644);temporary.replace(metrics/'creator-runtimes.json')
 # SQLite online backups replace hourly snapshots and retain relative paths.
 # Credentials stay in the private local state volume, never on shared NAS.
 script='''import sqlite3,pathlib,os,time
from contextlib import closing
root=pathlib.Path('/state/opencreator/data');target=pathlib.Path('/workspace/database-backup');target.mkdir(exist_ok=True)
for source in root.rglob('*'):
 if source.suffix not in ('.sqlite','.sqlite3','.db'):continue
 destination=target/source.relative_to(root);destination.parent.mkdir(parents=True,exist_ok=True)
 if destination.exists() and time.time()-destination.stat().st_mtime<3600:continue
 temporary=destination.with_suffix(destination.suffix+'.tmp')
 with closing(sqlite3.connect(source.as_uri()+'?mode=ro',uri=True)) as db,closing(sqlite3.connect(temporary)) as out:
  db.backup(out)
  assert out.execute('PRAGMA integrity_check').fetchone()[0]=='ok'
 os.replace(temporary,destination)
'''
 run(['exec',name,'python3','-c',script],optional=True)
 print(json.dumps({'actor':user,'runtime':name,'provisioned':True}),flush=True)
