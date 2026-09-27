// 21 點 Blackjack：規格 docs/05-game-rules/blackjack.md §9 驗收測試 + 遊戲引擎（Round）結算
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['blackjack'] });
const def = LG.games.blackjack;
const L = def.logic;
const BJ = LG.blackjack;
const P = LG.cards.parseMany;
const C = LG.cards.parse;

/** 從指定牌依序抽（抽完丟錯，避免測試偷偷用到亂數） */
const drawFrom = (s) => { const q = P(s); return () => { if (!q.length) throw new Error('rig empty'); return q.shift(); }; };
const round = (cards, bet = 50) => new L.Round({ bet, draw: drawFrom(cards) }).deal();

test('blackjack：註冊、houseEdge、限注、倒數', () => {
  assert.equal(def.category, 'table');
  assert.deepEqual(def.name, { zh: '21 點', en: 'Blackjack' });
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 0.41);
  assert.equal(best.best, true);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 50, max: 3000 });
  assert.deepEqual(LG.limitsFor(def, 'practice'), { min: 10, max: 100000 });
  assert.equal(def.countdown, 15);
});

test('value()：A+K = BJ；A+A+9 = 軟 21；K+Q+5 爆', () => {
  const bj = BJ.value(P('AS KD'));
  assert.equal(bj.blackjack, true); assert.equal(bj.total, 21);
  const s21 = BJ.value(P('AS AD 9C'));
  assert.equal(s21.total, 21); assert.equal(s21.soft, true); assert.equal(s21.blackjack, false);
  const bust = BJ.value(P('KS QD 5C'));
  assert.equal(bust.bust, true); assert.equal(bust.total, 25);
  assert.equal(L.totalText(P('AS KD')), 'BJ');
  assert.equal(L.totalText(P('AS 6D')), '7/17');
  assert.equal(L.totalText(P('AS 6D'), { final: true }), '17');
  assert.equal(L.totalText(P('KS QD 5C')), '25 爆');
});

test('基本策略表 30 個抽樣格與規格 §5 一致', () => {
  const cases = [
    // [玩家, 莊明牌, 期望]  硬牌
    ['TS 7D', 'AH', 'S'], ['TS 6D', '6H', 'S'], ['TS 6D', '7H', 'H'], ['9S 6D', 'TH', 'H'], ['9S 4D', '2H', 'S'],
    ['8S 5D', '7H', 'H'], ['TS 2D', '2H', 'H'], ['TS 2D', '4H', 'S'], ['TS 2D', '7H', 'H'], ['6S 5D', '6H', 'D'],
    ['6S 5D', 'AH', 'H'], ['6S 4D', '9H', 'D'], ['6S 4D', 'TH', 'H'], ['5S 4D', '3H', 'D'], ['5S 4D', '2H', 'H'],
    ['5S 3D', '6H', 'H'],
    // 軟牌
    ['AS 9D', '6H', 'S'], ['AS 8D', '6H', 'S'], ['AS 7D', '2H', 'S'], ['AS 7D', '5H', 'D'], ['AS 7D', '9H', 'H'],
    ['AS 6D', '3H', 'D'], ['AS 5D', '4H', 'D'], ['AS 3D', '4H', 'H'], ['AS 2D', '5H', 'D'],
    // 對子
    ['AS AD', 'TH', 'P'], ['TS KD', '6H', 'S'], ['9S 9D', '7H', 'S'], ['9S 9D', '8H', 'P'], ['8S 8D', 'AH', 'P'],
    ['7S 7D', '8H', 'H'], ['6S 6D', '6H', 'P'], ['5S 5D', '9H', 'D'], ['4S 4D', '5H', 'P'], ['3S 3D', '7H', 'P'],
    ['2S 2D', '8H', 'H'],
  ];
  assert.ok(cases.length >= 30);
  for (const [p, d, e] of cases) assert.equal(BJ.basicStrategy(P(p), C(d)), e, `${p} vs ${d}`);
  // 表格渲染列與 lib 一致
  const html = L.strategyTableHtml('hard');
  assert.match(html, /data-r="16" data-c="4">S</);
  assert.match(html, /data-r="11" data-c="9">H</);
});

test('提示文字：用 lookup() 的表名/列/欄', () => {
  assert.equal(L.advise(P('TS 6D'), C('6H')).text, '建議：停牌 Stand（表：硬牌 16 vs 6）');
  assert.equal(L.advise(P('TS 6D'), C('KH')).text, '建議：加牌 Hit（表：硬牌 16 vs 10）');
  assert.equal(L.advise(P('8S 8D'), C('AH'), { canSplit: true }).text, '建議：分牌 Split（表：對子 8,8 vs A）');
  assert.equal(L.advise(P('AS 7D'), C('9H')).text, '建議：加牌 Hit（表：軟牌 A,7 vs 9）');
  const noDbl = L.advise(P('6S 5D'), C('6H'), { canDouble: false });
  assert.equal(noDbl.code, 'H');
  assert.match(noDbl.note, /不能加倍/);
  // 分滿 4 手 → 8,8 改查硬 16
  assert.equal(L.advise(P('8S 8D'), C('TH'), { canSplit: false }).ref, '硬牌 16 vs 10');
});

test('dealerPlay（經 Round）：S17 停於 A+6；硬 16 補牌', () => {
  let r = round('TS AD 9C 6H');              // 你 T,9=19；莊 A,6 軟 17
  assert.equal(r.offerInsurance, true);
  assert.equal(r.start(), 'play');
  r.stand();
  assert.equal(r.phase, 'dealer');
  assert.deepEqual(r.playDealer(), []);       // 軟 17 停
  assert.equal(r.settle().lines[0].result, 'win');

  r = round('TS TD 9C 6H 5S');               // 莊 T,6=16 → 補 5 = 21
  r.start(); r.stand();
  assert.deepEqual(r.playDealer().map((c) => c.id), ['5S']);
  const s = r.settle();
  assert.equal(s.dealer.total, 21);
  assert.equal(s.lines[0].result, 'lose');
});

test('BJ 3:2（RM 50 → +75）；莊 BJ 對玩家 BJ = push；莊 BJ 只收原注', () => {
  let r = round('AS 9D KC 7H');
  assert.equal(r.start(), 'player-bj');
  let s = r.settle();
  assert.equal(s.lines[0].result, 'blackjack');
  assert.deepEqual([s.lines[0].pay, s.lines[0].returned, s.net], [75, 125, 75]);
  assert.equal(L.formulaOf(s.lines[0]), 'RM 50 × 1.5 = +RM 75（拿回 RM 125）');

  r = round('AS AD KC KH');                  // 雙方 BJ
  assert.equal(r.start(), 'dealer-bj');
  s = r.settle();
  assert.equal(s.lines[0].result, 'push');
  assert.equal(s.net, 0);

  r = round('9S KD 9C AH', 100);             // 莊明牌 10 偷看 → BJ，玩家 18 輸原注
  assert.equal(r.peeks, true);
  assert.equal(r.start(), 'dealer-bj');
  s = r.settle();
  assert.deepEqual([s.lines[0].result, s.net], ['lose', -100]);
});

test('保險 2:1：莊 BJ 時保險賠 2:1、主注輸（淨 0）；莊沒 BJ 保險輸', () => {
  let r = round('TS AD 9C KH');
  assert.equal(r.offerInsurance, true);
  assert.equal(r.takeInsurance(), 25);
  assert.equal(r.start(), 'dealer-bj');
  let s = r.settle();
  assert.deepEqual([s.insurance.result, s.insurance.pay, s.insurance.returned], ['win', 50, 75]);
  assert.deepEqual([s.wagered, s.returned, s.net], [75, 75, 0]);
  assert.equal(L.insFormula(s.insurance), '保險 RM 25 × 2 = +RM 50（拿回 RM 75）');

  r = round('TS AD 9C 7H 5S');                // 莊 A,7 = 軟 18 沒 BJ
  r.takeInsurance();
  assert.equal(r.start(), 'play');
  r.stand();
  r.playDealer();
  s = r.settle();
  assert.equal(s.insurance.result, 'lose');
  assert.equal(s.lines[0].result, 'win');     // 19 > 18
  assert.equal(s.net, 50 - 25);
});

test('加倍：注金 ×2、只拿一張；分牌後可加倍（DAS）', () => {
  let r = round('5S 6D 6C KH 9S TD');          // 11 vs 6 → 加倍拿 9 = 20；莊 16 補 T 爆
  r.start();
  assert.equal(r.canDouble(), true);
  r.double();
  assert.equal(r.hands[0].cards.length, 3);
  assert.equal(r.phase, 'dealer');
  r.playDealer();
  const s = r.settle();
  assert.deepEqual([s.lines[0].stake, s.lines[0].result, s.net], [100, 'win', 100]);
  assert.match(L.formulaOf(s.lines[0]), /RM 100（RM 50 \+ 加倍 RM 50） × 1 = \+RM 100（拿回 RM 200）/);

  r = round('8S 6D 8C TH 3S 9C 2D');           // 分 8,8 → 8,3 可加倍（拿 9C）；第二手拿 2D
  r.start();
  r.split();
  assert.equal(r.hands.length, 2);
  assert.equal(r.canDouble(), true);
  r.double();
  assert.equal(r.hands[0].bet, 100);
  assert.equal(r.cur, 1);
  assert.deepEqual(r.hands[1].cards.map((c) => c.id), ['8C', '2D']);   // 第二手輪到時才拿第二張
});

test('分牌最多 4 手', () => {
  const r = round('8S 6D 8C TH 8D 8H 8C 2S 3S 4S 5S');
  r.start();
  assert.equal(r.canSplit(), true); r.split();   // 2 手
  assert.equal(r.canSplit(), true); r.split();   // 3 手
  assert.equal(r.canSplit(), true); r.split();   // 4 手
  assert.equal(r.hands.length, 4);
  assert.equal(r.canSplit(), false);             // 第 4 手不能再分
  assert.equal(L.advise(r.hand.cards, r.up, { canSplit: r.canSplit() }).lk.table !== 'pairs', true);
  while (r.phase === 'play') r.stand();
  r.playDealer();
  const s = r.settle();
  assert.equal(s.lines.length, 4);
  assert.equal(s.wagered, 200);
  assert.deepEqual(s.lines.map((l) => l.spot), ['main', 'main-2', 'main-3', 'main-4']);
});

test('分 A 各一張、不能再動作；分 A 後 A+K 只賠 1:1', () => {
  const r = round('AS 9D AC 8H KD 5C');          // 分 A：A+K、A+5；莊 9,8 = 17
  r.start();
  assert.equal(r.canSplit(), true);
  r.split();
  assert.equal(r.phase, 'dealer');               // 兩手各拿一張就結束
  assert.deepEqual(r.hands.map((h) => h.cards.length), [2, 2]);
  assert.ok(r.hands.every((h) => h.splitAces && h.done));
  r.playDealer();
  const s = r.settle();
  assert.equal(s.lines[0].total, 21);
  assert.equal(s.lines[0].bj, false);
  assert.equal(s.lines[0].result, 'win');
  assert.equal(s.lines[0].pay, 50);              // 1:1，不是 3:2
  assert.equal(s.lines[1].result, 'lose');       // 16 < 17
  assert.equal(s.net, 0);
});

test('爆牌立即輸；全部爆牌時莊家不補牌', () => {
  const r = round('TS 5D 6C TH KD');             // 16 → 加牌 K 爆
  r.start();
  r.hit();
  assert.equal(r.phase, 'dealer');
  assert.equal(r.needsDealer(), false);
  assert.deepEqual(r.playDealer(), []);
  const s = r.settle();
  assert.equal(s.lines[0].result, 'lose');
  assert.equal(s.net, -50);
});

test('教學步驟符合規範（≥14 步、四段、≥3 action、5 題練習題、三張策略表）', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps, { minSteps: 14 });
  assert.deepEqual(lint.problems, []);
  const quiz = steps.filter((s) => /^strategy-quiz-/.test(s.id));
  assert.equal(quiz.length, 5);
  assert.ok(quiz.every((s) => s.action && s.section === 'strategy'));
  assert.ok(steps.filter((s) => s.action).length >= 8);
  for (const k of ['hard', 'soft', 'pairs']) assert.ok(steps.find((s) => s.id === `strategy-${k}`).body.includes('bj-strategy'));
  assert.ok(steps.some((s) => s.body.includes('背 5 條') || s.title.includes('背 5 條')));
  for (const sec of ['layout', 'flow', 'payout', 'strategy']) {
    assert.match(steps.find((s) => s.section === sec).title, /這段你會學到/);
  }
  // 練習題答案涵蓋停/加/倍/分
  assert.deepEqual(L.QUIZ.map(L.quizAnswer), ['S', 'H', 'D', 'P', 'S']);
});

test('[slow] Monte Carlo 20 萬手基本策略：莊家優勢 0.3%–0.7%', () => {
  // 20 萬手的標準誤約 0.26%，比 0.3–0.7 的區間還寬，所以固定種子讓結果可重現；下一個 200 萬手測試才是穩健的檢查。
  LG.rng.seed(1);
  const r = L.simulate(200000);
  assert.ok(r.edge >= 0.3 && r.edge <= 0.7, `edge ${r.edge.toFixed(3)}% (SE ${r.se.toFixed(3)}%)`);
  LG.rng.seed(null);
});

test('[slow] Monte Carlo 200 萬手（SE ≈ 0.08%）：莊家優勢 0.3%–0.7%', () => {
  LG.rng.seed(20260927);
  const r = L.simulate(2000000);
  assert.ok(r.edge >= 0.3 && r.edge <= 0.7, `edge ${r.edge.toFixed(3)}% (SE ${r.se.toFixed(3)}%)`);
  LG.rng.seed(null);
});

function fakeCtx() {
  return {
    gameId: 'blackjack', def, mode: 'tutorial', variant: undefined, limits: { min: 10, max: 100000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {}, close() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}
