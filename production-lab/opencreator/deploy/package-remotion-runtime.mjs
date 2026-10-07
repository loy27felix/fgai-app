import { cpSync, mkdirSync, readFileSync, renameSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join } from 'node:path';

// All members use the same verified Linux component in their server image.
// Private project/state mounts remain separate for each member.
const browser='/usr/lib/chromium/chromium';
const chromiumVersion=execFileSync(browser,['--version'],{encoding:'utf8'}).match(/\d+\.\d+\.\d+\.\d+/)?.[0];
if(!chromiumVersion)throw Error('Cannot determine Chromium version');
execFileSync(process.execPath,['apps/desktop/scripts/prepare-stickman-runtime.mjs'],{
 cwd:'/app',stdio:'inherit',env:{...process.env,OPENCREATOR_STICKMAN_BROWSER_PATH:browser,OPENCREATOR_STICKMAN_CHROMIUM_VERSION:chromiumVersion}
});
const descriptorPath='/app/apps/desktop/.pack/components/remotion-component.json';
const release=JSON.parse(readFileSync(descriptorPath,'utf8'));
const root=join('/app/.runtime/fg-remotion-installed',release.manifestSha256);
mkdirSync('/app/.runtime/fg-remotion-installed',{recursive:true});
renameSync('/app/apps/desktop/.pack/stickman-runtime',root);
mkdirSync('/app/apps/daemon/runtime',{recursive:true});
cpSync(descriptorPath,'/app/apps/daemon/runtime/remotion-component.json');
// Keep repair local as well: this Linux build is not an upstream desktop release.
cpSync(join('/app/apps/desktop/.pack/components',release.fileName),'/app/apps/daemon/runtime/remotion-component.tar.gz');
cpSync('/app/apps/desktop/.pack/stickman-assets','/app/apps/daemon/runtime/stickman-assets',{recursive:true});
execFileSync(process.execPath,['/app/verify-remotion-runtime.mjs'],{stdio:'inherit'});
