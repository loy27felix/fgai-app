const fs = require('node:fs');
const path = require('node:path');
const ts = require('typescript');

const root = path.resolve(__dirname, '../..');
const output = path.join(__dirname, '.build');
fs.mkdirSync(output, { recursive: true });

const files = ['domain', 'canvas-draft', 'canvas-interactions', 'production-flow', 'text-models', 'production-agent', 'canvas-storage']
  .map(name => path.join(root, 'lib', 'production-lab', `${name}.ts`));
const options = {
  target: ts.ScriptTarget.ES2022,
  module: ts.ModuleKind.CommonJS,
  moduleResolution: ts.ModuleResolutionKind.Node10,
  rootDir: path.join(root, 'lib', 'production-lab'),
  outDir: output,
  esModuleInterop: true,
  resolveJsonModule: true,
  skipLibCheck: true,
  strict: true,
  types: ['node'],
};
const program = ts.createProgram(files, options);
const diagnostics = ts.getPreEmitDiagnostics(program);
if (diagnostics.length) {
  console.error(ts.formatDiagnosticsWithColorAndContext(diagnostics, {
    getCurrentDirectory: () => root,
    getCanonicalFileName: name => name,
    getNewLine: () => '\n',
  }));
  process.exitCode = 1;
} else {
  const result = program.emit();
  if (result.emitSkipped) process.exitCode = 1;
}
