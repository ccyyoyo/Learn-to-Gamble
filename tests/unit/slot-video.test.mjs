// slot-video：規格 docs/05-game-rules/slot-video.md §7 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['slot-video'] });
const def = LG.games['slot-video'];
const L = def.logic;

/** 三列文字 → grid[reel][row] */
const G = (top, mid, bot) => {
  const rows = [top, mid, bot].map((r) => r.trim().split(/\s+/));
  return rows[0].map((_, reel) => rows.map((r) => r[reel]));
};
const FILL_T = 'Q N K J T', FILL_B = 'KO RP J T N';

test('slot-video 註冊：houseEdge 6%（RTP 94%）、限注、不用籌碼', () => {
  assert.equal(def.category, 'slots');
  assert.equal(LG.bestEdge(def).edge, 6.0);
  assert.equal(LG.bestEdge(def).best, true);
  assert.equal(def.denoms, undefined);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 2, max: 100 });
  assert.deepEqual(L.LINE_BETS, [0.1, 0.2, 0.5, 1, 2, 5]);
});

test('slot-video 賠付表照規格', () => {
  const P = L.PAYTABLE;
  assert.deepEqual(P.CS, { 3: 50, 4: 200, 5: 1000 });
  assert.deepEqual(P.GI, { 3: 25, 4: 100, 5: 400 });
  assert.deepEqual(P.RP, { 3: 20, 4: 60, 5: 200 });
  assert.deepEqual(P.KO, { 3: 15, 4: 40, 5: 120 });
  for (const s of ['A', 'K']) assert.deepEqual(P[s], { 3: 10, 4: 25, 5: 75 });
  for (const s of ['Q', 'J']) assert.deepEqual(P[s], { 3: 5, 4: 15, 5: 50 });
  for (const s of ['T', 'N']) assert.deepEqual(P[s], { 3: 5, 4: 10, 5: 40 });
  assert.deepEqual(P.W, { 5: 1000 });
  assert.equal(P.SC, undefined, 'Scatter 不在線賠付表');
  assert.deepEqual(L.FREE_SPINS, { 3: 10, 4: 15, 5: 20 });
  assert.equal(L.SCATTER_MULT, 2);
});

test('slot-video evalLines：wild 替代', () => {
  const r = L.evalSpin(G(FILL_T, 'GI W GI A Q', FILL_B), 20, 0.1);
  assert.equal(r.wins.length, 1);
  assert.deepEqual([r.wins[0].lineNo, r.wins[0].sym, r.wins[0].count, r.wins[0].mult], [1, 'GI', 3, 25]);
  assert.equal(r.win, 2.5);
  const r5 = L.evalSpin(G(FILL_T, 'CS W W W CS', FILL_B), 1, 1);
  assert.deepEqual([r5.wins[0].sym, r5.wins[0].count, r5.win], ['CS', 5, 1000]);
});

test('slot-video evalLines：左起連續（不從第 1 軸開始不算、中斷只算前段）', () => {
  assert.equal(L.evalSpin(G(FILL_T, 'N CS CS CS CS', FILL_B), 1, 1).win, 0);
  assert.equal(L.evalSpin(G(FILL_T, 'CS CS Q CS CS', FILL_B), 1, 1).win, 0);
  const r = L.evalSpin(G(FILL_T, 'A A A Q A', FILL_B), 1, 1);
  assert.deepEqual([r.wins[0].count, r.win], [3, 10]);
});

test('slot-video evalLines：一線只取最高', () => {
  // CS 5 連（含 wild）只算 CS×5 = 1000，不會另外算 wild 或 4 連
  const r = L.evalSpin(G(FILL_T, 'CS W W W W', FILL_B), 1, 1);
  assert.equal(r.wins.length, 1);
  assert.equal(r.win, 1000);
  // 全 wild：只取 W 5 連 1000（不會同時算成其他符號）
  const w = L.evalSpin(G(FILL_T, 'W W W W W', FILL_B), 1, 1);
  assert.deepEqual([w.wins.length, w.wins[0].sym, w.win], [1, 'W', 1000]);
});

test('slot-video scatter 不算線、任意位置 3/4/5 個 → 10/15/20 次 + 總注 ×2', () => {
  const r3 = L.evalSpin(G('SC K Q N T', 'A J SC Q K', 'KO RP J A SC'), 20, 0.1);
  assert.equal(r3.scatter.count, 3);
  assert.equal(r3.freeSpins, 10);
  assert.equal(r3.scatterWin, 4, '總注 RM 2 × 2');
  assert.ok(r3.wins.every((w) => w.sym !== 'SC'), 'scatter 不算線');
  const line = L.evalSpin(G(FILL_T, 'SC SC SC SC SC', FILL_B), 1, 1);
  assert.equal(line.wins.length, 0, '一整線金幣也不算線獎');
  assert.equal(line.freeSpins, 20);
  assert.equal(L.evalSpin(G('SC K Q SC T', 'A J SC Q K', 'KO SC J A N'), 20, 1).freeSpins, 15);
  assert.equal(L.evalSpin(G('SC K Q N T', 'A J Q Q K', 'KO RP J A SC'), 20, 1).freeSpins, 0, '2 個不觸發');
});

test('slot-video 多線加總、線數影響', () => {
  const g = G('A A A K Q', 'CS CS CS N Q', FILL_B);
  const r = L.evalSpin(g, 20, 0.1);
  assert.deepEqual(r.wins.map((w) => w.lineNo).sort((a, b) => a - b), [1, 2]);
  assert.equal(r.win, 6, '50×0.10 + 10×0.10');
  assert.equal(r.bet, 2);
  const r1 = L.evalSpin(g, 1, 0.1);
  assert.equal(r1.win, 5, '只開 1 線時只算第 1 線');
  assert.equal(r1.bet, 0.1);
});

test('slot-video 轉軸帶：Wild 只在軸 2–4、每軸 Scatter 間距 ≥ 3', () => {
  const S = L.STRIPS;
  assert.equal(S.length, 5);
  assert.ok(!S[0].includes('W') && !S[4].includes('W'));
  assert.ok(S[1].includes('W') && S[2].includes('W') && S[3].includes('W'));
  for (const s of S) {
    const idx = s.map((x, i) => (x === 'SC' ? i : -1)).filter((i) => i >= 0);
    assert.ok(idx.length >= 1);
    for (let k = 0; k < idx.length; k++) {
      const a = idx[k], b = idx[(k + 1) % idx.length];
      const d = idx.length === 1 ? s.length : (b - a + s.length) % s.length;
      assert.ok(d >= 3, `scatter 間距 ${d}`);
    }
    assert.ok(s.every((x) => x in L.SYMBOLS), '符號都有定義');
  }
});

test('slot-video 精確 RTP（含免費轉）在 93.5–94.5%', () => {
  const e = L.exactRTP();
  assert.ok(e.rtp >= 0.935 && e.rtp <= 0.945, `RTP ${e.rtp}`);
  assert.ok(e.free > 0.05, '免費轉是 RTP 的一部分');
});

test('slot-video [slow] simulateRTP 500,000 轉（含免費轉，seed 123）RTP 在 93.5–94.5%', () => {
  const r = L.simulate(500000, 123);
  assert.ok(r.rtp >= 0.935 && r.rtp <= 0.945, `RTP ${(r.rtp * 100).toFixed(3)}%`);
});

test('slot-video e2e 用 seed 1：第一轉觸發免費轉', () => {
  LG.rng.seed(1);
  const r = L.evalSpin(LG.slots.spin(L.STRIPS, 3), 20, 0.1);
  LG.rng.seed(null);
  assert.ok(r.freeSpins >= 10);
});

test('slot-video 教學：≥ 12 步、四段、≥ 3 action、關鍵觀念', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  const text = steps.map((s) => s.title + s.body).join('\n');
  for (const re of [/RTP 是什麼/, /押大不改變比例/, /沒有「快出了」/, /× 每線注/, /50 × RM 0\.10 = RM 5\.00/, /免費轉不是「賺」/, /別追損/, /今晚只帶 RM 500/]) assert.match(text, re);
});

function fakeCtx() {
  return {
    gameId: 'slot-video', def, mode: 'tutorial', limits: { min: 0.1, max: 100 },
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
    ready: Promise.resolve(),
  };
}
