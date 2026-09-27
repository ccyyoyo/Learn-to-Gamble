// Casino Hold'em：規格 docs/05-game-rules/casino-holdem.md §7 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['casino-holdem'] });
const def = LG.games['casino-holdem'];
const { qualifies, aaEval, strategy, settle, simulate, antePayOf } = def.logic;
const P = LG.cards.parseMany;
const hand = (player, dealer, board) => ({ player: P(player), dealer: P(dealer), board: P(board) });

function fakeCtx(mode = 'tutorial') {
  const limits = LG.limitsFor(def, mode);
  return {
    gameId: def.id, def, mode, variant: null, limits, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: mode === 'real', isPractice: mode === 'practice', isTutorial: mode === 'tutorial',
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}

test('casino-holdem 註冊、houseEdge、限注', () => {
  assert.equal(def.category, 'poker-table');
  assert.equal(LG.bestEdge(def).edge, 2.16);
  assert.equal(LG.bestEdge(def).bet.en, 'Ante');
  assert.equal(def.houseEdge.find((h) => h.bet.en === 'AA Bonus').edge, 6.26);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 500 });
  assert.deepEqual(LG.limitsFor(def, 'practice'), { min: 10, max: 100000 });
  const inst = def.create(fakeCtx('real'));
  assert.deepEqual(inst.bets.limitFor('ante'), { min: 25, max: 500 });
  assert.deepEqual(inst.bets.limitFor('aa'), { min: 10, max: 100 });
  assert.equal(def.logic.DECISION_SECONDS, 30);
});

test('合格：44 合格、33 不合格、A 高不合格、兩對合格', () => {
  const q = (s) => qualifies(LG.poker.best(P(s)));
  assert.equal(q('4S 4H KD 9C 7S 2H 3C'), true, '一對 4');
  assert.equal(q('3S 3H KD 9C 7S 2H 5C'), false, '一對 3');
  assert.equal(q('AS QH JD 9C 7S 2H 3C'), false, 'A 高');
  assert.equal(q('2S 2H 3D 3C 7S 9H JC'), true, '兩對（22 33）');
  assert.equal(q('AS AH KD 9C 7S 2H 3C'), true, '一對 A');
});

test('Ante 賠付表', () => {
  const K = LG.poker.CATEGORY;
  assert.equal(antePayOf(K.ROYAL), 100);
  assert.equal(antePayOf(K.STRAIGHT_FLUSH), 20);
  assert.equal(antePayOf(K.QUADS), 10);
  assert.equal(antePayOf(K.FULL_HOUSE), 3);
  assert.equal(antePayOf(K.FLUSH), 2);
  assert.equal(antePayOf(K.STRAIGHT), 1);
  assert.equal(antePayOf(K.PAIR), 1);
  assert.equal(antePayOf(K.HIGH), 1);
});

test('結算情境一：莊不合格 → Ante 照表、Call 退回', () => {
  // 你：同花（A♥J♥ + K♥7♥2♥）；莊：一對 3 → 不合格
  const r = settle({ ante: 50 }, hand('AH JH', '8C 3D', 'KH 7H 2H 9D 3S'));
  assert.equal(r.qual, false);
  assert.equal(r.outcome, 'noqual');
  const ante = r.lines.find((l) => l.spot === 'ante'), call = r.lines.find((l) => l.spot === 'call');
  assert.deepEqual([ante.result, ante.mult, ante.pay], ['win', 2, 100]);
  assert.deepEqual([call.result, call.stake, call.pay, call.returned], ['push', 100, 0, 100]);
  assert.deepEqual([r.wagered, r.returned, r.net], [150, 250, 100]);
  assert.match(ante.formula, /RM 50 × 2 = \+RM 100（拿回 RM 150）/);
  // 莊不合格，就算莊的牌比你大也照賠（你 A 高 vs 莊一對 3）
  const r2 = settle({ ante: 50 }, hand('AS JD', '3C 8D', 'KH 7S 2C 9D 3S'));
  assert.equal(r2.outcome, 'noqual');
  assert.equal(r2.net, 50);
});

test('結算情境二：莊合格且你贏 → Ante 照表、Call 1:1', () => {
  const r = settle({ ante: 50 }, hand('KS QS', '8H 4D', 'KH 7S 2C 9D 4S'));
  assert.equal(r.qual, true);
  assert.equal(r.outcome, 'win');
  assert.deepEqual([r.wagered, r.returned, r.net], [150, 300, 150]);
  // 葫蘆 3:1
  const fh = settle({ ante: 100 }, hand('KS KD', 'QH QC', 'KH 7S 7C 9D 2S'));
  assert.equal(fh.outcome, 'win');
  assert.equal(fh.lines.find((l) => l.spot === 'ante').pay, 300);
  assert.equal(fh.net, 500);
});

test('結算情境三：莊合格且莊贏 → 兩注皆輸；平手退注', () => {
  const r = settle({ ante: 50 }, hand('QS JD', 'AC KD', 'KH 7S 2C 9D 3S'));
  assert.equal(r.outcome, 'lose');
  assert.equal(r.net, -150);
  const tie = settle({ ante: 50 }, hand('2S 3D', '2C 3H', 'AH AD KC KS QH'));
  assert.equal(tie.outcome, 'tie');
  assert.equal(tie.net, 0);
});

test('棄牌：只輸 Ante；AA 仍結算', () => {
  const r = settle({ ante: 50, aa: 10 }, hand('AS AD', 'KC KD', 'AH 7S 2C 9D 3S'), { folded: true });
  assert.equal(r.outcome, 'fold');
  assert.equal(r.lines.find((l) => l.spot === 'call'), undefined);
  const aa = r.lines.find((l) => l.spot === 'aa');
  assert.deepEqual([aa.result, aa.mult, aa.pay], ['win', 7, 70], '前 5 張三條 A → 7:1');
  assert.equal(r.net, -50 + 70);
});

test('AA 用玩家 2 張 + 翻牌 3 張評（不看轉牌/河牌）', () => {
  // 前 5 張只有一對 K；轉牌河牌才湊出一對 A → AA 輸
  let r = aaEval(P('AS KD'), P('KH 7S 2C'));
  assert.equal(r.win, false);
  const s = settle({ ante: 10, aa: 10 }, hand('AS 5D', '2C 3D', 'KH 7S 9C AD AC'));
  assert.equal(s.lines.find((l) => l.spot === 'aa').result, 'lose', '三條 A 在河牌才成，AA 不算');
  // 一對 A（前 5 張）→ 7:1；一對 K → 輸
  assert.equal(aaEval(P('AS 5D'), P('AH 7S 2C')).mult, 7);
  assert.equal(aaEval(P('KS 5D'), P('KH 7S 2C')).win, false);
  // 兩對 / 順子 7:1；同花 20；葫蘆 30；四條 40；同花順 50；皇家 100
  assert.equal(aaEval(P('7D 2S'), P('7S 2C 9H')).mult, 7);
  assert.equal(aaEval(P('8D 9S'), P('TS JC QH')).mult, 7);
  assert.equal(aaEval(P('8H 2H'), P('TH JH 4H')).mult, 20);
  assert.equal(aaEval(P('8H 8S'), P('8D JH JC')).mult, 30);
  assert.equal(aaEval(P('8H 8S'), P('8D 8C JC')).mult, 40);
  assert.equal(aaEval(P('8H 9H'), P('TH JH QH')).mult, 50);
  assert.equal(aaEval(P('AH KH'), P('TH JH QH')).mult, 100);
});

test('策略提示（規格 §4 量化版）', () => {
  const s = (h, f) => strategy(P(h), P(f)).action;
  assert.equal(s('KS QS', 'KH 7S 2C'), 'call', '配中成對');
  assert.equal(s('5S 5D', 'KH 7S 2C'), 'call', '口袋對');
  assert.equal(s('9H 4H', 'KH 7H 2C'), 'call', '4 張同花聽牌');
  assert.equal(s('9D 8S', 'TC 7H 2S'), 'call', '順子聽牌');
  assert.equal(s('9D 5S', 'KC QH 2H'), 'fold', '9-5 無對無聽 → 棄');
  assert.equal(s('TD 3S', 'KC QH 2H'), 'fold', '10-3 → 棄');
  assert.equal(s('TD 4S', 'KC QH 2H'), 'call', '10-4 → 跟');
  assert.equal(s('JD 2S', 'KC QH 5H'), 'call', 'J 以上一定跟');
  assert.equal(s('9D 5H', 'KC QH 2H'), 'call', '三張同花 +1 → 12.5 跟');
});

test('教學步驟符合規範（≥12 步、四段、≥3 action）', () => {
  const inst = def.create(fakeCtx('tutorial'));
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps, { minSteps: 12 });
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 12);
  for (const sec of ['layout', 'flow', 'payout', 'strategy']) {
    assert.match(steps.find((x) => x.section === sec).title, /這段你會學到/, `${sec} 開頭步`);
  }
  assert.ok(steps.some((x) => /No more bets/.test(x.title)), '不能碰籌碼一步');
  assert.ok(steps.some((x) => /預算/.test(x.title)), '預算一步');
});

test('[slow] Monte Carlo：照策略提示玩，Ante 優勢 1.5%–3%', () => {
  LG.rng.seed(20260927);
  const r = simulate(1500000);
  LG.rng.seed(null);
  assert.ok(r.edge > 1.5 && r.edge < 3, `edge ${r.edge.toFixed(3)}%（fold ${(r.foldRate * 100).toFixed(1)}%）`);
  assert.ok(r.foldRate > 0.1 && r.foldRate < 0.2, `fold rate ${r.foldRate}`);
});

test('[slow] AA 旁注優勢 = 6.26%（窮舉 C(52,5)）', () => {
  const deck = LG.cards.newDeck();
  let ev = 0, n = 0;
  for (let a = 0; a < 48; a++) for (let b = a + 1; b < 49; b++) for (let c = b + 1; c < 50; c++)
    for (let d = c + 1; d < 51; d++) for (let e = d + 1; e < 52; e++) {
      const r = aaEval([deck[a], deck[b]], [deck[c], deck[d], deck[e]]);
      ev += r.win ? r.mult : -1; n++;
    }
  assert.equal(n, 2598960);
  const edge = -ev / n * 100;
  assert.ok(Math.abs(edge - 6.26) < 0.01, `AA edge ${edge}`);
});
