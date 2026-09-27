// 番攤 Fan Tan：4 種結果枚舉 EV、撥扣模擬、結算（扣佣 / push）、教學規範
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['fantan'] });
const def = LG.games.fantan;
const { settle, outcome, exactStats, resultFromCount, strokes, SPOT_IDS, SPEC_EDGE, BUTTONS } = def.logic;
const kind = (id) => id.split('-')[0];

test('番攤 註冊：spotId（番 4、念 12、角 6、三門 4、單雙 2）、houseEdge、限注', () => {
  const count = (k) => SPOT_IDS.filter((id) => kind(id) === k).length;
  assert.deepEqual([count('fan'), count('nim'), count('kwok'), count('ngatan'), count('odd'), count('even')], [4, 12, 6, 4, 1, 1]);
  assert.ok(SPOT_IDS.includes('nim-1-2') && SPOT_IDS.includes('nim-2-1') && SPOT_IDS.includes('kwok-1-3'));
  assert.equal(LG.bestEdge(def).edge, 2.5);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 50, max: 3000 });
  assert.equal(def.countdown, 20);
});

test('番攤 枚舉 4 種結果：每注 EV 與優勢表一致（±0.01%）', () => {
  for (const id of SPOT_IDS) {
    // settle 會四捨五入到分，用 100 單位避免捨入誤差
    let net100 = 0;
    for (const r of [1, 2, 3, 4]) net100 += settle([[id, 100]], r).net;
    const edge = (-net100 / 400) * 100;
    assert.ok(Math.abs(edge - SPEC_EDGE[kind(id)]) <= 0.01, `${id}: ${edge}% vs ${SPEC_EDGE[kind(id)]}%`);
    assert.ok(Math.abs(exactStats(id).edge - SPEC_EDGE[kind(id)]) <= 0.01);
  }
  assert.equal(SPEC_EDGE.fan, 3.75);
  assert.equal(SPEC_EDGE.nim, 2.5);
  assert.equal(SPEC_EDGE.kwok, 2.5);
  assert.equal(SPEC_EDGE.odd, 2.5);
});

test('番攤 houseEdge 陣列與枚舉一致', () => {
  const byName = Object.fromEntries(def.houseEdge.map((h) => [h.bet.en, h.edge]));
  const near = (a, b, m) => assert.ok(Math.abs(a - b) < 1e-9, `${m}: ${a} vs ${b}`);
  near(byName['Nim / Kwok'], exactStats('nim-1-2').edge, '念');
  near(byName['Nim / Kwok'], exactStats('kwok-3-4').edge, '角');
  near(byName['Odd / Even'], exactStats('odd').edge, '單雙');
  near(byName.Fan, exactStats('fan-2').edge, '番');
  near(byName['Nga Tan'], exactStats('ngatan-1').edge, '三門');
});

test('番攤 撥扣模擬：總數 N → 結果 = N mod 4（0 → 4）', () => {
  assert.equal(resultFromCount(63), 3);
  assert.equal(resultFromCount(64), 4);
  assert.equal(resultFromCount(61), 1);
  assert.equal(resultFromCount(200), 4);
  for (let n = BUTTONS.min; n <= BUTTONS.max; n++) {
    const seq = strokes(n);
    const left = seq[seq.length - 1];
    assert.ok(left >= 1 && left <= 4, `${n} 剩 ${left}`);
    assert.equal(left, resultFromCount(n));
    assert.equal(left, n % 4 === 0 ? 4 : n % 4);
    for (let i = 1; i < seq.length; i++) assert.equal(seq[i - 1] - seq[i], 4, '每撥 4 顆');
  }
  // 60–200 各結果機率幾乎相等
  const c = [0, 0, 0, 0, 0];
  for (let n = 60; n <= 200; n++) c[resultFromCount(n)]++;
  assert.ok(Math.max(...c.slice(1)) - Math.min(...c.slice(1)) <= 1);
});

test('番攤 結算：番扣佣、念 push、角、三門、單雙', () => {
  let r = settle([['fan-3', 100]], 3);
  assert.deepEqual([r.returned, r.net, r.commission], [385, 285, 15]);
  assert.match(r.lines[0].formula, /RM 100 × 3 × 0.95 = \+RM 285（拿回 RM 385）/);
  r = settle([['nim-3-2', 100]], 2);
  assert.deepEqual([r.lines[0].result, r.returned, r.net], ['push', 100, 0]);
  r = settle([['nim-3-2', 100]], 3);
  assert.deepEqual([r.returned, r.net], [290, 190]);
  r = settle([['nim-3-2', 100]], 4);
  assert.equal(r.net, -100);
  r = settle([['kwok-1-2', 100], ['odd', 100], ['even', 100]], 1);
  assert.deepEqual([r.wagered, r.returned, r.net], [300, 390, 90]);
  r = settle([['ngatan-4', 300]], 1);
  assert.deepEqual([r.returned, r.net], [395, 95]);
  r = settle([['ngatan-4', 300]], 4);
  assert.equal(r.net, -300);
  assert.equal(outcome('ngatan-2', 3).res, 'win');
  assert.equal(outcome('kwok-2-4', 4).res, 'win');
});

test('番攤 教學步驟符合規範（≥12 步、四段、≥3 action）', () => {
  const inst = def.create(fakeCtx());
  const lint = LG.tutorial.lint(inst.tutorialSteps());
  assert.deepEqual(lint.problems, []);
});

function fakeCtx(o = {}) {
  return {
    gameId: 'fantan', def, mode: 'tutorial', variant: '', limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
    ...o,
  };
}
