"""Host-only FG provisioning. Never expose a Docker socket to an Agent."""
import pathlib,subprocess,json,hmac,hashlib,re,os

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
for user in users:
 assert re.fullmatch(r'[0-9a-f]{8}(?:-[0-9a-f]{4}){3}-[0-9a-f]{12}',user)
 identity=user.replace('-','');name='fg-creator-'+identity;network=name+'-private';directory=nas/'opencreator/users'/user
 directory.mkdir(parents=True,exist_ok=True);(directory/'.fg-creator-ready').write_text('FG private creator workspace\n')
 token=hmac.new(env['FG_ADCRAFT_SECRET'].encode(),('fg-creator-v1:'+user).encode(),hashlib.sha256).hexdigest()
 if run(['network','inspect',network],optional=True) is None:run(['network','create',network])
 existing=run(['inspect',name],optional=True)
 if existing:
  state=json.loads(existing)[0]
  rebound=run(['exec',name,'python3','-c',"from pathlib import Path; import os; Path('/workspace/.fg-creator-ready').read_text(); p=Path('/workspace/.fg-creator-probe'); p.write_text('FG creator write check'); assert p.read_text()=='FG creator write check'"],optional=True) is not None
  if state['Image']!=image_id or not state['State']['Running'] or not rebound:
   # Preserve the private state volume when updating an image or stale SMB bind.
   run(['rm','-f',name]);existing=None
 if not existing:
  run(['run','-d','--name',name,'--restart','unless-stopped','--network',network,'--memory','768m','--cpus','1','--pids-limit','256','--cap-drop','ALL','--security-opt','no-new-privileges','--mount','type=volume,source='+name+'-state,target=/state','--mount','type=bind,source='+str(directory)+',target=/workspace','-e','FG_CREATOR_ACTOR='+user,'-e','FG_CREATOR_CAPABILITY='+token,image])
 if network not in attached:run(['network','connect','--alias','fg-gateway',network,gateway])
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
