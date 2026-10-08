import fs from 'node:fs/promises';
import path from 'node:path';
import {fileURLToPath} from 'node:url';
import {createRequire} from 'node:module';
const root=path.resolve(path.dirname(fileURLToPath(import.meta.url)),'../..');
const require=createRequire(path.join(root,'production-lab/yingce/canvas/web/package.json'));
const {build}=require('esbuild');
const source=path.join(root,'reference/infinite-canvas/src/services/api');
await build({stdin:{contents:`export {parseJsonSource,parseMarkdownSource} from './prompt-source-runtime'; export {DEFAULT_PROMPT_SOURCES} from './prompt-source-presets'; export {promptImageOriginalUrl} from './prompt-image-url';`,resolveDir:source,sourcefile:'fg-inspiration-parser.ts'},bundle:true,format:'esm',platform:'node',target:'node20',outfile:path.join(root,'production-lab/yingce/gateway/fg-inspiration-parser.mjs'),banner:{js:'// Shared prompt parser from reference/infinite-canvas/src/services/api; bundled for the Node gateway.\n// Regenerate with production-lab/yingce/build-inspiration-parser.mjs.'},plugins:[{name:'export-parser',setup(build){build.onLoad({filter:/prompt-source-runtime\.ts$/},async args=>({contents:(await fs.readFile(args.path,'utf8')).replace('function parseJsonSource(', 'export function parseJsonSource('),loader:'ts'}));}}]});
