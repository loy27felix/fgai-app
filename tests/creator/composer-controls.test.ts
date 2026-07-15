import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';

test('creator composer exposes Skill, Prompt, and a persistent reasoning switch', () => {
  const source = fs.readFileSync(
    path.join(process.cwd(), 'components/creator/CreatorWorkspace.tsx'),
    'utf8',
  );

  assert.match(source, /<SkillPicker/);
  assert.match(source, /<PromptPicker/);
  assert.match(source, /aria-label="推理模式"/);
  assert.match(source, /skill:\s*activeSkill/);
  assert.doesNotMatch(source, /selectedModel\.provider\s*===\s*["']deepseek["']\s*&&\s*<label/);
});
