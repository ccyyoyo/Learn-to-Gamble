import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ core: ['00-', '01-', '02-'] });
const { money, rng } = LG;

test('money.fmt：整數千分位、小數兩位、負數、sign', () => {
  assert.equal(money.fmt(1000), 'RM 1,000');
  assert.equal(money.fmt(0), 'RM 0');
  assert.equal(money.fmt(1234567), 'RM 1,234,567');
  assert.equal(money.fmt(0.1), 'RM 0.10');
  assert.equal(money.fmt(2.5), 'RM 2.50');
  assert.equal(money.fmt(10, { cents: true }), 'RM 10.00');
  assert.equal(money.fmt(-50), '−RM 50');
  assert.equal(money.fmt(-1234.5), '−RM 1,234.50');
  assert.equal(money.fmtSigned(95), '+RM 95');
  assert.equal(money.fmtSigned(-50), '−RM 50');
  assert.equal(money.fmtSigned(0), 'RM 0');
  assert.equal(money.fmt(0.1 + 0.2), 'RM 0.30');
});

test('money.round2 / add / sub / mul 避免浮點誤差', () => {
  assert.equal(money.round2(0.1 + 0.2), 0.3);
  assert.equal(money.round2(1.005), 1.01);
  assert.equal(money.round2(-1.005), -1.01);
  assert.equal(money.round2(-0.001), 0);
  assert.ok(!Object.is(money.round2(-0.001), -0));
  assert.equal(money.add(0.1, 0.2), 0.3);
  assert.equal(money.sub(1, 0.9), 0.1);
  assert.equal(money.mul(100, 0.95), 95);
  assert.equal(money.mul(0.1, 3), 0.3);
  assert.equal(money.sum([0.1, 0.2, 0.3]), 0.6);
  assert.equal(money.round2(NaN), 0);
});

test('rng.seed 可重現；int 含兩端；shuffle 是排列', () => {
  rng.seed(123);
  const a = Array.from({ length: 5 }, () => rng.random());
  rng.seed(123);
  const b = Array.from({ length: 5 }, () => rng.random());
  assert.deepEqual(a, b);
  const seen = new Set();
  for (let i = 0; i < 2000; i++) { const v = rng.int(1, 6); assert.ok(v >= 1 && v <= 6); seen.add(v); }
  assert.equal(seen.size, 6);
  const arr = rng.shuffle([1, 2, 3, 4, 5, 6, 7, 8]);
  assert.deepEqual([...arr].sort((x, y) => x - y), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.ok([1, 2, 3].includes(rng.pick([1, 2, 3])));
  rng.seed(null);
  assert.equal(rng.seeded, false);
  const r = rng.random();
  assert.ok(r >= 0 && r < 1);
});
