import assert from 'node:assert/strict';
import test from 'node:test';
import { companyEmailFromUsername, normalizeCompanyUsername } from '../../lib/auth/company-email';

test('registration email always uses the company domain', () => {
  assert.equal(companyEmailFromUsername('meilinle'), 'meilinle@beva.com');
  assert.equal(companyEmailFromUsername(' MEILINLE@other.example '), 'meilinle@beva.com');
});

test('registration rejects an empty or malformed local part', () => {
  assert.equal(normalizeCompanyUsername('name@external.com'), 'name');
  assert.equal(companyEmailFromUsername(''), null);
  assert.equal(companyEmailFromUsername('.name'), null);
  assert.equal(companyEmailFromUsername('name.'), null);
});
