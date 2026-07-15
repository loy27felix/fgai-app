import assert from 'node:assert/strict';
import test from 'node:test';
import { buildImageLedgerEntry } from '../../lib/usage/ledger';

test('successful image generation records count and resolution without inventing a price', () => {
  const row = buildImageLedgerEntry({
    requestId: 'img-1',
    userId: 'user-1',
    projectId: 'project-1',
    provider: 'wetoken',
    model: 'gpt-image-2',
    resolution: '1024x1024',
  });

  assert.equal(row.kind, 'image');
  assert.equal(row.image_count, 1);
  assert.equal(row.resolution, '1024x1024');
  assert.equal(row.cost_source, 'unknown');
  assert.equal(row.status, 'succeeded');
  assert.equal(row.possibly_charged, true);
});
