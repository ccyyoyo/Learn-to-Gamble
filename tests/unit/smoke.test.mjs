import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

test('namespace loads', () => {
  const LG = loadLG({ core: ['00-'] });
  assert.equal(typeof LG.ms, 'function');
  assert.equal(LG.ms(1000), 100); // LG_TEST → ×0.1
});
