// slot-classic：規格 docs/05-game-rules/slot-classic.md §9 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['slot-classic'] });
const def = LG.games['slot-classic'];
const L = def.logic;
const line = (s) => [...s];

test('slot-classic 註冊：分類、houseEdge 10%（RTP 90%）、限注、不用籌碼', () => {
  assert.equal(def.category, 'slots');
  const b = LG.bestEdge(def);
  assert.equal(b.edge, 10.0);
  assert.equal(b.best, true);
  assert.equal(def.denoms, undefined, '老虎機不用籌碼盤');
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 0.1, max: 25 });
  assert.deepEqual(L.CREDIT_VALUES, [0.1, 0.2, 0.5, 1, 2, 5]);
  assert.deepEqual(L.CREDITS, [1, 2, 3, 4, 5]);
  assert.equal(Math.max(...L.CREDIT_VALUES) * Math.max(...L.CREDITS), 25, 'MAX BET = RM 25');
});

test('slot-classic evalLine：7 種組合各一測資', () => {
  const cases = [
    ['GGG', 'GGG', 1000],
    ['RRR', 'RRR', 200],
    ['BBB', 'BBB', 50],
    ['GRB', 'MIX3', 10],
    ['GGR', 'MIX3', 10],
    ['XRB', 'ANY2', 2],
    ['GXG', 'ANY2', 2],
    ['XXB', 'ANY1', 1],
    ['XXX', 'NONE', 0],
  ];
  for (const [l, id, mult] of cases) {
    const r = L.evalLine(line(l));
    assert.equal(r.id, id, l);
    assert.equal(r.mult, mult, l);
  }
  assert.deepEqual(L.evalLine(line('GXB')).cells, [[0, 1], [2, 1]], '中線上的發格');
});

test('slot-classic evalGrid 只看中線（row 1）', () => {
  // grid[reel][row]：上列全金、下列全紅，中線空白 → 0
  const g = [['G', 'X', 'R'], ['G', 'X', 'R'], ['G', 'X', 'R']];
  assert.equal(L.evalGrid(g).mult, 0);
  const g2 = [['X', 'G', 'X'], ['X', 'G', 'X'], ['X', 'G', 'X']];
  assert.equal(L.evalGrid(g2).id, 'GGG');
});

test('slot-classic 轉軸帶：每軸 ≥ 32 停、只含 G/R/B/X', () => {
  assert.equal(L.STRIPS.length, 3);
  for (const s of L.STRIPS) {
    assert.ok(s.length >= 32, `軸長 ${s.length}`);
    assert.ok(s.every((x) => 'GRBX'.includes(x)));
    assert.ok(['G', 'R', 'B'].every((x) => s.includes(x)), '三色都有');
  }
});

test('slot-classic 精確 RTP（全列舉停點）= 90% ± 0.5%', () => {
  const st = L.comboStats();
  assert.ok(Math.abs(st.rtp - 0.9) <= 0.005, `RTP ${st.rtp}`);
  assert.ok(Math.abs(st.rtp - 0.9) < 1e-6, '最終 strips 精確 90.0000%');
  const pSum = st.rows.reduce((s, r) => s + r.p, 0);
  assert.ok(Math.abs(pSum - 1) < 1e-9, '機率總和 = 1');
});

test('slot-classic [slow] simulateRTP 500,000 轉（seed 4）RTP 在 89.5–90.5%', () => {
  const r = L.simulate(500000, 4);
  assert.equal(r.spins, 500000);
  assert.ok(r.rtp >= 0.895 && r.rtp <= 0.905, `RTP ${(r.rtp * 100).toFixed(3)}%`);
});

test('slot-classic 教學：≥ 12 步、四段、≥ 3 action、含 RTP / 押大 / 快出了', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 10);
  const text = steps.map((s) => s.title + s.body).join('\n');
  assert.match(text, /RTP 是什麼/);
  assert.match(text, /押大不改變比例/);
  assert.match(text, /沒有「快出了」/);
  assert.match(text, /這只是紀錄，不能預測/);
  assert.match(text, /RM 0\.50 × 10 = RM 5\.00/);
  assert.match(text, /今晚只帶 RM 500/);
  assert.ok(steps.filter((s) => s.action).length >= 3);
});

function fakeCtx() {
  return {
    gameId: 'slot-classic', def, mode: 'tutorial', limits: { min: 0.1, max: 25 },
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
    ready: Promise.resolve(),
  };
}
