import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const CORE = ['00-', '01-', '02-', '03-', '04-', '05-', '06-'];

test('store：初始 state、update 立即寫入、load 讀回', () => {
  const LG = loadLG({ core: CORE });
  const s = LG.store.get();
  assert.equal(s.version, 1);
  assert.equal(s.bank, 1000);
  assert.equal(s.settings.hints, true);
  assert.deepEqual(s.jackpots['slot-progressive'], { mini: 20, minor: 50, major: 500, grand: 10000 });
  LG.store.update((d) => { d.jackpots['slot-holdspin'].grand += 12.5; });
  const raw = JSON.parse(globalThis.localStorage.getItem('lg.v1'));
  assert.equal(raw.jackpots['slot-holdspin'].grand, 5012.5);
  s.bank = 5; // get() 是複本
  assert.equal(LG.store.get().bank, 1000);
  globalThis.localStorage.setItem('lg.v1', JSON.stringify({ ...raw, bank: 321 }));
  assert.equal(LG.store.load().bank, 321);
});

test('store.migrate：缺欄位補齊、壞資料回預設', () => {
  const LG = loadLG({ core: CORE });
  const m = LG.store.migrate({ bank: 50, stats: { x: { rounds: 1 } } });
  assert.equal(m.bank, 50);
  assert.equal(m.settings.hints, true);
  assert.deepEqual(m.sessions, []);
  assert.equal(m.stats.x.rounds, 1);
  assert.ok(m.jackpots['caribbean-stud'].pool === 100000);
  assert.equal(LG.store.migrate('garbage').bank, 1000);
  assert.equal(LG.store.migrate({ bank: -5 }).bank, 1000);
  globalThis.localStorage.setItem('lg.v1', '{not json');
  assert.equal(LG.store.load().bank, 1000);
});

test('store.reset：清除全部並 emit store:reset / bank:change', () => {
  const LG = loadLG({ core: CORE });
  const seen = [];
  LG.events.on('store:reset', () => seen.push('reset'));
  LG.events.on('bank:change', (p) => seen.push('bank:' + p.balance));
  LG.bank.debit(300);
  LG.stats.record('g', { wagered: 10, net: -10, outcome: 'lose' });
  LG.progress.markStep('g', 0, 12);
  LG.store.reset();
  const s = LG.store.get();
  assert.equal(s.bank, 1000);
  assert.deepEqual(s.stats, {});
  assert.deepEqual(s.progress, {});
  assert.ok(seen.includes('reset') && seen.includes('bank:1000'));
});

test('bank：debit 不足 throw INSUFFICIENT、credit、reset 只重置餘額', () => {
  const LG = loadLG({ core: CORE });
  const ev = [];
  LG.events.on('bank:change', (p) => ev.push(p));
  assert.equal(LG.bank.balance(), 1000);
  assert.equal(LG.bank.debit(250.5), 749.5);
  assert.throws(() => LG.bank.debit(749.51), /INSUFFICIENT/);
  assert.equal(LG.bank.balance(), 749.5);
  assert.ok(LG.bank.canAfford(749.5));
  assert.ok(!LG.bank.canAfford(749.51));
  assert.equal(LG.bank.credit(0.1), 749.6);
  assert.equal(LG.bank.credit(0.2), 749.8);
  assert.throws(() => LG.bank.debit(-1), /BAD_AMOUNT/);
  assert.deepEqual(ev.map((e) => e.delta), [-250.5, 0.1, 0.2]);
  LG.stats.record('baccarat', { wagered: 100, net: 95 });
  LG.bank.reset();
  assert.equal(LG.bank.balance(), 1000);
  assert.equal(LG.stats.get('baccarat').rounds, 1, 'reset 不清統計');
  assert.equal(JSON.parse(globalThis.localStorage.getItem('lg.v1')).bank, 1000);
});

test('stats.record / get', () => {
  const LG = loadLG({ core: CORE });
  assert.deepEqual(LG.stats.get('x'), { rounds: 0, wagered: 0, net: 0, wins: 0, losses: 0, pushes: 0 });
  LG.stats.record('x', { wagered: 100, net: 95, outcome: 'win' });
  LG.stats.record('x', { wagered: 50, net: -50, outcome: 'lose' });
  LG.stats.record('x', { wagered: 50, net: 0 }); // outcome 省略 → push
  LG.stats.record('x', { wagered: 0.3, net: 0.1 });
  assert.deepEqual(LG.stats.get('x'), { rounds: 4, wagered: 200.3, net: 45.1, wins: 2, losses: 1, pushes: 1 });
});

test('stats.session：start / record / end 摘要與歷史（最多 20 筆）', () => {
  const LG = loadLG({ core: CORE });
  const ss = LG.stats.session;
  assert.equal(ss.current(), null);
  assert.equal(ss.end(), null);
  ss.start('baccarat');
  ss.record({ wagered: 100, net: 95, outcome: 'win' });
  ss.record({ wagered: 200, net: -200, outcome: 'lose' });
  ss.record({ wagered: 50, net: 0, outcome: 'push' });
  ss.markBroke();
  const cur = ss.current();
  assert.equal(cur.rounds, 3);
  const sum = ss.end();
  assert.equal(sum.gameId, 'baccarat');
  assert.equal(sum.rounds, 3);
  assert.equal(sum.wagered, 350);
  assert.equal(sum.net, -105);
  assert.equal(sum.maxWin, 95);
  assert.equal(sum.maxLoss, -200);
  assert.equal(sum.broke, true);
  assert.ok(sum.endedAt >= sum.startedAt);
  assert.equal(ss.current(), null);
  const hist = LG.store.get().sessions;
  assert.equal(hist.length, 1);
  assert.equal(hist[0].net, -105);
  for (let i = 0; i < 25; i++) { ss.start('g' + i); ss.end(); }
  assert.equal(LG.store.get().sessions.length, 20);
  assert.equal(LG.store.get().sessions.at(-1).gameId, 'g24');
});

test('progress：markStep / pct / isComplete', () => {
  const LG = loadLG({ core: CORE });
  const seen = [];
  LG.events.on('progress:change', (p) => seen.push(p.gameId));
  assert.equal(LG.progress.pct('g'), 0);
  LG.progress.markStep('g', 0, 4);
  LG.progress.markStep('g', 0, 4);
  LG.progress.markStep('g', 1, 4);
  assert.equal(LG.progress.pct('g'), 50);
  assert.equal(LG.progress.isComplete('g'), false);
  LG.progress.markStep('g', 3, 4);
  LG.progress.markStep('g', 2, 4);
  assert.equal(LG.progress.pct('g'), 100);
  assert.equal(LG.progress.isComplete('g'), true);
  assert.deepEqual(LG.progress.get('g').steps, [0, 1, 2, 3]);
  assert.equal(seen.length, 5);
});

test('events：on / off / once；handler 例外不影響其他', () => {
  const LG = loadLG({ core: CORE });
  const got = [];
  const off = LG.events.on('x', (p) => got.push('a' + p));
  LG.events.once('x', (p) => got.push('b' + p));
  const origErr = console.error; console.error = () => {};
  LG.events.on('x', () => { throw Error('boom'); });
  LG.events.emit('x', 1);
  off();
  LG.events.emit('x', 2);
  console.error = origErr;
  assert.deepEqual(got, ['a1', 'b1']);
});
