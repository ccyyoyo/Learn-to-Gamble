// Ultimate Texas Hold'em：規格 docs/05-game-rules/ultimate-holdem.md §7 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['ultimate-holdem'] });
const def = LG.games['ultimate-holdem'];
const L = def.logic;
const P = LG.cards.parseMany;
const hand = (player, dealer, board) => ({ player: P(player), dealer: P(dealer), board: P(board) });
const byId = (r, spot) => r.lines.find((l) => l.spot === spot);

function fakeCtx(mode = 'tutorial') {
  const limits = LG.limitsFor(def, mode);
  return {
    gameId: def.id, def, mode, variant: null, limits, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: mode === 'real', isPractice: mode === 'practice', isTutorial: mode === 'tutorial',
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}

test('ultimate-holdem 註冊、houseEdge、限注', () => {
  assert.equal(def.category, 'poker-table');
  assert.equal(LG.bestEdge(def).edge, 2.19);
  assert.equal(def.houseEdge.filter((h) => h.best).length, 1);
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 25, max: 500 });
  const inst = def.create(fakeCtx('real'));
  assert.deepEqual(inst.bets.limitFor('ante'), { min: 25, max: 500 });
  assert.deepEqual(inst.bets.limitFor('blind'), { min: 25, max: 500 });
  assert.deepEqual(inst.bets.limitFor('trips'), { min: 10, max: 100 });
  assert.equal(L.STAGE_SECONDS, 30);
  assert.deepEqual(L.TIMEOUT_ACTION, { preflop: 'check', flop: 'check', river: 'fold' });
});

test('Blind 自動與 Ante 同額', () => {
  const inst = def.create(fakeCtx('practice'));
  const b = inst.bets;
  b.place('ante', 25);
  assert.equal(b.get('blind'), 25);
  b.place('ante', 25);
  assert.equal(b.get('blind'), 50);
  b.remove('ante', 25);
  assert.equal(b.get('blind'), 25);
  b.place('trips', 10);
  assert.equal(b.total(), 60);
  b.lock();
  b.set('play', 100);                   // 加注時不影響 Blind
  assert.equal(b.get('blind'), 25);
  b.unlock(); b.clear();
  assert.equal(b.total(), 0);
});

test('狀態機：raise 後不可再 raise；河牌只能 1× 或 Fold', () => {
  let f = L.createFlow();
  assert.deepEqual(f.allowed(), ['check', 'raise3', 'raise4']);
  assert.equal(f.act('raise4'), 'showdown');
  assert.equal(f.play, 4);
  assert.equal(f.raisedAt, 'preflop');
  assert.deepEqual(f.allowed(), []);
  assert.throws(() => f.act('raise2'), /ILLEGAL/);
  assert.throws(() => f.act('raise1'), /ILLEGAL/);

  f = L.createFlow();
  assert.equal(f.act('check'), 'flop');
  assert.deepEqual(f.allowed(), ['check', 'raise2']);
  assert.throws(() => f.act('raise4'), /ILLEGAL/, '翻牌後不能 4×');
  assert.equal(f.act('raise2'), 'showdown');
  assert.equal(f.play, 2);
  assert.throws(() => f.act('raise1'), /ILLEGAL/);

  f = L.createFlow();
  f.act('check'); f.act('check');
  assert.equal(f.stage, 'river');
  assert.deepEqual(f.allowed(), ['fold', 'raise1']);
  assert.throws(() => f.act('check'), /ILLEGAL/, '河牌不能過牌');
  assert.throws(() => f.act('raise2'), /ILLEGAL/);
  f.act('fold');
  assert.equal(f.folded, true);
  assert.equal(f.play, 0);
  assert.equal(f.stage, 'showdown');

  f = L.createFlow();
  assert.throws(() => f.act('fold'), /ILLEGAL/, '翻牌前不能棄牌');
});

test('結算：莊不合格且玩家順 → Ante push、Play +1、Blind +1', () => {
  const r = L.settle({ ante: 50, blind: 50, play: 100 }, hand('9S 8D', 'AC 4H', 'TH 7C 6S 2D KH'), { playMult: 2 });
  assert.equal(r.qual, false);
  assert.equal(r.outcome, 'win');
  assert.deepEqual([byId(r, 'ante').result, byId(r, 'ante').pay], ['push', 0]);
  assert.deepEqual([byId(r, 'play').result, byId(r, 'play').mult, byId(r, 'play').pay], ['win', 1, 100]);
  assert.deepEqual([byId(r, 'blind').result, byId(r, 'blind').mult, byId(r, 'blind').pay], ['win', 1, 50]);
  assert.deepEqual([r.wagered, r.returned, r.net], [200, 350, 150]);
});

test('結算：Blind 表、莊合格、莊贏、平手、棄牌', () => {
  // 你贏一對：Ante 1:1、Play 1:1、Blind 退回
  let r = L.settle({ ante: 50, play: 200 }, hand('AS KD', '9C 9H', 'KS 7D 2C 5H JS'), { playMult: 4 });
  assert.deepEqual([byId(r, 'ante').pay, byId(r, 'play').pay, byId(r, 'blind').result], [50, 200, 'push']);
  assert.equal(r.net, 250);
  // 同花 3:2
  r = L.settle({ ante: 100, play: 100 }, hand('AH 3H', 'KC KD', 'QH 9H 2H 5S 8C'));
  assert.deepEqual([byId(r, 'blind').mult, byId(r, 'blind').pay], [1.5, 150]);
  // 葫蘆 3:1、四條 10:1、同花順 50:1、皇家 500:1
  assert.equal(byId(L.settle({ ante: 10, play: 10 }, hand('KS KD', 'QH QC', 'KH 7S 7C 9D 2S')), 'blind').mult, 3);
  assert.equal(byId(L.settle({ ante: 10, play: 10 }, hand('KS KD', 'QH QC', 'KH KC 7C 9D 2S')), 'blind').mult, 10);
  assert.equal(byId(L.settle({ ante: 10, play: 10 }, hand('9H 8H', 'QS QC', '7H 6H 5H 2D 2S')), 'blind').mult, 50);
  assert.equal(byId(L.settle({ ante: 10, play: 10 }, hand('AH KH', 'QS QC', 'QH JH TH 2D 3S')), 'blind').mult, 500);
  // 莊贏（合格）：全輸
  r = L.settle({ ante: 50, play: 200 }, hand('QS JD', 'AC KD', 'KH 7S 2C 9D 3S'));
  assert.equal(r.outcome, 'lose');
  assert.equal(r.net, -300);
  // 莊贏但不合格（兩邊都高牌）：Ante 退回，Blind / Play 輸
  r = L.settle({ ante: 50, play: 50 }, hand('QS 4D', 'AC 5D', 'KH 9S 2C 7D 3S'));
  assert.equal(r.qual, false);
  assert.equal(r.outcome, 'lose');
  assert.deepEqual([byId(r, 'ante').result, byId(r, 'blind').result, byId(r, 'play').result], ['push', 'lose', 'lose']);
  assert.equal(r.net, -100);
  // 平手：全部退回
  r = L.settle({ ante: 50, play: 50 }, hand('2S 3D', '2C 3H', 'AH AD KC KS QH'));
  assert.equal(r.outcome, 'tie');
  assert.equal(r.net, 0);
  // 棄牌：輸 Ante + Blind，Trips 照算
  r = L.settle({ ante: 50, trips: 10 }, hand('7S 7D', 'AC AD', '7H KS 2C 9D 4S'), { folded: true });
  assert.equal(r.outcome, 'fold');
  assert.equal(byId(r, 'play'), undefined);
  assert.deepEqual([byId(r, 'trips').result, byId(r, 'trips').mult], ['win', 3]);
  assert.equal(r.net, -100 + 30);
});

test('Trips 賠付表（只看玩家 7 張）', () => {
  const t = (p, b) => byId(L.settle({ ante: 10, trips: 10, play: 10 }, hand(p, '2C 3D', b)), 'trips');
  assert.equal(t('AH KH', 'QH JH TH 5D 6S').mult, 50);
  assert.equal(t('9H 8H', '7H 6H 5H KD KS').mult, 40);
  assert.equal(t('KS KD', 'KH KC 7C 9D 4S').mult, 30);
  assert.equal(t('KS KD', 'KH 7S 7C 9D 4S').mult, 8);
  assert.equal(t('AH 9H', 'QH 7H 4H KD 5S').mult, 7);
  assert.equal(t('9S 8D', 'TH 7C 6S KD 4S').mult, 4);
  assert.equal(t('9S 9D', '9H 7C 6S KD 4S').mult, 3);
  assert.equal(t('9S 8D', '9H 7C KS KD 4S').result, 'lose', '兩對不賠');
});

test('4× 表邊界：K-5o 4×、K-4o 過；Q-8o 4×、Q-7o 過（含同花、對子、J）', () => {
  const a = (s) => L.preflopAdvice(P(s)).action;
  assert.equal(a('KS 5D'), 'raise4');
  assert.equal(a('KS 4D'), 'check');
  assert.equal(a('QS 8D'), 'raise4');
  assert.equal(a('QS 7D'), 'check');
  assert.equal(a('KS 2S'), 'raise4', 'K-2s');
  assert.equal(a('QS 6S'), 'raise4', 'Q-6s');
  assert.equal(a('QS 5S'), 'check', 'Q-5s');
  assert.equal(a('JS 8S'), 'raise4', 'J-8s');
  assert.equal(a('JS 7S'), 'check', 'J-7s');
  assert.equal(a('JS TD'), 'raise4', 'J-10o');
  assert.equal(a('JS 9D'), 'check', 'J-9o');
  assert.equal(a('AS 2D'), 'raise4', '任 A');
  assert.equal(a('3S 3D'), 'raise4', '33');
  assert.equal(a('2S 2D'), 'check', '22');
  assert.equal(a('TS 9S'), 'check', '10-9s');
});

test('翻牌後 2× 與河牌 1× 規則（提示）', () => {
  const f = (h, b) => L.flopAdvice(P(h), P(b)).action;
  assert.equal(f('9S 8S', 'KH 9D 3C'), 'raise2', '用到手牌的一對');
  assert.equal(f('AS 4D', 'KH KD 3C'), 'check', '只有公共牌的對');
  assert.equal(f('KS 3D', 'KH 3H 7C'), 'raise2', '兩對');
  assert.equal(f('TH 4C', 'AH 7H 2H'), 'raise2', '4 張同花 + 手牌 10 同花色');
  assert.equal(f('9H 4C', 'AH 7H 2H'), 'check', '同花色手牌只有 9');
  assert.equal(f('QS JD', 'AH 7C 2S'), 'check', '高牌');

  const r = (h, b) => L.riverAdvice(P(h), P(b));
  assert.equal(r('KS 3D', 'KH 9S 7C 5D 2S').action, 'raise1', '用到手牌的一對');
  const q3 = r('8C 3D', 'KS JH 9D 5C 2S');
  assert.equal(q3.outs, 27, 'outs：配對 15 張 + A/Q/10 12 張');
  assert.equal(q3.action, 'fold');
  const low = r('AC QD', 'KS JH 8D 5C 2S');      // A 高、Q 踢腳：outs = 配對 15 張
  assert.equal(low.outs, 15);
  assert.equal(low.action, 'raise1');
  assert.equal(L.dealerOuts(P('AC QD'), P('KS JH 8D 5C 2S')).count, 15);
});

test('教學步驟符合規範（≥14 步、四段、≥3 action、3 題測驗）', () => {
  const inst = def.create(fakeCtx('tutorial'));
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps, { minSteps: 14 });
  assert.deepEqual(lint.problems, []);
  for (const sec of ['layout', 'flow', 'payout', 'strategy']) {
    assert.match(steps.find((x) => x.section === sec).title, /這段你會學到/, `${sec} 開頭步`);
  }
  const quiz = steps.filter((x) => /小測驗/.test(x.title));
  assert.equal(quiz.length, 3);
  // 測驗 check：未作答 → 提示字串；答錯 → 提示字串；答對 → true
  inst.state.quiz = {};
  assert.equal(typeof quiz[0].action.check(inst), 'string');
  inst.state.quiz = { q1: 'check', q2: 'raise2', q3: 'fold' };
  assert.equal(typeof quiz[0].action.check(inst), 'string');
  assert.equal(quiz[1].action.check(inst), true);
  assert.equal(quiz[2].action.check(inst), true);
  inst.state.quiz.q1 = 'raise4';
  assert.equal(quiz[0].action.check(inst), true);
  assert.ok(steps.some((x) => /No more bets/.test(x.title)));
  assert.ok(steps.some((x) => /預算/.test(x.title)));
});

test('[slow] Monte Carlo：照策略提示玩，Ante 優勢 1.5%–3%', () => {
  LG.rng.seed(20260927);
  const r = L.simulate(1000000);
  LG.rng.seed(null);
  assert.ok(r.se < 0.3, `標準誤 ${r.se}`);
  assert.ok(r.edge > 1.5 && r.edge < 3, `edge ${r.edge.toFixed(3)}% ± ${r.se.toFixed(3)}（fold ${(r.rates.fold * 100).toFixed(1)}%）`);
  assert.ok(r.rates.fold > 0.14 && r.rates.fold < 0.22, `fold ${r.rates.fold}`);
});

test('[slow] Trips 優勢 = 3.50%（本桌賠付表，Monte Carlo 50 萬手）', () => {
  LG.rng.seed(7);
  const deck = LG.cards.newDeck();
  let ev = 0;
  const n = 500000;
  for (let i = 0; i < n; i++) {
    for (let k = 0; k < 7; k++) {
      const top = 51 - k, j = Math.floor(LG.rng.random() * (top + 1));
      const t = deck[top]; deck[top] = deck[j]; deck[j] = t;
    }
    const cat = Math.floor(LG.poker.score(deck.slice(45)) / 1048576);
    ev += L.TRIPS_PAY[cat] || -1;
  }
  LG.rng.seed(null);
  const edge = -ev / n * 100;
  assert.ok(edge > 2.5 && edge < 4.5, `Trips edge ${edge}`);
  // 精確值：以 7 張牌型機率計算
  const C = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 37260, 4324];
  const exact = -C.reduce((a, c, k) => a + c * (L.TRIPS_PAY[k] || -1), 0) / 133784560 * 100;
  assert.ok(Math.abs(exact - 3.5) < 0.01, `exact ${exact}`);
  assert.equal(def.houseEdge.find((h) => h.bet.en === 'Trips').edge, 3.5);
});
