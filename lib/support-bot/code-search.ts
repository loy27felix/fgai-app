import { execFile, spawn } from 'node:child_process';
import { realpath } from 'node:fs/promises';
import { promisify } from 'node:util';
import { scrubSupportValue } from './redact';
import { isSupportInvestigationPath, supportServices, supportInvestigationServiceId } from './services';

// Apply identical protection to committed and working-tree files without limiting investigation to Yingce.
// 已提交源码与工作树文件使用相同保护，不把多服务调查限制为 Yingce。
const excludedDirectories = ['.git', 'node_modules', '.next', 'dist', 'build', 'coverage', '__pycache__', '.logs', 'logs', '.local', '.codex-memory', '.serena'];
const excludedFiles = ['.env*', '.npmrc', '.netrc', '*.pem', '*.key', '*.p12', '*.pfx', '*.keystore', 'id_rsa*', 'id_ed25519*', '*credentials*.json', '*secrets*.json', '*.log', '*.sqlite*', '*.db', '*.dump', '*.sql.gz'];
export const supportCodeExclusions = [
  ...excludedDirectories.map(name => `:(exclude,glob)**/${name}/**`),
  ...excludedFiles.flatMap(name => [`:(exclude,glob,icase)**/${name}`, `:(exclude,glob,icase)**/${name}/**`]),
];
const retiredServiceExclusions = [
  ...Object.entries(supportServices).filter(([id]) => !supportInvestigationServiceId(id))
    .flatMap(([, service]) => service.paths.map(path => path.replace(/\/$/, ''))),
  'middleware.ts', 'instrumentation.ts', 'next.config.mjs',
].map(path => `:(exclude,literal)${path}`);
const sensitiveFile = /^(?:\.env.*|\.npmrc|\.netrc|id_(?:rsa|ed25519).*|.*\.(?:pem|key|p12|pfx|keystore|log|sqlite\w*|db|dump)|.*(?:credentials|secrets).*\.json|.*\.sql\.gz)$/i;

export function isSupportCodePath(path: string) {
  const segments = path.split('/');
  return !!path && path.length <= 1000 && !/[\x00-\x1f\x7f\\]/.test(path)
    && !segments.some(part => !part || part === '.' || part === '..' || excludedDirectories.includes(part))
    && !segments.some(part => sensitiveFile.test(part));
}

type CodeMatch = { path: string; line: number; excerpt: string };
export async function searchSupportCode(args: { term?: string; path?: string; line?: number; offset?: number }, revision: string, mode: 'commit' | 'working-tree' = 'commit') {
  if (!/^[a-f0-9]{40}$/.test(revision)) throw new Error('部署不包含 git 源码，无法检索');
  if (mode !== 'commit' && mode !== 'working-tree') throw new Error('源码检索模式无效');
  if (args.path !== undefined && (!isSupportCodePath(args.path) || !isSupportInvestigationPath(args.path))) throw new Error('源码路径无效、属于废弃主站或受保护文件');
  const root = await supportGitRoot();
  if (mode === 'working-tree' && (await readSupportGit(['rev-parse', '--verify', 'HEAD^{commit}'], root)).trim() !== revision) {
    throw new Error('工作树 checkout 与指定 revision 不匹配，请重新采集运行快照');
  }
  const reading = args.line !== undefined;
  if (reading && (!args.path || !Number.isInteger(args.line) || args.line! < 1)) throw new Error('读取源码需提供 path 和正整数 line');
  if (!reading && (!args.term?.trim() || args.term.length > 120 || /[\r\n\0]/.test(args.term))) throw new Error('检索词需为 1 到 120 字的单行文本');
  const offset = args.offset ?? 0;
  if (!Number.isInteger(offset) || offset < 0 || offset > 1000) throw new Error('分页 offset 需为 0 到 1000；结果过多时请缩小关键词或路径');
  const matches: CodeMatch[] = [];
  const start = Math.max(1, (args.line ?? 1) - 5);
  let skipped = 0;
  let more = false;
  let readLines = 0;
  let clipped = false;
  const truncated = await grepLines([
    'grep', '--no-textconv', '--no-recurse-submodules',
    ...(mode === 'working-tree' ? ['--untracked', '--exclude-standard'] : []),
    '-n', '-z', '-I', '-F', '-i', '-e', reading ? '' : args.term!,
    ...(mode === 'commit' ? [revision] : []), '--',
    ...(args.path ? [`:(literal)${args.path}`] : []), ...supportCodeExclusions, ...retiredServiceExclusions,
  ], record => {
    const [file, number, ...content] = record.split('\0');
    const path = mode === 'commit' ? file.slice(revision.length + 1) : file;
    const line = Number(number);
    if ((mode === 'commit' && !file.startsWith(`${revision}:`)) || !isSupportCodePath(path) || !isSupportInvestigationPath(path) || !Number.isInteger(line) || line < 1) return false;
    // Scrub before truncating so a credential assignment is never cut before its value.
    // 先脱敏再截断，避免截断位置把凭据值与赋值键分开。
    const safe = String(scrubSupportValue(content.join('\0')));
    clipped ||= safe.length > 1600;
    const excerpt = safe.slice(0, 1600);
    if (reading) {
      if (path !== args.path || line < start) return false;
      if (readLines >= 50 || (matches[0]?.excerpt.length ?? 0) + excerpt.length > 4800) { more = true; return true; }
      readLines++;
      if (!matches.length) matches.push({ path, line, excerpt });
      else matches[0].excerpt += `\n${excerpt}`;
      return false;
    }
    if (skipped++ < offset) return false;
    if (matches.length >= 12) { more = true; return true; }
    matches.push({ path, line, excerpt });
    return false;
  }, root);
  return {
    revision, mode, matches, truncated: truncated || more || clipped,
    ...(!reading && more ? { nextOffset: offset + matches.length } : {}),
    ...(reading && more ? { nextLine: start + readLines } : {}),
    scope: args.path || (mode === 'working-tree'
      ? '仓库内多服务的当前工作树文本，含未提交及未跟踪文件（废弃主站、忽略文件、凭据、日志及生成产物除外）'
      : '仓库内多服务的已提交文本（废弃主站、凭据、日志及生成产物除外）'),
  };
}

// Bound Git output while streaming; broad searches and large source files must not overflow execFile buffers.
// 流式限制 Git 输出，避免全库泛词搜索或大源码文件撑爆 execFile 缓冲区。
// Skip oversized records before credential regexes to bound CPU without exposing partial secrets.
// 超长行在凭据正则前截停，限制 CPU 消耗且不输出可能截断的敏感值。
function grepLines(args: string[], onLine: (line: string) => boolean, root: string): Promise<boolean> {
  return new Promise((resolve, reject) => {
    const child = spawn('git', ['-c', 'core.fsmonitor=false', ...args], { cwd: root, env: supportGitEnvironment(), stdio: ['ignore', 'pipe', 'ignore'] });
    let buffer = '';
    let bytes = 0;
    let stopped = false;
    let timedOut = false;
    const stop = () => { stopped = true; child.kill(); };
    const timer = setTimeout(() => { timedOut = true; child.kill(); }, 15_000);
    child.stdout.setEncoding('utf8');
    child.stdout.on('data', (chunk: string) => {
      if (stopped || timedOut) return;
      bytes += Buffer.byteLength(chunk);
      if (bytes > 8 * 1024 * 1024) { stop(); return; }
      buffer += chunk;
      let end: number;
      while ((end = buffer.indexOf('\n')) >= 0) {
        if (end > 16 * 1024) { stop(); return; }
        const line = buffer.slice(0, end);
        buffer = buffer.slice(end + 1);
        if (onLine(line)) { stop(); return; }
      }
      if (buffer.length > 16 * 1024) stop();
    });
    child.once('error', () => { clearTimeout(timer); reject(new Error('无法启动 Git 源码检索')); });
    child.once('close', code => {
      clearTimeout(timer);
      if (timedOut) reject(new Error('源码检索超时，请缩小关键词或路径'));
      else if (!stopped && code !== 0 && code !== 1) reject(new Error('Git 源码检索失败'));
      else resolve(stopped);
    });
  });
}

const executeGit = promisify(execFile);

// Ignore inherited Git redirections and never fetch missing objects or run credential prompts.
// 忽略继承的 Git 重定向，不为缺失对象发起拉取，也不触发凭据交互。
export function supportGitEnvironment(): NodeJS.ProcessEnv {
  const env = { ...process.env };
  for (const key of Object.keys(env)) if (key.startsWith('GIT_')) delete env[key];
  return {
    ...env,
    GIT_CONFIG_NOSYSTEM: '1', GIT_CONFIG_GLOBAL: '/dev/null', GIT_OPTIONAL_LOCKS: '0',
    GIT_NO_LAZY_FETCH: '1', GIT_TERMINAL_PROMPT: '0',
  };
}

export async function readSupportGit(args: string[], cwd = process.cwd()) {
  const { stdout } = await executeGit('git', ['-c', 'core.fsmonitor=false', ...args], {
    cwd, env: supportGitEnvironment(), timeout: 8_000, maxBuffer: 4 * 1024 * 1024,
  });
  return stdout;
}

export async function supportGitRoot() {
  const cwd = await realpath(process.cwd());
  const root = await realpath((await readSupportGit(['rev-parse', '--show-toplevel'], cwd)).trim());
  // A caller must run from the repository root, not a parent, subdirectory or redirected worktree.
  // 调用方须位于仓库根目录，避免父目录、子目录或被重定向工作树改变检索边界。
  if (root !== cwd) throw new Error('源码检索必须从仓库根目录运行');
  return root;
}
