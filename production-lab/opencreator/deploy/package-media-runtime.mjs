// Build the native runtime contract, not the Go build report. Paths and hashes
// are immutable image assets; per-user yt-dlp updates stay in private state.
import {createHash} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {copyFileSync, readFileSync, writeFileSync, chmodSync} from 'node:fs';
import {join} from 'node:path';

const root = process.env.OPENCREATOR_CREATOR_RUNTIME_ROOT;
if (!root || !root.startsWith('/app/.runtime/build/krillinai/')) throw Error('Invalid media runtime root');
const old = JSON.parse(readFileSync(join(root, 'manifest.json'), 'utf8'));
const resources = [];
function add(path, kind, source) {
  const target = join(root, path);
  if (source) copyFileSync(source, target);
  if (kind === 'executable') chmodSync(target, 0o755);
  resources.push({path, kind, sha256:createHash('sha256').update(readFileSync(target)).digest('hex')});
}
for (const binary of Object.values(old.binaries || {})) add(binary.path, 'executable');
add('bin/ffmpeg', 'executable', '/usr/bin/ffmpeg');
add('bin/ffprobe', 'executable', '/usr/bin/ffprobe');
add('bin/python3', 'executable', '/usr/bin/python3');
add('bin/ca-certificates.crt', 'asset', '/etc/ssl/certs/ca-certificates.crt');
writeFileSync(join(root,'bin/yt-dlp.py'), 'from yt_dlp import main\nmain()\n');
add('bin/yt-dlp.py', 'asset');
const version = execFileSync(join(root,'bin/python3'), ['-I','-B',join(root,'bin/yt-dlp.py'),'--version'], {encoding:'utf8'}).trim();
const pythonVersion = execFileSync(join(root,'bin/python3'), ['--version'], {encoding:'utf8'}).trim();
const manifest = {version:1, runtimeMode:'cli', cliVersion:old.componentVersion,
  platform:process.platform, arch:process.arch, sourceCommit:old.sourceCommit,
  resources, ytDlp:{mode:'python', version, pythonVersion,
    executable:'bin/python3', script:'bin/yt-dlp.py', certificateBundle:'bin/ca-certificates.crt'}};
writeFileSync(join(root,'manifest.json'), JSON.stringify(manifest,null,2)+'\n');
const {readKrillinRuntimeManifest,verifyKrillinRuntimeManifest}=await import('/app/apps/daemon/dist/creator/krillin/manifest.js');
verifyKrillinRuntimeManifest(root,readKrillinRuntimeManifest(root));
console.log(JSON.stringify({mediaRuntimeReady:true,ytDlpVersion:version,resources:resources.length}));
