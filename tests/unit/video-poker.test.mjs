// 視訊撲克 Jacks or Better 9/6：賠付表、15 條持牌策略、期望值、教學規範、Monte Carlo RTP。
// 規格：docs/05-game-rules/video-poker.md §7 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['video-poker'] });
const def = LG.games['video-poker'];
const L = def.logic;
const P = (s) => LG.cards.parseMany(s);

test('video-poker 註冊：分類、無籌碼盤、限注、houseEdge', () => {
  assert.equal(def.category, 'slots');
  assert.equal(def.denoms, undefined, '不用籌碼盤');
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 0.2, max: 25 });
  assert.deepEqual(L.COIN_VALUES, [0.2, 0.5, 1, 2, 5]);
  assert.equal(L.MAX_COINS, 5);
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 0.46);
  assert.equal(best.best, true);
});

// ---------------------------------------------------------------- 賠付表 9 × 2
const PAY_CASES = [
  ['royal', 'TS JS QS KS AS', 250, 4000],
  ['sf', '9H TH JH QH KH', 50, 250],
  ['quads', '7C 7D 7H 7S 2D', 25, 125],
  ['fh', 'KC KD KH 4S 4D', 9, 45],
  ['flush', '2D 5D 8D JD KD', 6, 30],
  ['straight', 'AS 2D 3C 4H 5S', 4, 20],
  ['trips', '9C 9D 9H 4S 2D', 3, 15],
  ['twopair', '5C 5D 8H 8S AD', 2, 10],
  ['jacks', 'JC JD 4H 7S 9D', 1, 5],
];
for (const [key, hand, one, five] of PAY_CASES) {
  test(`賠付表 ${key}：1 枚 ${one}、5 枚 ${five}`, () => {
    const c = P(hand);
    assert.equal(L.handKey(c), key);
    const p1 = L.payout(c, 1), p5 = L.payout(c, 5);
    assert.equal(p1.coinsWon, one, '1 枚');
    assert.equal(p5.coinsWon, five, '5 枚');
    assert.equal(p1.key, key);
  });
}

test('賠付表：皇家 1–4 枚每枚 250、5 枚 4000；其他牌型照比例', () => {
  assert.deepEqual([1, 2, 3, 4, 5].map((c) => L.coinsWon('royal', c)), [250, 500, 750, 1000, 4000]);
  assert.deepEqual([1, 2, 3, 4, 5].map((c) => L.coinsWon('fh', c)), [9, 18, 27, 36, 45]);
  assert.equal(L.PAYTABLE.length, 9);
});

test('未中獎：10 以下一對、高牌', () => {
  assert.equal(L.handKey(P('TC TD 4H 7S 9D')), null);
  assert.equal(L.payout(P('AS KD 7C 4H 2S'), 5).coinsWon, 0);
  assert.equal(L.handKey(P('QC QD 4H 7S 9D')), 'jacks');
});

// ---------------------------------------------------------------- 15 條持牌策略
const STRAT_CASES = [
  // [規則, 手牌, 建議留的 index]
  [1, 'TS JS QS KS AS', [0, 1, 2, 3, 4]],          // 皇家
  [1, '7C 7D 7H 7S 2D', [0, 1, 2, 3, 4]],          // 四條全留
  [2, 'AS KS QS JS 2D', [0, 1, 2, 3]],             // 規格例：留四張
  [2, 'TS JS QS KS KD', [0, 1, 2, 3]],             // 拆高對
  [2, 'TD JD QD KD 3D', [0, 1, 2, 3]],             // 拆同花
  [3, 'KC KD KH 4S 4D', [0, 1, 2, 3, 4]],          // 葫蘆
  [3, 'AS 2D 3C 4H 5S', [0, 1, 2, 3, 4]],          // 順
  [3, '9C 9D 9H 4S 2D', [0, 1, 2]],                // 三條留三張
  [4, 'AC 2C 3C 4C 9H', [0, 1, 2, 3]],             // 四張同花順聽（A 當 1）
  [4, '5H 6H 7H 8H 8C', [0, 1, 2, 3]],             // 同花順聽 > 低對
  [5, '5C 5D 8H 8S AD', [0, 1, 2, 3]],
  [6, 'KH KD 5C 7S 9D', [0, 1]],                   // 規格例：留 KK
  [6, 'QH QD 4H 7H 9H', [0, 1]],                   // 高對 > 四張同花聽
  [7, 'QS KS AS 7D 2C', [0, 1, 2]],
  [7, 'TH JH QH 3H 8C', [0, 1, 2]],                // 三張皇家順聽 > 四張同花聽
  [8, '4H 7H 9H QH 4C', [0, 1, 2, 3]],             // 四張同花聽 > 低對
  [9, '8H 8C KD QS 3H', [0, 1]],                   // 低對 > 兩張高牌
  [10, '2C 3D 4H 5S 9C', [0, 1, 2, 3]],
  [10, '9C TD JH QS 2C', [0, 1, 2, 3]],            // 兩頭順 > 兩張高牌
  [11, 'JH QH KD 7C 2S', [0, 1]],
  [12, '5S 6S 8S KD 2C', [0, 1, 2]],               // 三張同花順聽 > 一張高牌
  [13, 'JS QH KD 7C 2S', [0, 1]],                  // 三張高牌留最低兩張
  [13, 'AH KD QC 7S 2C', [1, 2]],
  [13, 'JC QD KH AS 3C', [0, 1]],                  // JQKA 不是兩頭順
  [14, 'KD 9S 6C 4H 2S', [0]],
  [15, '9S 8D 5C 3H 2H', []],
];
for (const [n, hand, hold] of STRAT_CASES) {
  test(`策略第 ${n} 條：${hand} → 留 [${hold}]`, () => {
    const s = L.suggestHold(P(hand));
    assert.equal(s.n, n, `規則（${s.rule}）`);
    assert.deepEqual(s.hold, hold);
    assert.equal(typeof s.rule, 'string');
    assert.ok(s.rule.length > 0);
  });
}

test('策略 15 條每條都有測資', () => {
  const covered = new Set(STRAT_CASES.map((x) => x[0]));
  for (let n = 1; n <= 15; n++) assert.ok(covered.has(n), `第 ${n} 條`);
});

test('提示文字：建議留 A K Q J（四張皇家順聽）', () => {
  assert.equal(L.hintText(P('AS KS QS JS 2D')), '建議留 A K Q J（四張皇家順聽）');
  assert.match(L.hintText(P('9S 8D 5C 3H 2H')), /全部換掉/);
});

test('classifyHold：把玩家留法對應到策略表', () => {
  const c = P('TS JS QS KS KD');
  assert.equal(L.classifyHold(c, [3, 4]).n, 6);       // 留 KK = 高對
  assert.equal(L.classifyHold(c, [0, 1, 2, 3]).n, 2); // 四張皇家順聽
  assert.equal(L.classifyHold(c, [0, 4]), null);      // 不在表上
});

test('evHold：精確期望值', () => {
  assert.equal(L.evHold(P('TS JS QS KS AS'), [0, 1, 2, 3, 4]), 800);
  // 四張皇家順聽（A K Q J 黑桃）：皇家 1 張、同花 8 張、順 3 張、高對 12 張
  const e = L.evHold(P('AS KS QS JS 2D'), [0, 1, 2, 3]);
  assert.ok(Math.abs(e - (800 + 8 * 6 + 3 * 4 + 12) / 47) < 1e-12, String(e));
  const jj = L.evHold(P('JC JD 4H 7S 9D'), [0, 1]);
  assert.ok(jj > 1.5 && jj < 1.6, 'J 對期望值約 1.54：' + jj);
  // 拆 KK 追皇家比留 KK 好
  const c = P('TS JS QS KS KD');
  assert.ok(L.evHold(c, [0, 1, 2, 3]) > L.evHold(c, [3, 4]));
  assert.equal(L.evHold(P('9S 8D 5C 3H 2H'), []), null, '全換不算');
});

// ---------------------------------------------------------------- 教學規範
function fakeCtx() {
  return {
    gameId: 'video-poker', def, mode: 'tutorial', variant: null, limits: { min: 0.2, max: 25 }, denoms: [],
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true, ready: Promise.resolve(),
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}

test('教學步驟符合規範（≥12 步、四段、≥3 action、3 題互動）', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps);
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 12);
  const quiz = steps.filter((s) => s.section === 'strategy' && s.action);
  assert.ok(quiz.length >= 3, '策略段 3 題互動');
  const ids = steps.map((s) => s.id);
  for (const id of ['layout-paytable', 'layout-royal', 'layout-hold', 'strategy-max', 'strategy-96', 'strategy-table', 'payout-jacks']) assert.ok(ids.includes(id), id);
  const tables = steps.filter((s) => /^strategy-table/.test(s.id));
  assert.equal(tables.map((t) => (t.body.match(/<li>/g) || []).length).reduce((a, b) => a + b, 0), 15, '策略表 15 條（分兩步）');
  for (const t of tables) assert.ok(t.body.replace(/<[^>]+>/g, '').replace(/[\x00-\x7f]/g, '').length <= 80, `${t.id} ≤ 80 字`);
});

// ---------------------------------------------------------------- Monte Carlo RTP
// 20 萬手隨機發牌，照 suggestHold 留牌，5 枚賠付表。為讓 20 萬手的估計夠穩（純抽樣標準誤約 0.8%，
// 比 99.0–99.8% 的區間還寬），用標準的變異數縮減，估計的仍是同一個 RTP：
//  1) 依發牌牌型分層（各牌型的精確機率已知）；皇家/同花順/四條發到即全留，值固定。
//  2) 換 ≤ 2 張時精確列舉；換 ≥ 3 張時抽 16 次換牌取平均，皇家同花順改用精確機率（控制變數）。
// 預期約 99.4%（簡化策略；最佳策略 99.54%），標準誤約 0.1%。
test('[slow] Monte Carlo 20 萬手用策略：RTP 99.0–99.8%', (t) => {
  LG.rng.seed(20260927);
  const N = 200000, M = 16;
  const COUNT = { 9: 4, 8: 36, 7: 624, 6: 3744, 5: 5108, 4: 10200, 3: 54912, 2: 123552, 11: 337920, 1: 760320, 0: 1302540 };
  const FIXED = { 9: 800, 8: 50, 7: 25 };
  const ROYAL = ['T', 'J', 'Q', 'K', 'A'];
  const C = (n, k) => { let r = 1; for (let i = 0; i < k; i++) r = (r * (n - i)) / (i + 1); return r; };
  const pRoyal = (dealt, hold) => {
    const held = hold.map((i) => dealt[i]);
    const gone = new Set(dealt.map((c) => c.id));
    let ways = 0;
    for (const s of 'SHDC') {
      if (!held.every((c) => c.suit === s && ROYAL.includes(c.rank))) continue;
      const need = ROYAL.map((r) => r + s).filter((id) => !held.some((c) => c.id === id));
      if (need.every((id) => !gone.has(id))) ways++;
    }
    return ways / C(47, 5 - hold.length);
  };
  const deck = LG.cards.newDeck();
  const acc = {};
  const hand = new Array(5);
  const rnd = () => LG.rng.random();
  for (let n = 0; n < N; n++) {
    for (let k = 0; k < 5; k++) { const j = k + Math.floor(rnd() * (52 - k)); const t = deck[k]; deck[k] = deck[j]; deck[j] = t; }
    const dealt = deck.slice(0, 5);
    const ev = LG.poker.eval5(dealt);
    let st = ev.cat;
    if (st === 1 && ev.ranks[0] >= 11) st = 11;
    const a = (acc[st] = acc[st] || [0, 0]);
    a[0]++;
    if (FIXED[st] !== undefined) { a[1] += FIXED[st]; continue; }
    const s = L.suggestHold(dealt);
    const k = 5 - s.hold.length;
    if (k <= 2) { a[1] += L.evHold(dealt, s.hold, { maxDraw: 2 }); continue; }
    let sum = 0;
    for (let m = 0; m < M; m++) {
      for (let d = 0; d < k; d++) { const j = 5 + d + Math.floor(rnd() * (47 - d)); const t = deck[5 + d]; deck[5 + d] = deck[j]; deck[j] = t; }
      let q = 5;
      for (let i = 0; i < 5; i++) hand[i] = s.hold.includes(i) ? dealt[i] : deck[q++];
      const key = L.handKey(hand);
      if (key && key !== 'royal') sum += L.perCoin(key, 5);
    }
    a[1] += sum / M + 800 * pRoyal(dealt, s.hold);
  }
  let rtp = 0;
  for (const [st, c] of Object.entries(COUNT)) {
    const a = acc[st];
    const mean = a && a[0] ? a[1] / a[0] : FIXED[st];
    rtp += (c / 2598960) * mean;
  }
  rtp *= 100;
  t.diagnostic(`RTP ${rtp.toFixed(3)}%（${N} 手）`);
  assert.ok(rtp >= 99.0 && rtp <= 99.8, `RTP ${rtp.toFixed(3)}%`);
});
