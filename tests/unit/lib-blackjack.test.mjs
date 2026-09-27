import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ core: 'libs' });
const BJ = LG.blackjack;
const P = LG.cards.parseMany;
const T = BJ.STRATEGY_TABLE;

test('lib-blackjack: value()', () => {
  assert.deepEqual(BJ.value(P('AS KD')), { total: 21, soft: true, bust: false, blackjack: true });
  const v = BJ.value(P('AS AD 9C'));
  assert.equal(v.total, 21); assert.equal(v.soft, true); assert.equal(v.blackjack, false);
  const b = BJ.value(P('KS QD 5C'));
  assert.equal(b.total, 25); assert.equal(b.bust, true);
  assert.equal(BJ.value(P('AS 6D')).total, 17);
  assert.equal(BJ.value(P('AS 6D TC')).total, 17);
  assert.equal(BJ.value(P('AS 6D TC')).soft, false);
  assert.equal(BJ.value(P('AS AD')).total, 12);
  assert.equal(BJ.value(P('AS KD'), { fromSplit: true }).blackjack, false); // 分 A 後 A+K 非 BJ
  assert.equal(BJ.value(P('7S 7D 7C')).blackjack, false);
});

// 規格 blackjack.md §5 原文（莊 2 3 4 5 6 7 8 9 T A）
const SPEC_HARD = {
  '17+': 'S S S S S S S S S S', 16: 'S S S S S H H H H H', 15: 'S S S S S H H H H H',
  '13-14': 'S S S S S H H H H H', 12: 'H H S S S H H H H H', 11: 'D D D D D D D D D H',
  10: 'D D D D D D D D H H', 9: 'H D D D D H H H H H', '5-8': 'H H H H H H H H H H',
};
const SPEC_SOFT = {
  A9: 'S S S S S S S S S S', A8: 'S S S S S S S S S S', A7: 'S Ds Ds Ds Ds S S H H H',
  A6: 'H D D D D H H H H H', 'A4-A5': 'H H D D D H H H H H', 'A2-A3': 'H H H D D H H H H H',
};
const SPEC_PAIRS = {
  AA: 'P P P P P P P P P P', TT: 'S S S S S S S S S S', 99: 'P P P P P S P P S S', 88: 'P P P P P P P P P P',
  77: 'P P P P P P H H H H', 66: 'P P P P P H H H H H', 55: 'D D D D D D D D H H', 44: 'H H H P P H H H H H',
  33: 'P P P P P P H H H H', 22: 'P P P P P P H H H H',
};
const range = (k) => {
  const m = /^(\d+)-(\d+)$/.exec(k);
  if (m) { const a = []; for (let i = +m[1]; i <= +m[2]; i++) a.push(i); return a; }
  if (k === '17+') return [17, 18, 19, 20, 21];
  if (k === 'A4-A5') return ['A4', 'A5'];
  if (k === 'A2-A3') return ['A2', 'A3'];
  return [k];
};

test('lib-blackjack: STRATEGY_TABLE 逐格與規格一致（硬/軟/對子全部格）', () => {
  assert.deepEqual(T.dealer, ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A']);
  let cells = 0;
  for (const [k, row] of Object.entries(SPEC_HARD)) for (const t of range(k)) {
    assert.deepEqual(T.hard[t], row.split(' '), `hard ${t}`); cells += 10;
  }
  for (const [k, row] of Object.entries(SPEC_SOFT)) for (const t of range(k)) {
    assert.deepEqual(T.soft[t], row.split(' '), `soft ${t}`); cells += 10;
  }
  for (const [k, row] of Object.entries(SPEC_PAIRS)) { assert.deepEqual(T.pairs[k], row.split(' '), `pair ${k}`); cells += 10; }
  assert.ok(cells >= 280);
  // 渲染用分組列都指向存在的列
  for (const r of T.rows.hard) assert.ok(T.hard[r.key]);
  for (const r of T.rows.soft) assert.ok(T.soft[r.key]);
  for (const r of T.rows.pairs) assert.ok(T.pairs[r.key]);
});

test('lib-blackjack: basicStrategy 抽樣 40 格（實際牌 → 建議）', () => {
  const cases = [
    // [玩家牌, 莊明牌, 期望]
    ['TS 6D', '6H', 'S'], ['TS 6D', '7H', 'H'], ['TS 6D', 'AH', 'H'], ['TS 2D', '2H', 'H'],
    ['TS 2D', '3H', 'H'], ['TS 2D', '4H', 'S'], ['TS 2D', '6H', 'S'], ['9S 4D', '2H', 'S'],
    ['9S 4D', '7H', 'H'], ['9S 5D', 'TH', 'H'], ['6S 5D', 'AH', 'H'], ['6S 5D', 'TH', 'D'],
    ['6S 5D', '2H', 'D'], ['6S 4D', '9H', 'D'], ['6S 4D', 'TH', 'H'], ['5S 4D', '2H', 'H'],
    ['5S 4D', '3H', 'D'], ['5S 4D', '7H', 'H'], ['5S 3D', '6H', 'H'], ['TS 7D', 'AH', 'S'],
    ['AS 8D', '6H', 'S'], ['AS 7D', '2H', 'S'], ['AS 7D', '3H', 'D'], ['AS 7D', '9H', 'H'],
    ['AS 7D', '8H', 'S'], ['AS 6D', '2H', 'H'], ['AS 6D', '3H', 'D'], ['AS 5D', '4H', 'D'],
    ['AS 5D', '3H', 'H'], ['AS 2D', '5H', 'D'], ['AS 2D', '4H', 'H'], ['AS AD', 'AH', 'P'],
    ['8S 8D', 'TH', 'P'], ['TS KD', '6H', 'S'], ['9S 9D', '7H', 'S'], ['9S 9D', '8H', 'P'],
    ['9S 9D', 'AH', 'S'], ['7S 7D', '7H', 'P'], ['7S 7D', '8H', 'H'], ['6S 6D', '2H', 'P'],
    ['6S 6D', '7H', 'H'], ['5S 5D', '9H', 'D'], ['5S 5D', 'TH', 'H'], ['4S 4D', '5H', 'P'],
    ['4S 4D', '4H', 'H'], ['3S 3D', '7H', 'P'], ['2S 2D', '8H', 'H'], ['AS 9D', '6H', 'S'],
  ];
  assert.ok(cases.length >= 30);
  for (const [p, d, e] of cases) {
    assert.equal(BJ.basicStrategy(P(p), LG.cards.parse(d)), e, `${p} vs ${d}`);
  }
  // 莊明牌也可用 rank 字串 / 數字
  assert.equal(BJ.basicStrategy(P('TS 6D'), 'A'), 'H');
  assert.equal(BJ.basicStrategy(P('TS 6D'), 6), 'S');
  assert.equal(BJ.basicStrategy(P('TS 6D'), 'K'), 'H');
});

test('lib-blackjack: 不能加倍/分牌時的退回', () => {
  assert.equal(BJ.basicStrategy(P('6S 3D 2C'), '5H'), 'H');              // 11 三張不能加倍 → H
  assert.equal(BJ.basicStrategy(P('6S 5D'), '5H', { canDouble: false }), 'H');
  assert.equal(BJ.basicStrategy(P('AS 7D'), '4H', { canDouble: false }), 'S'); // Ds → S
  assert.equal(BJ.basicStrategy(P('AS 2D 5C'), '4H'), 'S');                // 軟 18 三張 vs 4 → S
  assert.equal(BJ.basicStrategy(P('8S 8D'), 'TH', { canSplit: false }), 'H');  // 已分滿 → 硬 16
  assert.equal(BJ.basicStrategy(P('AS AD'), '6H', { canSplit: false }), 'H');  // 軟 12
  assert.equal(BJ.basicStrategy(P('4S 4D'), '5H', { das: false }), 'H');
  assert.equal(BJ.basicStrategy(P('TS 5D 6C'), '6H'), 'S');                // 21
  assert.equal(BJ.basicStrategy(P('AS 5D'), '6H', { canDouble: true }), 'D');
});

test('lib-blackjack: dealerPlay S17（A+6 停、硬 16 補）', () => {
  const shoe = LG.cards.newShoe(1).stack('5C 9D 2S');
  assert.deepEqual(BJ.dealerPlay(P('AS 6D'), shoe).map((c) => c.id), ['AS', '6D']);
  const hit16 = BJ.dealerPlay(P('TS 6D'), shoe); // 補 5C → 21
  assert.deepEqual(hit16.map((c) => c.id), ['TS', '6D', '5C']);
  // H17 選項：軟 17 繼續補
  const s2 = LG.cards.newShoe(1).stack('2C');
  assert.deepEqual(BJ.dealerPlay(P('AS 6D'), s2, { s17: false }).map((c) => c.id), ['AS', '6D', '2C']);
  // 多張補到 ≥ 17
  const s3 = LG.cards.newShoe(1).stack('2C 3D AH 4S');
  const r = BJ.dealerPlay(P('2S 3H'), s3);
  assert.ok(BJ.value(r).total >= 17);
  assert.deepEqual(r.map((c) => c.id), ['2S', '3H', '2C', '3D', 'AH']); // 5+2+3+A(11)=21 軟 → 停
  // 不改動原陣列
  const orig = P('TS 6D');
  BJ.dealerPlay(orig, LG.cards.newShoe(1).stack('KD'));
  assert.equal(orig.length, 2);
});
