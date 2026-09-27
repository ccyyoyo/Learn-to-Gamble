// slot-holdspin：觸發 / 再轉重置 / 填滿 GRAND / 面額加總 / 獎池成長與回種子 / RTP（精確 + [slow] 模擬）/ 教學規範
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['slot-holdspin'] });
const def = LG.games['slot-holdspin'];
const L = def.logic;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;

/** 依計畫落球：plan[i] = 第 i 次再轉落下幾顆（每顆面額 value） */
function scripted(plan, startHeld, value = 1) {
  let held = startHeld, round = 0, callsLeft = 15 - startHeld, landed = 0;
  return () => {
    if (callsLeft === 0) { held += landed; round += 1; callsLeft = 15 - held; landed = 0; }
    callsLeft -= 1;
    if (landed < (plan[round] || 0)) { landed += 1; return value; }
    return null;
  };
}
const orbsOf = (n, values = [1]) => {
  const cells = [];
  for (let r = 0; r < 5; r++) for (let y = 0; y < 3; y++) cells.push([r, y]);
  return cells.slice(0, n).map((cell, i) => ({ cell, value: values[i % values.length] }));
};

test('slot-holdspin 註冊：老虎機、無籌碼盤、優勢 5.5%', () => {
  assert.equal(def.category, 'slots');
  assert.equal(def.denoms, undefined);
  assert.equal(LG.bestEdge(def).edge, 5.5);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 2, max: 100 });
  assert.equal(L.LINES.length, 20);
  assert.deepEqual(L.SEEDS, LG.store.JACKPOT_SEEDS['slot-holdspin']);
});

test('觸發：6 顆金球觸發，5 顆不觸發（金球不賠線）', () => {
  assert.equal(L.isTrigger(6), true);
  assert.equal(L.isTrigger(5), false);
  const jp = { major: 500, grand: 5000 };
  const g5 = L.demoGrid(5), g6 = L.demoGrid(6);
  assert.equal(L.orbList(g5, g5.vals).length, 5);
  LG.rng.seed(1);
  assert.equal(L.playSpin({ bet: 2, lineBet: 0.1, jp, grid: g5 }).feature, null);
  const out = L.playSpin({ bet: 2, lineBet: 0.1, jp, grid: g6 });
  assert.ok(out.feature, '6 顆 → Hold & Spin');
  assert.ok(out.feature.orbs.length >= 6);
  // 金球不賠線：整排金球不算連線
  const allOrb = [['ORB', 'ORB', 'ORB'], ['ORB', 'A', 'K'], ['ORB', 'Q', 'J'], ['A', 'K', 'Q'], ['J', 'T', 'N']];
  assert.equal(L.evalBase(allOrb, 1).win, 0);
});

test('再轉計數：有新球重置為 3、沒新球 −1、3 次沒球結束', () => {
  let r = L.runHoldSpin(orbsOf(6), scripted([], 6));
  assert.deepEqual(r.rounds.map((x) => x.left), [2, 1, 0], '一直沒新球 → 3 次後結束');
  assert.equal(r.orbs.length, 6);
  assert.equal(r.full, false);

  r = L.runHoldSpin(orbsOf(6), scripted([1, 0, 0, 2, 0, 0, 0], 6));
  assert.deepEqual(r.rounds.map((x) => x.left), [3, 2, 1, 3, 2, 1, 0], '第 1、4 次有新球 → 重置為 3');
  assert.deepEqual(r.rounds.map((x) => x.reset), [true, false, false, true, false, false, false]);
  assert.equal(r.orbs.length, 9);

  r = L.runHoldSpin(orbsOf(6), scripted([0, 0, 1, 0, 0, 0], 6));
  assert.deepEqual(r.rounds.map((x) => x.left), [2, 1, 3, 2, 1, 0], '剩 1 次時落球也重置為 3');
});

test('15 格全滿 → GRAND（並立即結束）', () => {
  const r = L.runHoldSpin(orbsOf(6), () => 2);
  assert.equal(r.full, true);
  assert.equal(r.rounds.length, 1);
  assert.equal(r.orbs.length, 15);
  const f = L.featureTotal(r.orbs, r.full, 2, { major: 500, grand: 5123.45 });
  assert.equal(f.grand, 5123.45);
  assert.equal(f.total, 6 * 2 + 9 * 4 + 5123.45);
  assert.deepEqual(f.claims, ['grand']);
  // 14 顆不算全滿
  const r14 = L.runHoldSpin(orbsOf(14), scripted([], 14));
  assert.equal(r14.full, false);
  assert.equal(L.featureTotal(r14.orbs, r14.full, 2, { major: 500, grand: 5000 }).grand, 0);
});

test('面額加總：8 顆 ×1 ×2 ×5 ×1 ×3 ×2 ×10 ×1，總注 RM 2 = RM 50；MINOR = 總注 × 50', () => {
  const f = L.featureTotal(orbsOf(8, [1, 2, 5, 1, 3, 2, 10, 1]), false, 2, { major: 500, grand: 5000 });
  assert.equal(f.total, 50);
  assert.deepEqual(f.parts.map((p) => p.amount), [2, 4, 10, 2, 6, 4, 20, 2]);
  const m = L.featureTotal(orbsOf(6, [1, 'MINOR', 'MAJOR', 'MAJOR', 50, 25]), false, 4, { major: 1234.5, grand: 10000 });
  // 1×4 + 50×4 + MAJOR 1234.5 + 第二顆 MAJOR 以種子（500 × 4/2 = 1000）+ 50×4 + 25×4
  assert.equal(m.total, 4 + 200 + 1234.5 + 1000 + 200 + 100);
  assert.deepEqual(m.claims, ['major', 'major']);
});

test('獎池：成長比例、依總注換算、MAJOR / GRAND 領取後回種子（LG.store）', () => {
  L.jackpots.reset();
  assert.deepEqual(L.jackpots.at(2), { minor: 100, major: 500, grand: 5000 });
  assert.deepEqual(L.jackpots.at(10), { minor: 500, major: 2500, grand: 25000 });
  L.jackpots.grow(2);
  let a = L.jackpots.at(2);
  assert.ok(near(a.major, 500.01) && near(a.grand, 5000.02), JSON.stringify(a));   // 總注 × 0.5% / × 1%
  const b10 = L.jackpots.at(10);
  L.jackpots.grow(10);
  a = L.jackpots.at(10);
  assert.ok(near(a.major - b10.major, 0.05) && near(a.grand - b10.grand, 0.1), '該注額看到的成長 = 總注 × 0.5% / 1%');
  const stored = LG.store.get().jackpots['slot-holdspin'];
  assert.ok(stored.major > 500 && stored.grand > 5000, '存進 LG.store');
  L.jackpots.claim('major');
  assert.equal(L.jackpots.get().major, 500, 'MAJOR 回種子');
  assert.ok(L.jackpots.get().grand > 5000, 'GRAND 不受影響');
  L.jackpots.claim('grand');
  assert.deepEqual(L.jackpots.get(), { major: 500, grand: 5000 });
});

test('金球面額分佈照規格', () => {
  LG.rng.seed(3);
  const n = 200000, cnt = {};
  for (let i = 0; i < n; i++) { const v = L.drawOrbValue(); cnt[v] = (cnt[v] || 0) + 1; }
  for (const [v, p] of L.ORB_DIST) assert.ok(Math.abs((cnt[v] || 0) / n * 100 - p) < 0.35, `${v}: ${(cnt[v] || 0) / n * 100} vs ${p}`);
});

test('精確 RTP = 94.5% ± 0.1%（線獎 + Hold & Spin + GRAND，獎池種子值）', () => {
  const r = L.exactRTP();
  assert.ok(Math.abs(r.total - 0.945) < 0.001, `RTP ${r.total}`);
  assert.ok(r.trigger > 1 / 400 && r.trigger < 1 / 200, `觸發率 1/${1 / r.trigger}`);
  const fd = L.finalDist(6);
  assert.ok(near(fd.reduce((s, x) => s + x, 0), 1, 1e-9), '最終球數分佈總和 1');
});

test('Hold & Spin 模擬與馬可夫鏈精確值一致', () => {
  LG.rng.seed(11);
  const N = 40000;
  let sumK = 0, full = 0;
  for (let i = 0; i < N; i++) { const r = L.runHoldSpin(orbsOf(6)); sumK += r.orbs.length; if (r.full) full++; }
  const fd = L.finalDist(6);
  const eK = fd.reduce((s, x, i) => s + x * i, 0);
  assert.ok(Math.abs(sumK / N - eK) < 0.05, `${sumK / N} vs ${eK}`);
  assert.ok(Math.abs(full / N - fd[15]) < 0.004, `${full / N} vs ${fd[15]}`);
});

test('[slow] simulateRTP 200k 轉（含 Hold & Spin 模擬）RTP 94–95%', () => {
  LG.rng.seed(8);
  const r = LG.slots.simulateRTP(L.rtpConfig(), 200000);
  assert.ok(r.rtp >= 0.94 && r.rtp <= 0.95, `RTP ${r.rtp}`);
});

test('教學步驟符合規範（≥12 步、四段、≥3 action）', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 12);
  ['layout', 'flow', 'payout', 'strategy'].forEach((s) => assert.match(steps.find((x) => x.section === s).title, /這段你會學到/));
  assert.ok(steps.some((s) => /預算/.test(s.title)));
});

function fakeCtx() {
  return {
    gameId: 'slot-holdspin', def, mode: 'tutorial', limits: { min: 2, max: 100 }, bank: LG.bank, stats: LG.stats,
    hints: false, isReal: false, isPractice: false, isTutorial: true, ready: Promise.resolve(),
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}

test('教學引用的 GRAND 頻率與精確值一致', () => {
  assert.equal(L.GRAND_ONE_IN, Math.round(1 / L.exactRTP().pFull));
});
