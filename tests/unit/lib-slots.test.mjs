import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ core: 'libs' });
const SL = LG.slots;

/** 以三列文字建 grid：rows[0] 上、[1] 中、[2] 下 → grid[reel][row] */
const G = (top, mid, bot) => {
  const rows = [top, mid, bot].map((r) => r.split(' '));
  return rows[0].map((_, reel) => rows.map((r) => r[reel]));
};
const PT = {
  W: { 5: 1000 },
  CS: { 3: 50, 4: 200, 5: 1000 },
  A: { 3: 10, 4: 25, 5: 75 },
  Q: { 3: 5, 4: 15, 5: 50 },
  J: { 3: 5, 4: 15, 5: 50 },
};
const OPT = { wild: 'W', scatter: 'SC' };
const L1 = [SL.LINES_20[0]]; // 中線

test('lib-slots: LINES_20 精確照 slot-video.md §3', () => {
  const spec = `1:[1,1,1,1,1] 2:[0,0,0,0,0] 3:[2,2,2,2,2] 4:[0,1,2,1,0] 5:[2,1,0,1,2]
6:[0,0,1,0,0] 7:[2,2,1,2,2] 8:[1,0,0,0,1] 9:[1,2,2,2,1] 10:[0,1,1,1,0]
11:[2,1,1,1,2] 12:[1,0,1,0,1] 13:[1,2,1,2,1] 14:[0,1,0,1,0] 15:[2,1,2,1,2]
16:[1,1,0,1,1] 17:[1,1,2,1,1] 18:[0,0,2,0,0] 19:[2,2,0,2,2] 20:[0,2,0,2,0]`;
  const parsed = [...spec.matchAll(/(\d+):\[([\d,]+)\]/g)].map((m) => [Number(m[1]), m[2].split(',').map(Number)]);
  assert.equal(parsed.length, 20);
  assert.equal(SL.LINES_20.length, 20);
  for (const [no, rows] of parsed) assert.deepEqual([...SL.LINES_20[no - 1]], rows, `線 ${no}`);
});

test('lib-slots: evalLines 左起連續', () => {
  let r = SL.evalLines(G('Q Q Q Q Q', 'A A A Q Q', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.wins.length, 1);
  assert.deepEqual({ sym: r.wins[0].sym, count: r.wins[0].count, mult: r.wins[0].mult }, { sym: 'A', count: 3, mult: 10 });
  assert.deepEqual(r.wins[0].cells, [[0, 1], [1, 1], [2, 1]]);
  assert.equal(r.wins[0].line, 0);
  assert.equal(r.wins[0].lineNo, 1);
  assert.equal(r.total, 10);
  r = SL.evalLines(G('Q Q Q Q Q', 'Q A A A A', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.total, 0, '不是從第一軸開始不算');
  r = SL.evalLines(G('Q Q Q Q Q', 'A A Q A A', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.total, 0, '中斷只算前 2 個，不足 3');
});

test('lib-slots: evalLines wild 替代', () => {
  let r = SL.evalLines(G('Q Q Q Q Q', 'W A W Q Q', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.wins[0].sym, 'A');
  assert.equal(r.wins[0].count, 3);
  r = SL.evalLines(G('Q Q Q Q Q', 'A W A A W', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.wins[0].count, 5);
  assert.equal(r.total, 75);
  r = SL.evalLines(G('Q Q Q Q Q', 'W W W W W', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.wins[0].sym, 'W');
  assert.equal(r.total, 1000);
});

test('lib-slots: evalLines 一線只取最高', () => {
  const pt = { ...PT, W: { 3: 100, 5: 1000 } };
  let r = SL.evalLines(G('Q Q Q Q Q', 'W W W Q J', 'J J J J J'), L1, pt, OPT);
  assert.equal(r.wins.length, 1);
  assert.equal(r.wins[0].sym, 'W', 'W×3=100 > Q×4=15');
  assert.equal(r.total, 100);
  r = SL.evalLines(G('Q Q Q Q Q', 'W W W CS CS', 'J J J J J'), L1, pt, OPT);
  assert.equal(r.wins[0].sym, 'CS', 'CS×5=1000 > W×3=100');
  assert.equal(r.total, 1000);
  // 沒有 W 3 連賠付時取 A 4 連
  r = SL.evalLines(G('Q Q Q Q Q', 'W W W A Q', 'J J J J J'), L1, PT, OPT);
  assert.equal(r.wins[0].sym, 'A');
  assert.equal(r.wins[0].count, 4);
});

test('lib-slots: scatter 不算線、wild 不替代 scatter；countScatter', () => {
  const pt = { ...PT, SC: { 3: 99, 4: 99, 5: 99 } };
  let r = SL.evalLines(G('Q Q Q Q Q', 'SC SC SC SC SC', 'J J J J J'), L1, pt, OPT);
  assert.equal(r.total, 0);
  r = SL.evalLines(G('Q Q Q Q Q', 'W SC SC A A', 'J J J J J'), L1, pt, OPT);
  assert.equal(r.total, 0);
  const g = G('SC Q Q SC Q', 'A SC A A A', 'J J J J SC');
  const s = SL.countScatter(g, 'SC');
  assert.equal(s.count, 4);
  assert.deepEqual(s.cells, [[0, 0], [1, 1], [3, 0], [4, 2]]);
});

test('lib-slots: evalLines 多線加總（20 線）與 leftToRight:false', () => {
  const g = G('A A A A A', 'A A A A A', 'A A A A A');
  const r = SL.evalLines(g, SL.LINES_20, PT, OPT);
  assert.equal(r.wins.length, 20);
  assert.equal(r.total, 20 * 75);
  const g2 = G('J J J J J', 'Q J A A A', 'Q Q Q Q Q');
  assert.equal(SL.evalLines(g2, L1, PT, OPT).total, 0);
  assert.equal(SL.evalLines(g2, L1, PT, { ...OPT, leftToRight: false }).total, 10);
  // 第 4 線 V 形
  const g3 = G('A Q Q Q A', 'Q A Q A Q', 'Q Q A Q Q');
  const r3 = SL.evalLines(g3, SL.LINES_20, PT, OPT);
  const v = r3.wins.find((w) => w.lineNo === 4);
  assert.equal(v.sym, 'A');
  assert.equal(v.count, 5);
});

test('lib-slots: spin 形狀、環狀連續、seed 可重現、gridAt', () => {
  const strips = [0, 1, 2, 3, 4].map(() => ['A', 'B', 'C', 'D']);
  LG.rng.seed(9);
  const g = SL.spin(strips, 3);
  assert.equal(g.length, 5);
  for (let i = 0; i < 5; i++) {
    assert.equal(g[i].length, 3);
    const st = g.stops[i];
    assert.deepEqual(g[i], [0, 1, 2].map((r) => strips[i][(st + r) % 4]));
  }
  LG.rng.seed(9);
  assert.deepEqual(SL.spin(strips, 3), g);
  assert.deepEqual(SL.gridAt(strips, [3, 0, 1, 2, 3], 3)[0], ['D', 'A', 'B']);
});

test('lib-slots: simulateRTP（線模式與 evaluate 模式）', () => {
  LG.rng.seed(1);
  // 3 軸各 [A,B]，單線 [0,0,0]，AAA 賠 8 → 期望 RTP = 1/8 × 8 = 1.0
  const res = SL.simulateRTP({ strips: [['A', 'B'], ['A', 'B'], ['A', 'B']], rows: 1, lines: [[0, 0, 0]], paytable: { A: { 3: 8 } } }, 80000);
  assert.ok(Math.abs(res.rtp - 1) < 0.05, `rtp ${res.rtp}`);
  assert.ok(Math.abs(res.hitRate - 0.125) < 0.01);
  assert.equal(res.spins, 80000);
  // evaluate 模式（可在內部模擬特色）：X 出現在第一格 → 贏 1.8 倍總注，機率 1/2 → RTP 0.9
  const r2 = SL.simulateRTP({ strips: [['X', 'Y']], rows: 1, evaluate: (g) => (g[0][0] === 'X' ? 1.8 : 0) }, 50000);
  assert.ok(Math.abs(r2.rtp - 0.9) < 0.03, `rtp ${r2.rtp}`);
  // evaluate 可回傳 {win}；自訂 spin
  const r3 = SL.simulateRTP({ spin: () => [['Z']], evaluate: () => ({ win: 2 }), bet: 4 }, 100);
  assert.equal(r3.rtp, 0.5);
  assert.equal(r3.hitRate, 1);
  // features 回呼（線模式下額外獎）
  const r4 = SL.simulateRTP({ strips: [['A'], ['A'], ['A']], rows: 1, lines: [[0, 0, 0]], paytable: { A: { 3: 1 } }, features: () => 1 }, 10);
  assert.equal(r4.rtp, 2);
});
