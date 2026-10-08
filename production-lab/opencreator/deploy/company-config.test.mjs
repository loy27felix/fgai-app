import {test} from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {readOpenCreatorConfig,updateOpenCreatorConfig} from '/app/packages/config/dist/index.js';
import {managedTextDefault} from './company-config.mjs';

test('Sonnet migration runs once and later enabled user defaults survive restarts', () => {
  const document={creatorServices:{llm:{model:'gpt-5.6-sol-t1a'}}};
  const catalog={models:[{id:'gpt-5.6-sol-t1a'},{id:'claude-sonnet-5-5-t3a'}]};
  assert.equal(managedTextDefault(document,catalog,false),'claude-sonnet-5-5-t3a');
  assert.equal(managedTextDefault(document,catalog,true),'gpt-5.6-sol-t1a');
  assert.equal(managedTextDefault(document,{models:[]},true),'claude-sonnet-5-5-t3a');
});

test('managed defaults replace the native snake_case config and preserve storage', () => {
  const directory=fs.mkdtempSync(path.join(os.tmpdir(),'fg-config-fixture-'));
  const file=path.join(directory,'config.toml');
  try {
    fs.writeFileSync(file,'version = 1\n[storage]\ndefault_project_root = "/workspace/owned"\n[creator_services.llm]\nmodel = "gpt-5.6-sol-t1a"\n');
    const original=readOpenCreatorConfig(file).document;
    updateOpenCreatorConfig(file,document=>({...document,creatorServices:{...document.creatorServices,llm:{model:'claude-sonnet-5-5-t3a'},video:{seedance:{model:'doubao-seedance-2-0-fast-filter-off'}}}}));
    const saved=readOpenCreatorConfig(file).document;
    assert.equal(saved.creatorServices.llm.model,'claude-sonnet-5-5-t3a');
    assert.equal(saved.creatorServices.video.seedance.model,'doubao-seedance-2-0-fast-filter-off');
    assert.deepEqual(saved.storage,original.storage);
    assert.match(fs.readFileSync(file,'utf8'),/\[creator_services\.llm\]/);
    assert.doesNotMatch(fs.readFileSync(file,'utf8'),/\[creatorServices/);
  } finally {
    // Only this newly allocated OS temporary fixture directory is removed.
    fs.rmSync(directory,{recursive:true});
  }
});
