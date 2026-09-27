// slot-progressive：輪盤格組成（非最大注沒有 GRAND）/ 觸發 / 按比例派彩 / 四級獎池成長與回種子 / RTP / 教學規範
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['slot-progressive'] });
const def = LG.games['slot-progressive'];
const L = def.logic;
const near = (a, b, eps = 1e-6) => Math.abs(a - b) < eps;
const count = (arr) => arr.reduce((m, x) => { m[x] = (m[x] || 0) + 1; return m; }, {});

test('slot-progressive 註冊：老虎機、無籌碼盤、優勢 8%、最大注 RM 100', () => {
  assert.equal(def.category, 'slots');
  assert.equal(def.denoms, undefined);
  assert.equal(LG.bestEdge(def).edge, 8.0);
  assert.equal(L.MAX_BET, 100);
  assert.deepEqual(L.SEEDS, LG.store.JACKPOT_SEEDS['slot-progressive']);
  assert.ok(L.STRIPS.every((s) => s.filter((x) => x === 'JP').length >= 1 && s.filter((x) => x === 'JP').length <= 2), '每軸 1–2 個 JACKPOT');
});

test('輪盤 12 格：最大注 MINI 6 / MINOR 4 / MAJOR 1 / GRAND 1；非最大注沒有 GRAND（GRAND 格變 MAJOR）', () => {
  assert.deepEqual(count(L.wheelSegments(true)), { grand: 1, mini: 6, minor: 4, major: 1 });
  const nm = L.wheelSegments(false);
  assert.equal(nm.length, 12);
  assert.deepEqual(count(nm), { major: 2, mini: 6, minor: 4 });
  assert.equal(L.isMaxBet(100), true);
  assert.equal(L.isMaxBet(40), false);
});

test('觸發：3 個 JACKPOT（任意位置）轉輪盤，2 個不轉；JACKPOT 不賠線', () => {
  assert.equal(L.isTrigger(L.demoGrid(2)), false);
  assert.equal(L.isTrigger(L.demoGrid(3)), true);
  const pools = { ...L.SEEDS };
  assert.equal(L.playSpin({ bet: 2, lineBet: 0.1, pools, grid: L.demoGrid(2) }).wheel, null);
  const jpRow = [['JP', 'A', 'K'], ['JP', 'Q', 'J'], ['JP', 'T', 'N'], ['A', 'K', 'Q'], ['J', 'T', 'N']];
  assert.equal(L.evalBase(jpRow, 1).win, 0);
});

test('派彩：最大注全額；非最大注 GRAND 格 → MAJOR 且按 總注 ÷ RM 100 支付', () => {
  const pools = { mini: 20, minor: 50, major: 600, grand: 12345 };
  const max = L.playSpin({ bet: 100, lineBet: 5, pools, grid: L.demoGrid(3), segment: 0 });
  assert.equal(max.wheel.level, 'grand');
  assert.equal(max.wheel.prize, 12345);
  const low = L.playSpin({ bet: 2, lineBet: 0.1, pools, grid: L.demoGrid(3), segment: 0 });
  assert.equal(low.wheel.level, 'major');
  assert.equal(low.wheel.prize, 12);          // 600 × 2%
  assert.equal(L.jackpotPrize('mini', pools, 40), 8);
  assert.ok(near(L.wheelEV(100), (6 * 20 + 4 * 50 + 500 + 10000) / 12));
});

test('四級獎池：每轉成長 0.5% / 0.5% / 0.8% / 1.2%，中獎該級回種子（LG.store）', () => {
  L.jackpots.reset();
  L.jackpots.grow(100);
  let j = L.jackpots.get();
  assert.ok(near(j.mini, 20.5) && near(j.minor, 50.5) && near(j.major, 500.8) && near(j.grand, 10001.2), JSON.stringify(j));
  L.jackpots.grow(2);   // 非最大注也貢獻
  j = L.jackpots.get();
  assert.ok(near(j.mini, 20.51) && near(j.grand, 10001.224), JSON.stringify(j));
  assert.ok(near(LG.store.get().jackpots['slot-progressive'].major, 500.816), '存進 LG.store');
  L.jackpots.claim('grand');
  j = L.jackpots.get();
  assert.equal(j.grand, 10000);
  assert.ok(near(j.major, 500.816), '其他級不受影響');
  L.jackpots.claim('mini');
  assert.equal(L.jackpots.get().mini, 20);
});

test('精確 RTP：最大注 92% ± 0.3%；非最大注更低；觸發約 1/150', () => {
  const max = L.exactRTP();
  assert.ok(Math.abs(max.total - 0.92) < 0.003, `RTP ${max.total}`);
  assert.ok(max.trigger > 1 / 180 && max.trigger < 1 / 120, `觸發 1/${1 / max.trigger}`);
  const low = L.exactRTP({ bet: 2 });
  assert.ok(low.total < max.total - 0.04, `非最大注 ${low.total}`);
  assert.ok(Math.abs(L.exactRTP({ bet: 40 }).total - low.total) < 1e-9, '所有非最大注 RTP 相同');
  // 教學/賠付表引用的常數與精確值一致
  const inst = def.create(fakeCtx());
  const txt = inst.tutorialSteps().map((s) => s.body).join(' ');
  assert.ok(txt.includes(`≈${(low.total * 100).toFixed(1)}%`), '非最大注 RTP 文案');
  assert.ok(txt.includes(Math.round(12 / max.trigger).toLocaleString('en-US')), 'GRAND 平均轉數文案');
});

test('[slow] simulateRTP 200k 轉（最大注，獎池取種子期望）RTP 91.5–92.5%', () => {
  LG.rng.seed(5);
  const r = LG.slots.simulateRTP(L.rtpConfig(), 200000);
  assert.ok(r.rtp >= 0.915 && r.rtp <= 0.925, `RTP ${r.rtp}`);
});

test('教學步驟符合規範，且講「要玩就一定最大注」', () => {
  const steps = def.create(fakeCtx()).tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 12);
  assert.ok(steps.some((s) => s.section === 'strategy' && /要玩就一定最大注/.test(s.title) && s.action));
  assert.ok(steps.some((s) => /預算/.test(s.title)));
});

function fakeCtx() {
  return {
    gameId: 'slot-progressive', def, mode: 'tutorial', limits: { min: 2, max: 100 }, bank: LG.bank, stats: LG.stats,
    hints: false, isReal: false, isPractice: false, isTutorial: true, ready: Promise.resolve(),
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}
