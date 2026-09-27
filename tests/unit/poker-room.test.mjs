// 德州撲克現金桌 poker-room：牌局引擎、邊池、抽水、行動順序、最小加注、AI 對戰籌碼守恆、教學規範
// 規格：docs/05-game-rules/poker-room.md §7
import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ games: ['poker-room'] });
const def = LG.games['poker-room'];
const { Table, rakeFor, buildPots, splitAmount, aiDecide, advise, potOdds, explainHand, handPct, RULES, PERSONAS } = def.logic;
const P = (s) => LG.cards.parseMany(s);
const sum = (a) => a.reduce((x, y) => x + y, 0);
const stacks = (t) => t.seats.map((s) => s.stack);

function mk(stackList, { button = 0, persona } = {}) {
  return new Table({
    button,
    players: stackList.map((stack, i) => ({ name: 'P' + i, stack, persona: persona ? persona[i % persona.length] : 'TAG' })),
  });
}

test('註冊：分類、買入範圍、houseEdge（無莊家優勢，best:true）、不用籌碼盤', () => {
  assert.equal(def.category, 'poker-room');
  assert.deepEqual(LG.limitsFor(def, 'real'), { min: 400, max: 1000 });
  assert.equal(RULES.sb, 5);
  assert.equal(RULES.bb, 10);
  const b = LG.bestEdge(def);
  assert.ok(b.best);
  assert.match(b.bet.zh, /抽水 5%/);
  assert.match(b.bet.zh, /RM 50/);
});

// ---------------------------------------------------------------- 抽水
test('抽水：RM 200 → RM 10；RM 2,000 → RM 50（上限）；翻牌前結束不抽', () => {
  assert.equal(rakeFor(200, true), 10);
  assert.equal(rakeFor(2000, true), 50);
  assert.equal(rakeFor(1000, true), 50);
  assert.equal(rakeFor(45, true), 2);          // 2.25 → 取整 RM 2
  assert.equal(rakeFor(2000, false), 0);       // No flop no drop
});

test('抽水：翻牌前全棄 → 不抽；有翻牌 → 抽 5%', () => {
  // 3 人，按鈕 0：小盲 1、大盲 2；0 加注到 30，其他人棄牌
  let t = mk([1000, 1000, 1000]);
  t.startHand();
  assert.equal(t.toAct, 0);
  t.act(0, { type: 'raise', to: 30 });
  t.act(1, { type: 'fold' });
  t.act(2, { type: 'fold' });
  assert.equal(t.phase, 'done');
  assert.equal(t.result.rake, 0);
  assert.equal(t.result.sawFlop, false);
  assert.deepEqual(t.result.uncalled, { seat: 0, amount: 20 });
  assert.deepEqual(stacks(t), [1015, 995, 990]);

  // 有翻牌：每人 100 → 底池 300（翻牌前），翻牌後都過牌
  t = mk([1000, 1000, 1000]);
  t.startHand({ preset: { holes: { 0: P('AS AH'), 1: P('KS KH'), 2: P('2C 7D') }, board: P('AD 9C 5S 3H 8D') } });
  t.act(0, { type: 'raise', to: 100 });
  t.act(1, { type: 'call' });
  t.act(2, { type: 'call' });
  for (let k = 0; k < 9; k++) t.act(t.toAct, { type: 'check' });
  assert.equal(t.phase, 'done');
  assert.equal(t.result.potTotal, 300);
  assert.equal(t.result.rake, 15);
  assert.deepEqual(stacks(t), [900 + 285, 900, 900]);
  assert.equal(sum(stacks(t)) + t.totalRake, 3000);
});

// ---------------------------------------------------------------- 邊池
test('邊池：三人不同 all-in 金額（100 / 300 / 500）分配正確', () => {
  // 按鈕 0（A 100）、小盲 1（B 300）、大盲 2（C 500）；翻牌前 A 先動
  const t = mk([100, 300, 500]);
  t.startHand({ preset: { holes: { 0: P('AS AH'), 1: P('KS KH'), 2: P('QS QH') }, board: P('2C 7D 9H 4S 3C') } });
  assert.equal(t.toAct, 0);
  t.act(0, { type: 'allin' });
  t.act(1, { type: 'allin' });
  t.act(2, { type: 'allin' });
  const r = t.result;
  assert.equal(t.phase, 'done');
  assert.ok(r.showdown);
  // C 面對的人都已全下：按「全下」只會跟到 300（沒有人能再跟），多的 200 留在 C 面前
  assert.equal(r.uncalled, null);
  assert.equal(t.seats[2].committed, 300);
  assert.equal(r.pots.length, 2);
  assert.deepEqual([r.pots[0].amount, r.pots[0].eligible], [300, [0, 1, 2]]);   // 主池 100 × 3
  assert.deepEqual([r.pots[1].amount, r.pots[1].eligible], [400, [1, 2]]);      // 邊池 200 × 2
  assert.equal(r.rake, 35);                                          // 700 × 5%
  assert.deepEqual(r.pots[0].winners, [0]);
  assert.deepEqual(r.pots[1].winners, [1]);
  assert.deepEqual(stacks(t), [300 - 35, 400, 200]);
  assert.equal(sum(stacks(t)) + t.totalRake, 900);
});

test('邊池：最短 all-in 輸掉時，主池歸邊池贏家', () => {
  const t = mk([100, 300, 500]);
  t.startHand({ preset: { holes: { 0: P('2S 3H'), 1: P('KS KH'), 2: P('AS AH') }, board: P('AC 7D 9H 4S JC') } });
  t.act(0, { type: 'allin' });
  t.act(1, { type: 'allin' });
  t.act(2, { type: 'call' });
  const r = t.result;
  assert.deepEqual(r.pots.map((p) => p.winners), [[2], [2]]);
  assert.deepEqual(stacks(t), [0, 0, 900 - 35]);
});

test('buildPots：棄牌者投入算進池但不能分；未跟注部分退回', () => {
  // A 投 50 後棄牌；B all-in 120；C 投 300
  const { pots, uncalled } = buildPots([50, 120, 300], [true, false, false]);
  assert.deepEqual(uncalled, { seat: 2, amount: 180 });
  assert.deepEqual(pots, [{ amount: 290, eligible: [1, 2] }]);
});

test('平分底池：奇數籌碼歸按鈕左側第一位', () => {
  assert.deepEqual(splitAmount(69, [2, 0]), { 2: 35, 0: 34 });
  assert.deepEqual(splitAmount(100, [1, 2, 0]), { 1: 34, 2: 33, 0: 33 });
  // 牌面順子 A-K-Q-J-10，所有人平手。按鈕 0，小盲 1、大盲 2。
  const t = mk([1000, 1000, 1000]);
  t.startHand({ preset: { holes: { 0: P('2C 3D'), 1: P('4C 5D'), 2: P('6C 7D') }, board: P('AS KD QH JC TS') } });
  t.act(0, { type: 'call' });        // 0 跟 10
  t.act(1, { type: 'call' });        // 小盲補 5
  t.act(2, { type: 'check' });       // 底池 30
  assert.equal(t.street, 'flop');
  assert.equal(t.toAct, 1);          // 翻牌後按鈕左側先動
  t.act(1, { type: 'check' });
  t.act(2, { type: 'bet', to: 21 });
  t.act(0, { type: 'call' });
  t.act(1, { type: 'fold' });        // 底池 72
  while (t.phase === 'play') t.act(t.toAct, { type: 'check' });
  const r = t.result;
  assert.equal(r.potTotal, 72);
  assert.equal(r.rake, 3);           // 72 × 5% = 3.6 → 3
  assert.deepEqual(r.pots[0].winners, [2, 0]);   // 按鈕左側起：2 在 0 前面
  assert.deepEqual(r.pots[0].shares, { 2: 35, 0: 34 });
  assert.deepEqual(stacks(t), [1000 - 31 + 34, 990, 1000 - 31 + 35]);
});

// ---------------------------------------------------------------- 行動順序 / 按鈕 / 盲注
test('盲注扣除、翻牌前大盲左側先動、翻牌後按鈕左側先動', () => {
  const t = mk([1000, 1000, 1000, 1000, 1000, 1000]);
  t.startHand();
  assert.deepEqual([t.pos.button, t.pos.sb, t.pos.bb], [0, 1, 2]);
  assert.equal(t.seats[1].bet, 5);
  assert.equal(t.seats[2].bet, 10);
  assert.deepEqual(stacks(t), [1000, 995, 990, 1000, 1000, 1000]);
  assert.equal(t.toAct, 3);                      // UTG = 大盲左側
  const order = [];
  while (t.street === 'preflop') { order.push(t.toAct); t.act(t.toAct, { type: t.legal(t.toAct).canCheck ? 'check' : 'call' }); }
  assert.deepEqual(order, [3, 4, 5, 0, 1, 2]);   // 大盲最後（option）
  assert.equal(t.toAct, 1);                      // 翻牌後小盲先
  t.act(1, { type: 'fold' });
  const post = [];
  while (t.street === 'flop') { post.push(t.toAct); t.act(t.toAct, { type: 'check' }); }
  assert.deepEqual(post, [2, 3, 4, 5, 0]);       // 小盲棄牌 → 大盲先
});

test('大盲有 option：大家平跟時大盲可以加注', () => {
  const t = mk([1000, 1000, 1000]);
  t.startHand();
  t.act(0, { type: 'call' });
  t.act(1, { type: 'call' });
  assert.equal(t.toAct, 2);
  const L = t.legal(2);
  assert.ok(L.canCheck && L.canRaise);
  assert.equal(L.minTo, 20);
});

test('按鈕輪轉：每手順時針移一位、跳過沒籌碼的座位；兩人時按鈕 = 小盲且翻牌前先動', () => {
  const t = mk([1000, 0, 1000, 1000], { button: 0 });
  t.startHand();
  assert.deepEqual([t.pos.button, t.pos.sb, t.pos.bb], [0, 2, 3]);
  t.act(t.toAct, { type: 'fold' }); t.act(t.toAct, { type: 'fold' });
  t.startHand();
  assert.deepEqual([t.pos.button, t.pos.sb, t.pos.bb], [2, 3, 0]);
  t.act(t.toAct, { type: 'fold' }); t.act(t.toAct, { type: 'fold' });
  t.startHand();
  assert.equal(t.pos.button, 3);

  const hu = mk([500, 500], { button: 1 });
  hu.startHand();
  assert.deepEqual([hu.pos.button, hu.pos.sb, hu.pos.bb, hu.pos.headsUp], [1, 1, 0, true]);
  assert.equal(hu.toAct, 1);                     // 翻牌前按鈕（小盲）先
  hu.act(1, { type: 'call' });
  hu.act(0, { type: 'check' });
  assert.equal(hu.street, 'flop');
  assert.equal(hu.toAct, 0);                     // 翻牌後大盲先
});

// ---------------------------------------------------------------- 最小加注
test('最小加注 = 前次加注額；翻牌後最小下注 = 大盲', () => {
  const t = mk([1000, 1000, 1000, 1000]);
  t.startHand();                                  // 按鈕 0，SB 1，BB 2，UTG 3
  assert.equal(t.legal(3).minTo, 20);             // 10 + 10
  assert.throws(() => t.act(3, { type: 'raise', to: 15 }), /BELOW_MIN_RAISE/);
  t.act(3, { type: 'raise', to: 30 });            // 加了 20
  assert.equal(t.legal(0).minTo, 50);             // 30 + 20
  assert.throws(() => t.act(0, { type: 'raise', to: 45 }), /BELOW_MIN_RAISE/);
  t.act(0, { type: 'raise', to: 100 });           // 加了 70
  assert.equal(t.legal(1).minTo, 170);
  assert.throws(() => t.act(1, { type: 'check' }), /CANNOT_CHECK/);
  t.act(1, { type: 'fold' }); t.act(2, { type: 'fold' }); t.act(3, { type: 'call' });
  assert.equal(t.street, 'flop');
  assert.equal(t.legal(3).minTo, 10);             // 翻牌後首注至少大盲
  assert.throws(() => t.act(3, { type: 'bet', to: 5 }), /BELOW_MIN_RAISE/);
  t.act(3, { type: 'bet', to: 40 });
  assert.equal(t.legal(0).minTo, 80);
});

test('不足額 all-in 加注不重新開放加注；超過籌碼不行', () => {
  const t = mk([1000, 1000, 1000, 150], { button: 0 });
  t.startHand();                                  // SB 1、BB 2、UTG 3（150）
  t.act(3, { type: 'fold' }); t.act(0, { type: 'call' }); t.act(1, { type: 'call' }); t.act(2, { type: 'check' });
  // 另開一手測試：翻牌後 A 下 100、短碼 all-in 150（只多 50 < 100）
  const u = mk([1000, 1000, 160], { button: 0 });
  u.startHand();                                  // SB 1、BB 2（160）
  u.act(0, { type: 'call' }); u.act(1, { type: 'call' }); u.act(2, { type: 'check' });
  u.act(1, { type: 'bet', to: 100 });             // 小盲下 100
  u.act(2, { type: 'allin' });                    // 剩 150 → 加到 150（只加 50）
  assert.ok(u.seats[2].allIn);
  u.act(0, { type: 'call' });                     // 按鈕跟 150（沒行動過，本來可以加注）
  assert.equal(u.toAct, 1);
  const L = u.legal(1);
  assert.equal(L.canRaise, false);                // 已行動、面對不足額加注 → 只能跟或棄
  assert.equal(L.toCall, 50);
  assert.throws(() => u.act(1, { type: 'raise', to: 400 }), /CANNOT_RAISE/);
  u.act(1, { type: 'call' });
  assert.equal(u.street, 'turn');
  assert.throws(() => u.act(u.toAct, { type: 'bet', to: 5000 }), /ABOVE_STACK/);
});

test('all-in 後其餘人不用再行動就直接發完公共牌攤牌', () => {
  const t = mk([200, 1000, 1000]);
  t.startHand();
  t.act(0, { type: 'allin' });
  t.act(1, { type: 'fold' });
  t.act(2, { type: 'call' });
  assert.equal(t.phase, 'done');
  assert.equal(t.result.board.length, 5);
  assert.ok(t.result.showdown);
  assert.equal(sum(stacks(t)) + t.totalRake, 2200);
});

// ---------------------------------------------------------------- AI / 提示 / 解說
test('AI 三性格都存在；起手牌百分位 AA 最強、72o 很弱', () => {
  assert.deepEqual(Object.keys(PERSONAS).sort(), ['LAG', 'STATION', 'TAG']);
  assert.equal(PERSONAS.TAG.range, 0.2);
  assert.equal(PERSONAS.LAG.range, 0.4);
  assert.equal(PERSONAS.STATION.range, 0.5);
  assert.equal(handPct(P('AS AH')), 0);
  assert.ok(handPct(P('AS KS')) < 0.03);
  assert.ok(handPct(P('7C 2D')) > 0.9);
});

test('AI 決策永遠合法（1 次決策多種情境）', () => {
  LG.rng.seed(7);
  for (const persona of ['TAG', 'LAG', 'STATION']) {
    for (let k = 0; k < 30; k++) {
      const t = mk([1000, 800, 600, 400], { persona: [persona] , button: k % 4 });
      t.startHand();
      let guard = 0;
      while (t.phase === 'play' && guard++ < 60) {
        const d = aiDecide(t, t.toAct, { iters: 60 });
        assert.ok(['fold', 'check', 'call', 'raise'].includes(d.type), d.type);
        t.act(t.toAct, d);
      }
      assert.equal(t.phase, 'done');
    }
  }
  LG.rng.seed(null);
});

test('底池賠率與提示：勝率 < 需要 → 建議棄牌；勝率 ≥ 需要 → 跟注', () => {
  const po = potOdds(60, 20);
  assert.equal(po.need, 0.25);
  assert.match(po.text, /3:1/);
  const t = mk([1000, 1000]);
  t.startHand({ preset: { holes: { 0: P('7C 2D'), 1: P('AS AH') } } });
  t.act(0, { type: 'raise', to: 200 });  // 按鈕 0（小盲）加注
  assert.equal(t.toAct, 1);
  const weak = advise(t, 1, 0.1);
  assert.equal(weak.action, 'fold');
  const ok = advise(t, 1, 0.5);
  assert.ok(['call', 'raise'].includes(ok.action));
  assert.ok(ok.reason.length > 5);
});

test('練習結果面板四段：含抽水計算式與淨額', () => {
  const t = mk([1000, 1000, 1000]);
  t.startHand({ preset: { holes: { 0: P('AS AH'), 1: P('KS KH'), 2: P('2C 7D') }, board: P('AD 9C 5S 3H 8D') } });
  t.act(0, { type: 'raise', to: 100 }); t.act(1, { type: 'call' }); t.act(2, { type: 'fold' });
  while (t.phase === 'play') t.act(t.toAct, { type: 'check' });
  const ex = explainHand(t, 0);
  assert.equal(ex.net, 100);                    // 底池 210 − 抽水 10 = 200；投入 100 → 淨 +100
  assert.match(ex.formula, /RM 210 × 5% = RM 10.50 → 取整 RM 10/);
  assert.match(ex.hand, /三條 A/);
  assert.match(ex.why, /大過/);
  assert.ok(ex.result && ex.hand && ex.formula && ex.why);
});

// ---------------------------------------------------------------- 教學
test('教學 ≥ 16 步、四段、≥ 3 action、每步有 highlight', () => {
  const inst = def.create(fakeCtx());
  const steps = inst.tutorialSteps();
  const lint = LG.tutorial.lint(steps, { minSteps: 16 });
  assert.deepEqual(lint.problems, []);
  assert.ok(steps.length >= 16);
  const ids = steps.map((s) => s.id).join(' ');
  for (const k of ['button', 'blinds', 'minraise', 'allin', 'rake', 'etiquette', 'hands', 'position', 'odds', 'budget']) assert.match(ids, new RegExp(k));
});

// ---------------------------------------------------------------- [slow] 模擬
test('[slow] 100 手 AI 自動對戰：無錯誤、籌碼守恆（總籌碼 + 累計抽水 = 初始）', () => {
  LG.rng.seed(2024);
  const init = [1000, 800, 600, 1000, 400, 700];
  const t = mk(init, { persona: ['TAG', 'LAG', 'STATION'], button: 0 });
  const total = sum(init);
  let hands = 0;
  while (hands < 100 && t.seats.filter((s) => s.stack > 0).length >= 2) {
    t.startHand();
    let guard = 0;
    while (t.phase === 'play') {
      assert.ok(guard++ < 200, 'too many actions');
      t.act(t.toAct, aiDecide(t, t.toAct));
      if (t.phase === 'play') assert.equal(sum(t.seats.map((s) => s.stack + s.committed)) + t.totalRake, total);
    }
    hands += 1;
    assert.equal(sum(stacks(t)) + t.totalRake, total, `hand ${hands}`);
    assert.ok(t.seats.every((s) => s.stack >= 0 && Number.isInteger(s.stack)));
    assert.ok(t.result.rake <= 50);
    if (!t.result.sawFlop) assert.equal(t.result.rake, 0);
  }
  assert.ok(hands >= 30, `hands ${hands}`);
  LG.rng.seed(null);
});

function fakeCtx() {
  return {
    gameId: 'poker-room', def, mode: 'tutorial', variant: null, limits: { min: 400, max: 1000 }, denoms: def.denoms,
    bank: LG.bank, stats: LG.stats, hints: false, isReal: false, isPractice: false, isTutorial: true,
    alive: () => true, on() {}, wait: () => new Promise(() => {}), later() {}, explain() {}, recordRound() {},
    dealer: { say() {} }, bettingWindow: () => ({ cancel() {} }), nextRound() {}, checkBroke: () => false, strategyPanel() {},
    ready: Promise.resolve(),
  };
}
