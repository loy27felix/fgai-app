import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {createRequire} from 'node:module';
import {purgeProjects} from './trash.mjs';
const Database=createRequire('/app/apps/daemon/dist/main.js')('better-sqlite3');

test('creator purge is confined to archived managed projects with no shared or active use',()=>{
 const root=fs.mkdtempSync(path.join(os.tmpdir(),'fg-creator-trash-'));
 const foreign=fs.mkdtempSync(path.join(os.tmpdir(),'fg-business-files-'));
 fs.writeFileSync(path.join(root,'.fg-creator-ready'),'FG private creator workspace\n');
 fs.writeFileSync(path.join(foreign,'keep.txt'),'must remain');
 const db=new Database(':memory:');
 db.exec(`CREATE TABLE projects(id TEXT PRIMARY KEY,name TEXT,cwd TEXT,status TEXT,updated_at TEXT);CREATE TABLE threads(project_id TEXT,status TEXT,archived_at TEXT);CREATE TABLE runs(public_status TEXT,internal_status TEXT);CREATE TABLE creator_stage_runs(status TEXT);`);
 const add=(id,cwd,status='archived')=>db.prepare('INSERT INTO projects VALUES(?,?,?,?,NULL)').run(id,id,cwd,status);
 const id='project_abcdefghij',cwd=path.join(root,'project-abcdefghijkl');fs.mkdirSync(cwd);fs.writeFileSync(path.join(cwd,'delete.txt'),'fixture');add(id,cwd);
 db.prepare('INSERT INTO runs VALUES(?,?)').run('running','running');assert.throws(()=>purgeProjects(db,root,[id]),/任务结束/);assert.ok(fs.existsSync(cwd));db.exec('DELETE FROM runs');
 add('project_klmnopqrst',cwd,'active');assert.throws(()=>purgeProjects(db,root,[id]),/其他工程引用/);assert.ok(fs.existsSync(cwd));db.exec("DELETE FROM projects WHERE id='project_klmnopqrst'");
 add('project_uvwxabcdef',foreign);assert.throws(()=>purgeProjects(db,root,['project_uvwxabcdef']),/托管工程/);assert.equal(fs.readFileSync(path.join(foreign,'keep.txt'),'utf8'),'must remain');
 const link=path.join(root,'project-mnopqrstuvwx');fs.symlinkSync(foreign,link);add('project_ghijklmnop',link);assert.throws(()=>purgeProjects(db,root,['project_ghijklmnop']),/安全/);assert.ok(fs.existsSync(path.join(foreign,'keep.txt')));
 db.prepare('INSERT INTO threads VALUES(?,?,NULL)').run(id,'active');assert.equal(purgeProjects(db,root,[id]).length,1);assert.ok(!fs.existsSync(cwd));assert.equal(db.prepare('SELECT status FROM projects WHERE id=?').get(id).status,'purged');assert.equal(db.prepare('SELECT status FROM threads WHERE project_id=?').get(id).status,'archived');
 assert.ok(fs.existsSync(path.join(foreign,'keep.txt')));db.close();
 // These roots were created explicitly by this test and contain no user data.
 fs.rmSync(root,{recursive:true});fs.rmSync(foreign,{recursive:true});
});
