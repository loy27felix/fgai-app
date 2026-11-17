// Executed in a temporary container using the same NAS mount as the backend.
import fs from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
const root = '/data/yingce';
const action = process.argv[1];
const day = process.argv[2];
const service = process.argv[3];
const database = process.argv[4];
const scope = service === undefined && database === undefined ? [] : [service, database];
let temporary;
const guard = process.env.CANVAS_NAS_GUARD_DIR;
function checkNASGuard() {
  if (guard !== undefined) {
    if (guard !== '/run/fg-nas') throw new Error('INVALID_GUARD');
    const info = fs.lstatSync(guard);
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('INVALID_GUARD');
    try { fs.lstatSync(path.join(guard, 'disabled')); throw new Error('NAS_GUARDED'); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
  }
}
function checkNativeDirectories() {
  if (guard === undefined) return;
  let current = '/data';
  for (const part of ['yingce', 'backups', 'database', ...scope]) {
    current = path.join(current, part);
    try {
      const info = fs.lstatSync(current);
      if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('INVALID_BACKUP_DIRECTORY');
    } catch (error) { if (error.code !== 'ENOENT' || part === 'yingce') throw error; }
  }
}
try {
  if (scope.length && (guard === undefined || !['support-web', 'observability'].includes(service)
      || !/^[A-Za-z_][A-Za-z0-9_-]{0,62}$/.test(database || ''))) throw new Error('INVALID_BACKUP_SCOPE');
  checkNASGuard();
  if (guard !== undefined) {
    if (fs.readFileSync('/data/.fg-studio-nas-ready', 'utf8').trim() !== 'fg-studio-media:v1') throw new Error('INVALID_MARKER');
    checkNativeDirectories();
  } else fs.readFileSync('/data/.fg-studio-nas-ready');
  if (action === 'probe') {
    const probe = path.join(root, guard === undefined ? '.fg-six-probe-' + randomUUID() : '.fg-six-maintenance-probe');
    if (guard === undefined) temporary = probe;
    const bytes = Buffer.from('FG-six-NAS-write-read-check\n');
    const flags = guard === undefined ? 'wx' : fs.constants.O_WRONLY | fs.constants.O_CREAT | fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK;
    const fd = fs.openSync(probe, flags, 0o600);
    try {
      if (!fs.fstatSync(fd).isFile()) throw new Error('INVALID_PROBE');
      checkNASGuard();
      fs.ftruncateSync(fd, 0);
      fs.writeFileSync(fd, bytes); fs.fsyncSync(fd);
    } finally { fs.closeSync(fd); }
    if (!fs.readFileSync(probe).equals(bytes)) throw new Error('READ_MISMATCH');
    console.log('ready');
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('INVALID_DAY');
    const folder = path.join(root, 'backups/database', ...scope);
    const target = path.join(folder, day + '.dump');
    if (guard !== undefined) {
      try {
        const info = fs.lstatSync(target);
        if (!info.isFile() || info.isSymbolicLink()) throw new Error('INVALID_BACKUP_FILE');
        if (action === 'backup') throw new Error('BACKUP_EXISTS');
      } catch (error) { if (error.code !== 'ENOENT') throw error; }
    }
    if (action === 'exists') {
      console.log(fs.existsSync(target) ? 'exists' : 'missing');
    } else if (action === 'read' && guard !== undefined) {
      process.stdout.write(fs.readFileSync(target));
    } else if (action === 'backup') {
      const bytes = fs.readFileSync(0);
      if (bytes.subarray(0,5).toString() !== 'PGDMP') throw new Error('INVALID_BACKUP');
      checkNASGuard();
      fs.mkdirSync(folder, {recursive:true, mode:0o700});
      temporary = path.join(folder, '.fg-six-backup-' + randomUUID());
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const hash = value => createHash('sha256').update(value).digest('hex');
      if (hash(fs.readFileSync(temporary)) !== hash(bytes)) throw new Error('CHECKSUM_MISMATCH');
      checkNASGuard();
      fs.renameSync(temporary, target);
      temporary = undefined;
      console.log('backup verified');
    } else throw new Error('INVALID_ACTION');
  }
} catch (error) {
  console.error('NAS operation unavailable: ' + (error.code || error.message));
  process.exitCode = 2;
} finally {
  if (temporary) try { checkNASGuard(); fs.unlinkSync(temporary); } catch {}
}
