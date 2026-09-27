// 百家樂 baccarat：規格 docs/05-game-rules/baccarat.md §9 驗收測試
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

// [slow] 測試：npm test 時略過（見 docs/change-requests/core-b.md CR-1）
const SLOW = process.env.npm_lifecycle_event === 'test' && !process.env.SLOW ? { skip: '[slow] 請用 npm run test:slow' } : {};

const LG = loadLG({ games: ['baccarat'] });
const def = LG.games.baccarat;
const L = def.logic;
const B = LG.baccarat;
const P = LG.cards.parseMany;
/** 由指定牌完成一局；extra = 需要補牌時依序抽的牌 */
const coup = (p, b, extra = '') => B.resolveCoup(P(p), P(b), LG.cards.newShoe(1).stack(extra || 'KS KH'));
const settle = (bets, c, v) => B.settle(bets, c, v);

test('baccarat 註冊：分類、變體、倒數、houseEdge 與 00-common 一致', () => {
  assert.equal(def.category, 'table');
  assert.deepEqual(def.variants.map((v) => v.id), ['classic', 'super6', 'tiger', 'squeeze']);
  assert.equal(def.countdown, 15);
  const best = LG.bestEdge(def);
  assert.equal(best.edge, 1.06);
  assert.equal(best.bet.en, 'Banker');
  const edges = Object.fromEntries(def.houseEdge.map((h) => [h.bet.en, h.edge]));
  assert.equal(edges.Player, 1.24);
  assert.equal(edges['Banker (no commission)'], 1.46);
  assert.equal(edges.Tie, 14.36);
  assert.equal(edges.Pair, 10.36);
  assert.equal(edges['Super 6'], 29.98);
  assert.equal(edges.Tiger, 7.66);
  assert.equal(edges['Big Tiger'], 6.03);
  assert.equal(edges['Small Tiger'], 5.36);
  assert.equal(edges['Tiger Tie'], 9.9);
  assert.equal(edges['Tiger Pair'], 8.9);
  assert.deepEqual(LG.limitsFor(def, 'real', 'classic'), { min: 50, max: 5000 });
  assert.deepEqual(LG.limitsFor(def, 'practice', 'tiger'), { min: 10, max: 100000 });
});

test('baccarat 旁注列依變體切換', () => {
  assert.deepEqual(L.spotsFor('classic'), ['bankerPair', 'playerPair', 'tie', 'banker', 'player']);
  assert.deepEqual(L.spotsFor('squeeze'), L.spotsFor('classic'));
  assert.deepEqual(L.spotsFor('super6').slice(5), ['super6']);
  assert.deepEqual(L.spotsFor('tiger').slice(5), ['tiger', 'bigTiger', 'smallTiger', 'tigerTie', 'tigerPair']);
  assert.equal(L.noComm('super6'), true);
  assert.equal(L.noComm('tiger'), true);
  assert.equal(L.noComm('classic'), false);
  assert.equal(L.noComm('squeeze'), false);
  // 每個 spotId 都有中/英/賠率
  for (const id of L.spotsFor('tiger').concat('super6')) {
    const s = L.T.spots[id];
    assert.ok(s.zh && s.en && s.odds, id);
  }
});

test('baccarat 第三張牌規則表：莊 0–7 × 閒第三張 0–9 全部格', () => {
  const TABLE = {
    0: '1111111111', 1: '1111111111', 2: '1111111111',
    3: '1111111101', 4: '0011111100', 5: '0000111100', 6: '0000001100', 7: '0000000000',
  };
  let cells = 0;
  for (let b = 0; b <= 7; b++) {
    for (let x = 0; x <= 9; x++) {
      assert.equal(B.bankerDraws(b, x), TABLE[b][x] === '1', `莊 ${b} × 閒第三張 ${x}`);
      cells++;
    }
  }
  assert.equal(cells, 80);
  // 閒沒補牌時：莊 0–5 補、6–7 停
  for (let b = 0; b <= 7; b++) assert.equal(B.bankerDraws(b, null), b <= 5, `莊 ${b}（閒未補）`);
  // 教學規則文字與表一致
  assert.equal(L.bankerRuleText(3), '閒第三張不是 8 就補');
  assert.equal(L.bankerRuleText(6), '閒第三張 6–7 補');
  assert.equal(L.bankerRuleText(7), '停');
});

test('baccarat 天牌後不補牌；閒 6/7 停；閒補後莊依表', () => {
  let c = coup('7S AH', '5D KC', '4H 4D'); // 閒 8 天牌
  assert.equal(c.natural, true);
  assert.equal(c.player.length, 2);
  assert.equal(c.banker.length, 2);
  assert.match(L.drawReason(c)[0], /天牌/);

  c = coup('3S 3H', '4D KC', '9H'); // 閒 6 停；莊 4（閒未補）→ 補
  assert.equal(c.player.length, 2);
  assert.equal(c.banker.length, 3);
  assert.match(L.drawReason(c).join(), /停牌（閒 6–7 停）/);

  c = coup('4S 3H', '6D KC'); // 閒 7 停；莊 6 停
  assert.equal(c.player.length, 2);
  assert.equal(c.banker.length, 2);

  c = coup('2S 3D', 'KC 5H', '4H 9D'); // 閒 5 補 4；莊 5 遇 4 → 補
  assert.equal(c.player.length, 3);
  assert.equal(c.banker.length, 3);
  assert.match(L.drawReason(c)[1], /查表「莊 5：閒第三張 4–7 補」→ 補牌/);

  c = coup('2S 3D', 'KC 5H', '2H 9D'); // 閒第三張 2；莊 5 遇 2 → 停
  assert.equal(c.banker.length, 2);
  assert.match(L.drawReason(c)[1], /→ 停牌/);

  c = coup('AS KD', '3C KH', '8S 5D'); // 莊 3 遇閒第三張 8 → 停
  assert.equal(c.banker.length, 2);
});

test('baccarat settle：classic 莊贏 RM 100 → +95（拿回 195）', () => {
  const c = coup('2S 4D', 'KC 7H'); // 閒 6 停、莊 7 停 → 莊贏
  assert.equal(c.outcome, 'B');
  const r = settle({ banker: 100 }, c, 'classic');
  assert.equal(r.net, 95);
  assert.equal(r.payouts.banker, 195);
  assert.equal(settle({ banker: 100 }, c, 'squeeze').net, 95, '咪牌同 classic');
  assert.equal(settle({ banker: 100 }, c, 'super6').net, 100, '免佣 1:1');
  const f = L.lineFormula(r.lines[0]);
  assert.equal(f, '莊 RM 100 × 0.95 = +RM 95（拿回 RM 195）');
});

test('baccarat settle：super6 / tiger 莊 6 點贏 RM 100 → +50；Super 6 12:1', () => {
  const c = coup('3S AD', 'KC 6H', 'KD'); // 閒 4 補 K → 4；莊 6 遇 0 停 → 莊兩張 6 點贏
  assert.equal(c.bankerWinsWith6, true);
  assert.equal(c.bankerCards, 2);
  for (const v of ['super6', 'tiger']) {
    const r = settle({ banker: 100 }, c, v);
    assert.equal(r.net, 50, v);
    assert.equal(r.payouts.banker, 150, v);
  }
  assert.equal(settle({ banker: 100 }, c, 'classic').net, 95, '傳統桌照 0.95');
  assert.equal(settle({ super6: 10 }, c, 'super6').net, 120);
});

test('baccarat settle：和局時莊/閒 push、和 8:1', () => {
  const c = coup('3S 4D', 'KC 7H'); // 7 : 7
  assert.equal(c.outcome, 'T');
  const r = settle({ player: 100, banker: 50, tie: 10 }, c, 'classic');
  assert.equal(r.payouts.player, 100);
  assert.equal(r.payouts.banker, 50);
  assert.equal(r.payouts.tie, 90);
  assert.equal(r.net, 80);
  const lines = Object.fromEntries(r.lines.map((l) => [l.spot, l]));
  assert.equal(lines.player.result, 'push');
  assert.equal(lines.banker.result, 'push');
  assert.match(L.lineFormula(lines.player), /退回/);
});

test('baccarat settle：對子 11:1（只看前兩張同 rank）', () => {
  let c = coup('TS 9D', 'KS KH'); // 莊對
  let r = settle({ bankerPair: 10, playerPair: 10 }, c, 'classic');
  assert.equal(r.payouts.bankerPair, 120);
  assert.equal(r.payouts.playerPair, 0);
  c = coup('TS KD', '9S 9H'); // 10 與 K 不是對子
  assert.equal(c.playerPair, false);
  assert.equal(c.bankerPair, true);
});

test('baccarat settle：Tiger 各旁注實例', () => {
  // 莊兩張 6 點贏（同上例）
  const two6 = coup('3S AD', 'KC 6H', 'KD');
  let r = settle({ tiger: 10, smallTiger: 10, bigTiger: 10 }, two6, 'tiger');
  assert.equal(r.payouts.tiger, 130, 'Tiger 兩張 12:1');
  assert.equal(r.payouts.smallTiger, 230, 'Small Tiger 22:1');
  assert.equal(r.payouts.bigTiger, 0);
  // 莊三張 6 點贏：閒 AS 2D=3 補 KD → 3；莊 KC 3H=3，閒第三張 0 → 補 3S → 6
  const three6 = coup('AS 2D', 'KC 3H', 'KD 3S');
  assert.equal(three6.bankerCards, 3);
  assert.equal(three6.bankerWinsWith6, true);
  r = settle({ tiger: 10, bigTiger: 10, smallTiger: 10 }, three6, 'tiger');
  assert.equal(r.payouts.tiger, 210, 'Tiger 三張 20:1');
  assert.equal(r.payouts.bigTiger, 510, 'Big Tiger 50:1');
  assert.equal(r.payouts.smallTiger, 0);
  // Tiger Tie 6 點和 35:1
  const tie6 = coup('3S 3D', 'KC 6H');
  assert.equal(tie6.outcome, 'T');
  assert.equal(settle({ tigerTie: 10 }, tie6, 'tiger').payouts.tigerTie, 360);
  assert.equal(settle({ tigerTie: 10 }, coup('3S 4D', 'KC 7H'), 'tiger').payouts.tigerTie, 0, '7 點和不中');
  // Tiger Pair：單邊 4:1、雙邊 20:1、同 rank 雙對 100:1
  assert.equal(settle({ tigerPair: 10 }, coup('4S 4D', 'KC 7H'), 'tiger').payouts.tigerPair, 50);
  assert.equal(settle({ tigerPair: 10 }, coup('4S 4D', '2C 2H', 'KS KH'), 'tiger').payouts.tigerPair, 210);
  assert.equal(settle({ tigerPair: 10 }, coup('4S 4D', '4C 4H', 'KS KH'), 'tiger').payouts.tigerPair, 1010);
  assert.equal(settle({ tigerPair: 10 }, coup('4S 5D', 'KC 7H'), 'tiger').payouts.tigerPair, 0);
});

test('baccarat 真實模式限注（spotRules）：主注 50–5,000、和 10–500、旁注 10–1,000', () => {
  const bets = L.makeBets('real', { min: 50, max: 5000 });
  assert.deepEqual(bets.limitFor('banker'), { min: 50, max: 5000 });
  assert.deepEqual(bets.limitFor('player'), { min: 50, max: 5000 });
  assert.deepEqual(bets.limitFor('tie'), { min: 10, max: 500 });
  for (const s of ['playerPair', 'bankerPair', 'super6', 'tiger', 'bigTiger', 'smallTiger', 'tigerTie', 'tigerPair']) {
    assert.deepEqual(bets.limitFor(s), { min: 10, max: 1000 }, s);
  }
  assert.equal(bets.place('tie', 1000).reason, 'ABOVE_MAX');
  assert.equal(bets.place('banker', 5000).ok, true);
  assert.equal(bets.place('player', 5000).ok, true, '總注可超過 5,000（旁注/雙邊）');
  assert.equal(bets.place('tie', 500).ok, true);
  assert.equal(bets.validate().ok, true);
  bets.clear();
  bets.place('banker', 25);
  const v = bets.validate();
  assert.equal(v.ok, false);
  assert.equal(v.errors[0].reason, 'BELOW_MIN');
  bets.clear();
  bets.place('playerPair', 10);
  assert.equal(bets.validate().ok, true, '旁注最低 RM 10');
  // 練習：每格 10–100,000
  const pb = L.makeBets('practice', { min: 10, max: 100000 });
  assert.deepEqual(pb.limitFor('tie'), { min: 10, max: 100000 });
});

test('baccarat 練習解說四段內容', () => {
  const c = coup('2S 3D', 'KC 5H', '4H 9D'); // 閒 9 vs 莊 4
  const r = settle({ player: 100, bankerPair: 10 }, c, 'classic');
  const d = L.describe(c, r);
  assert.match(d.hand, /閒 <b>9<\/b>（2♠ 3♦ 4♥） vs 莊 <b>4<\/b>（K♣ 5♥ 9♦）/);
  assert.match(d.result, /閒贏/);
  assert.match(d.result, /PLAYER WINS/);
  assert.match(d.formula, /閒 RM 100 × 1 = \+RM 100（拿回 RM 200）/);
  assert.match(d.formula, /莊對 RM 10 輸 → −RM 10/);
  assert.match(d.formula, /淨 <b>\+RM 90<\/b>/);
  assert.match(d.why, /閒兩張 5 點 → 補牌/);
  assert.match(d.why, /閒 9 > 莊 4/);
  assert.match(d.why, /莊對：莊前兩張不成對/);
});

test('baccarat 珠盤路：6 行、由上而下再往右，至少 12 欄', () => {
  const hist = Array.from({ length: 8 }, (_, i) => ({ o: 'BPT'[i % 3] }));
  const cells = L.beadCells(hist);
  assert.equal(cells.length, 12 * 6);
  assert.deepEqual([cells[0].col, cells[0].row], [0, 0]);
  assert.deepEqual([cells[5].col, cells[5].row], [0, 5]);
  assert.deepEqual([cells[6].col, cells[6].row], [1, 0]);
  assert.equal(cells[7].entry.o, 'P');
  assert.equal(cells[8].entry, null);
  const many = L.beadCells(Array.from({ length: 80 }, () => ({ o: 'B' })));
  assert.equal(many.length % 6, 0);
  assert.ok(many.length > 80, '超過 12 欄時會再多一欄空位');
  const e = L.roadEntry(coup('4S 4D', 'KC 7H'));
  assert.deepEqual([e.o, e.pp, e.bp], ['P', true, false]);
});

function fakeCtx(variant, mode = 'tutorial') {
  return {
    gameId: 'baccarat', def, mode, variant, limits: LG.limitsFor(def, mode, variant), denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: mode === 'real', isPractice: mode === 'practice', isTutorial: mode === 'tutorial',
    alive: () => true, on() {}, wait: () => Promise.resolve(), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
  };
}

test('baccarat 教學：每個變體 ≥ 14 步、四段、≥ 3 action、含規則表與互動題', () => {
  for (const v of ['classic', 'super6', 'tiger', 'squeeze']) {
    const inst = def.create(fakeCtx(v));
    const steps = inst.tutorialSteps();
    const lint = LG.tutorial.lint(steps, { minSteps: 14 });
    assert.deepEqual(lint.problems, [], v);
    const ids = steps.map((s) => s.id);
    for (const id of ['flow-banker-third', 'payout-commission', 'payout-super6', 'payout-tie', 'flow-no-more-bets', 'strategy-edge', 'strategy-budget', 'strategy-road']) {
      assert.ok(ids.includes(id), `${v} 缺 ${id}`);
    }
    for (const sec of ['layout', 'flow', 'payout', 'strategy']) {
      assert.match(steps.find((s) => s.section === sec).title, /這段你會學到|莊家優勢/, `${v} ${sec} 段開頭`);
    }
    // 互動題：答錯回傳提示字串，答對 true
    const q = steps.find((s) => s.id === 'payout-commission');
    assert.equal(q.action.check(inst), '點選一個答案');
    inst.state.quiz.commission = 'RM 200';
    assert.match(q.action.check(inst), /0\.95/);
    inst.state.quiz.commission = 'RM 195';
    assert.equal(q.action.check(inst), true);
    const s6 = steps.find((s) => s.id === 'payout-super6');
    inst.state.quiz.super6 = 'RM 150';
    assert.equal(s6.action.check(inst), true);
    const tie = steps.find((s) => s.id === 'payout-tie');
    inst.state.quiz.tie = '+RM 80';
    assert.equal(tie.action.check(inst), true);
    // 下注 action
    const place = steps.find((s) => s.id === 'flow-place');
    assert.notEqual(place.action.check(inst), true);
    inst.bets.place('banker', 50);
    assert.equal(place.action.check(inst), true);
  }
});

test('baccarat 互動題答案與實際結算一致', () => {
  const Q = L.T.quiz;
  const bWin = coup('2S 4D', 'KC 7H');
  assert.equal(LG.money.fmt(settle({ banker: 100 }, bWin, 'classic').returned), Q.commission.answer);
  const b6 = coup('3S AD', 'KC 6H', 'KD');
  assert.equal(LG.money.fmt(settle({ banker: 100 }, b6, 'super6').returned), Q.super6.answer);
  const t = coup('3S 4D', 'KC 7H');
  assert.equal(LG.money.fmtSigned(settle({ player: 100, tie: 10 }, t, 'classic').net), Q.tie.answer);
});

test('baccarat [slow]: Monte Carlo 100 萬局 莊 45.86% / 閒 44.62% / 和 9.52%（±0.3%）與主注優勢', SLOW, () => {
  LG.rng.seed(20260927);
  const shoe = LG.cards.newShoe(8, { cutCard: 14 });
  const N = 1_000_000;
  const n = { P: 0, B: 0, T: 0 };
  let evComm = 0, evNoComm = 0, evPlayer = 0;
  for (let i = 0; i < N; i++) {
    if (shoe.needsShuffle()) shoe.shuffle();
    const c = B.dealCoup(shoe);
    n[c.outcome]++;
    if (c.outcome === 'B') { evComm += 0.95; evNoComm += c.bTotal === 6 ? 0.5 : 1; evPlayer -= 1; }
    else if (c.outcome === 'P') { evComm -= 1; evNoComm -= 1; evPlayer += 1; }
  }
  LG.rng.seed(null);
  const pct = (x) => (x / N) * 100;
  assert.ok(Math.abs(pct(n.B) - 45.86) < 0.3, `莊 ${pct(n.B)}`);
  assert.ok(Math.abs(pct(n.P) - 44.62) < 0.3, `閒 ${pct(n.P)}`);
  assert.ok(Math.abs(pct(n.T) - 9.52) < 0.3, `和 ${pct(n.T)}`);
  assert.ok(Math.abs(-pct(evComm) - 1.06) < 0.3, `莊（佣）優勢 ${-pct(evComm)}`);
  assert.ok(Math.abs(-pct(evNoComm) - 1.46) < 0.3, `莊（免佣）優勢 ${-pct(evNoComm)}`);
  assert.ok(Math.abs(-pct(evPlayer) - 1.24) < 0.3, `閒優勢 ${-pct(evPlayer)}`);
});
