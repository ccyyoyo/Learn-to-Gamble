import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ core: ['00-', '01-', '02-', '03-', '04-', '05-', '06-', '20-', '21-'] });
const { Bets } = LG;

test('Bets.place：每格上限、總注上限、鎖定', () => {
  const b = new Bets({ min: 50, max: 5000, spotRules: { tie: { min: 10, max: 500 } } });
  assert.deepEqual(b.limitFor('banker'), { min: 50, max: 5000 });
  assert.deepEqual(b.limitFor('tie'), { min: 10, max: 500 });
  assert.equal(b.place('banker', 100).ok, true);
  assert.equal(b.place('banker', 100).amount, 200);
  const r = b.place('tie', 510);
  assert.equal(r.ok, false);
  assert.equal(r.reason, 'ABOVE_MAX');
  assert.match(r.zh, /RM 500/);
  assert.equal(b.place('tie', 500).ok, true);
  assert.equal(b.place('player', 4400).reason, 'ABOVE_TABLE_MAX');
  assert.equal(b.place('player', 0).reason, 'BAD_AMOUNT');
  assert.equal(b.total(), 700);
  b.lock();
  assert.equal(b.locked, true);
  assert.equal(b.place('banker', 10).reason, 'LOCKED');
  assert.equal(b.remove('banker').reason, 'LOCKED');
  b.unlock();
  assert.equal(b.place('banker', 10).ok, true);
});

test('Bets.remove / clear / entries / get', () => {
  const b = new Bets({ min: 10, max: 100000 });
  b.place('a', 60); b.place('b', 25);
  assert.deepEqual(b.remove('a', 25), { ok: true, removed: 25, amount: 35 });
  assert.deepEqual(b.remove('a', 100), { ok: true, removed: 35, amount: 0 });
  assert.equal(b.get('a'), 0);
  assert.equal(b.remove('zzz').ok, false);
  assert.deepEqual(b.entries(), [['b', 25]]);
  b.lock(); b.clear();
  assert.equal(b.total(), 0, 'clear 不管鎖定');
});

test('Bets.snapshot / restore / last（lock 時記下上一注）', () => {
  const b = new Bets({ min: 10, max: 1000 });
  b.place('banker', 50); b.place('tie', 10);
  const snap = b.snapshot();
  assert.deepEqual(snap, { banker: 50, tie: 10 });
  b.lock();
  assert.deepEqual(b.last, snap);
  assert.equal(b.restore({ x: 1 }).ok, false);
  b.unlock(); b.clear();
  b.restore(b.last);
  assert.equal(b.total(), 60);
  snap.banker = 999; // snapshot 是複本
  assert.equal(b.get('banker'), 50);
  b.restore({ a: 0, c: 0.1 + 0.2 });
  assert.deepEqual(b.entries(), [['c', 0.3]]);
});

test('Bets.validate：EMPTY / BELOW_MIN / ABOVE_MAX / 總注下限', () => {
  const b = new Bets({ min: 50, max: 5000, spotRules: { tie: { min: 10, max: 500 } }, labels: { banker: '莊' } });
  let v = b.validate();
  assert.equal(v.ok, false);
  assert.equal(v.errors[0].reason, 'EMPTY');
  b.place('tie', 10);
  v = b.validate();
  assert.equal(v.ok, false, '只押和 10 < 總注最低 50');
  assert.equal(v.errors[0].spot, null);
  b.place('banker', 25);
  v = b.validate();
  assert.equal(v.ok, false);
  assert.deepEqual(v.errors.map((e) => [e.spot, e.reason]), [['banker', 'BELOW_MIN']]);
  assert.match(v.zh, /「莊」最低 RM 50/);
  b.place('banker', 25);
  assert.equal(b.validate().ok, true);
  b.set('tie', 600); // set 不檢查限額
  assert.deepEqual(b.validate().errors.map((e) => e.reason), ['ABOVE_MAX']);
});

test('Bets.subscribe 收到變動通知', () => {
  const b = new Bets({});
  let n = 0;
  const off = b.subscribe(() => n++);
  b.place('a', 10); b.remove('a'); b.lock(); b.unlock(); b.set('a', 5); b.clear();
  assert.equal(n, 6);
  off(); b.place('a', 10);
  assert.equal(n, 6);
  assert.equal(b.max, Infinity);
});

test('betLayer 在 DOM stub 下可建立/銷毀，rebet 使用 bets.last', () => {
  const table = LG.ui.el('div');
  const b = new Bets({ min: 10, max: 1000 });
  const tray = { selected: () => 25, setAffordable() {} };
  const layer = LG.ui.betLayer(table, { bets: b, chipTray: tray, gameId: 'unit' });
  assert.equal(typeof layer.refresh, 'function');
  b.place('x', 50); b.lock();
  assert.deepEqual(LG.store.get().lastBets.unit, { x: 50 });
  b.unlock(); b.clear();
  assert.equal(layer.rebet(), true);
  assert.equal(b.get('x'), 50);
  assert.equal(layer.available(), 950);
  layer.destroy();
});
