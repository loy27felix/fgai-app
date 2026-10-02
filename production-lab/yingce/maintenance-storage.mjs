// Executed in a temporary container using the same NAS mount as the backend.
import fs from 'node:fs';
import {randomUUID, createHash} from 'node:crypto';
import path from 'node:path';
const root = '/data/yingce';
const action = process.argv[1];
const day = process.argv[2];
let temporary;
try {
  fs.readFileSync('/data/.fg-studio-nas-ready');
  if (action === 'probe') {
    temporary = path.join(root, '.fg-six-probe-' + randomUUID());
    const bytes = Buffer.from('FG-six-NAS-write-read-check\n');
    const fd = fs.openSync(temporary, 'wx', 0o600);
    try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
    if (!fs.readFileSync(temporary).equals(bytes)) throw new Error('READ_MISMATCH');
    console.log('ready');
  } else {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(day)) throw new Error('INVALID_DAY');
    const folder = path.join(root, 'backups/database');
    const target = path.join(folder, day + '.dump');
    if (action === 'exists') {
      console.log(fs.existsSync(target) ? 'exists' : 'missing');
    } else if (action === 'backup') {
      const bytes = fs.readFileSync(0);
      if (bytes.subarray(0,5).toString() !== 'PGDMP') throw new Error('INVALID_BACKUP');
      fs.mkdirSync(folder, {recursive:true, mode:0o700});
      temporary = path.join(folder, '.fg-six-backup-' + randomUUID());
      const fd = fs.openSync(temporary, 'wx', 0o600);
      try { fs.writeFileSync(fd, bytes); fs.fsyncSync(fd); } finally { fs.closeSync(fd); }
      const hash = value => createHash('sha256').update(value).digest('hex');
      if (hash(fs.readFileSync(temporary)) !== hash(bytes)) throw new Error('CHECKSUM_MISMATCH');
      fs.renameSync(temporary, target);
      temporary = undefined;
      console.log('backup verified');
    } else throw new Error('INVALID_ACTION');
  }
} catch (error) {
  console.error('NAS operation unavailable: ' + (error.code || error.message));
  process.exitCode = 2;
} finally {
  if (temporary) try { fs.unlinkSync(temporary); } catch {}
}
