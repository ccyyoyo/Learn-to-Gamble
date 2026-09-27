import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ core: 'libs' });
const PK = LG.poker;
const K = PK.CATEGORY;
const P = LG.cards.parseMany;
const e5 = (s) => PK.eval5(P(s));

test('lib-poker: eval5 全部 10 類別', () => {
  const cases = [
    ['AS KS QS JS TS', K.ROYAL],
    ['9H 8H 7H 6H 5H', K.STRAIGHT_FLUSH],
    ['7S 7H 7D 7C 2S', K.QUADS],
    ['KS KH KD 4C 4S', K.FULL_HOUSE],
    ['AD 9D 7D 4D 2D', K.FLUSH],
    ['9S 8H 7D 6C 5S', K.STRAIGHT],
    ['QS QH QD 9C 2S', K.TRIPS],
    ['JS JH 4D 4C AS', K.TWO_PAIR],
    ['TS TH 8D 4C 2S', K.PAIR],
    ['AS JH 8D 4C 2S', K.HIGH],
  ];
  for (const [h, cat] of cases) {
    const r = e5(h);
    assert.equal(r.cat, cat, h);
    assert.deepEqual(r.name, PK.CATEGORY_NAME[cat]);
  }
  // 類別嚴格遞增
  for (let i = 1; i < cases.length; i++) assert.ok(e5(cases[i - 1][0]).score > e5(cases[i][0]).score);
});

test('lib-poker: 邊界 — 輪子順、A 高順、同花順 vs 皇家', () => {
  const wheel = e5('AS 2H 3D 4C 5S');
  assert.equal(wheel.cat, K.STRAIGHT);
  assert.deepEqual(wheel.ranks, [5, 4, 3, 2, 1]);
  const six = e5('2H 3D 4C 5S 6S');
  assert.ok(six.score > wheel.score, '6 高順 > 輪子');
  const broadway = e5('TS JH QD KC AS');
  assert.equal(broadway.cat, K.STRAIGHT);
  assert.equal(broadway.ranks[0], 14);
  assert.ok(broadway.score > e5('9S TH JD QC KS').score);
  assert.equal(e5('QS KH AD 2C 3S').cat, K.HIGH, 'Q-K-A-2-3 不是順');
  const steelWheel = e5('AH 2H 3H 4H 5H');
  assert.equal(steelWheel.cat, K.STRAIGHT_FLUSH);
  assert.ok(e5('KH QH JH TH 9H').score > steelWheel.score);
  assert.ok(e5('AH KH QH JH TH').score > e5('KH QH JH TH 9H').score);
  assert.equal(e5('AH KH QH JH TH').cat, K.ROYAL);
  assert.ok(steelWheel.score > e5('AS AH AD AC KS').score, '最小同花順 > 四條 A');
});

test('lib-poker: 踢腳與同類比較', () => {
  assert.ok(PK.compare(e5('AS AH KD 4C 2S'), e5('AS AH QD JC TS')) > 0);
  assert.ok(PK.compare(e5('KS KH 4D 4C AS'), e5('KS KH 4D 4C QS')) > 0);
  assert.ok(PK.compare(e5('KS KH 5D 5C 2S'), e5('KS KH 4D 4C AS')) > 0);
  assert.ok(PK.compare(e5('3S 3H 3D 2C 2S'), e5('2S 2H 2D AC AS')) > 0);
  assert.equal(PK.compare(e5('AS KD 9C 7H 5S'), e5('AH KC 9D 7S 5H')), 0);
  assert.ok(PK.compare(e5('AD 9D 7D 4D 3D'), e5('AS 9S 7S 4S 2S')) > 0);
  assert.ok(PK.compare(P('AS AH KD 4C 2S'), P('AS AH QD JC TS')) > 0, 'compare 也接受牌陣列');
});

test('lib-poker: best() 7 張取最佳 5 張', () => {
  let r = PK.best(P('AS KS 2H 3D 4C 5S 9H'));
  assert.equal(r.cat, K.STRAIGHT);
  assert.equal(r.ranks[0], 5);
  assert.equal(r.best5.length, 5);
  r = PK.best(P('AH 2H 3H 4H 5H 6H 7D')); // 同花 A-6 → 6 高同花順（非輪子）
  assert.equal(r.cat, K.STRAIGHT_FLUSH);
  assert.equal(r.ranks[0], 6);
  assert.deepEqual(r.best5.map((c) => c.id).sort(), ['2H', '3H', '4H', '5H', '6H']);
  r = PK.best(P('KS KH KD 4C 4S 4D 2S')); // 兩組三條 → 葫蘆 K 帶 4
  assert.equal(r.cat, K.FULL_HOUSE);
  assert.deepEqual(r.ranks, [13, 13, 13, 4, 4]);
  r = PK.best(P('JS JH 9D 9C 4S 4D AS')); // 三對 → 兩對 J9 + A
  assert.equal(r.cat, K.TWO_PAIR);
  assert.deepEqual(r.ranks, [11, 11, 9, 9, 14]);
  r = PK.best(P('QS QH QD QC 4S 4D 9S'));
  assert.equal(r.cat, K.QUADS);
  assert.deepEqual(r.ranks, [12, 12, 12, 12, 9]);
  r = PK.best(P('AS KS QS JS TS 9S 8S'));
  assert.equal(r.cat, K.ROYAL);
  r = PK.best(P('2D 7D 9D JD KD AD 3C'));
  assert.equal(r.cat, K.FLUSH);
  assert.deepEqual(r.ranks, [14, 13, 11, 9, 7]);
  assert.ok(r.best5.every((c) => c.suit === 'D'));
  // 同花 + 順：取同花
  assert.equal(PK.best(P('5D 6D 7C 8D 9S 2D KD')).cat, K.FLUSH);
  // 6 張、5 張、2 張也可用
  assert.equal(PK.best(P('AS AH 3D 4C 5S 9H')).cat, K.PAIR);
  assert.equal(PK.best(P('AS AH')).cat, K.PAIR);
  // score() 與 best 一致
  const h = P('9S 9H 3D 3C 7S KD 2C');
  assert.equal(PK.score(h), PK.best(h).score);
});

test('lib-poker: best(7) 與暴力 21 組 eval5 一致（隨機 3000 手）', () => {
  LG.rng.seed(99);
  const deck = LG.cards.newDeck();
  for (let t = 0; t < 3000; t++) {
    LG.rng.shuffle(deck);
    const h = deck.slice(0, 7);
    let m = 0;
    for (let a = 0; a < 7; a++) for (let b = a + 1; b < 7; b++) {
      const five = h.filter((_, i) => i !== a && i !== b);
      m = Math.max(m, PK.eval5(five).score);
    }
    const r = PK.best(h);
    assert.equal(r.score, m);
    assert.equal(PK.eval5(r.best5).score, m, 'best5 本身評分一致');
  }
});

test('lib-poker: 效能 best(7) ≥ 100k 次/秒（目標 200k）', () => {
  LG.rng.seed(5);
  const deck = LG.cards.newDeck();
  const hands = [];
  for (let i = 0; i < 5000; i++) { LG.rng.shuffle(deck); hands.push(deck.slice(0, 7)); }
  for (let i = 0; i < 5000; i++) PK.best(hands[i]); // warm-up
  const t0 = process.hrtime.bigint();
  let n = 0;
  while (n < 200000) { PK.best(hands[n % 5000]); n++; }
  const sec = Number(process.hrtime.bigint() - t0) / 1e9;
  const rate = n / sec;
  assert.ok(rate >= 100000, `best(7) ${Math.round(rate)}/s`);
});

test('lib-poker: eval3 排序 同花順 > 三條 > 順 > 同花 > 一對 > 高牌', () => {
  const e3 = (s) => PK.eval3(P(s));
  const order = ['4H 5H 6H', '2S 2H 2D', '9S TH JD', 'AS 9S 4S', 'KS KH 2D', 'AS KH JD'];
  const cats = ['SF', 'TRIPS', 'STRAIGHT', 'FLUSH', 'PAIR', 'HIGH'];
  order.forEach((h, i) => assert.equal(e3(h).cat, cats[i], h));
  for (let i = 1; i < order.length; i++) assert.ok(e3(order[i - 1]).score > e3(order[i]).score, `${order[i - 1]} > ${order[i]}`);
  // 順：A-2-3 最小、Q-K-A 最大
  const a23 = e3('AS 2H 3D'), qka = e3('QS KH AD'), s234 = e3('2S 3H 4D');
  assert.equal(a23.cat, 'STRAIGHT');
  assert.equal(qka.cat, 'STRAIGHT');
  assert.ok(s234.score > a23.score);
  assert.ok(qka.score > e3('JS QH KD').score);
  assert.equal(e3('KS AH 2D').cat, 'HIGH', 'K-A-2 不是順');
  assert.equal(e3('AH 2H 3H').cat, 'SF');
  assert.ok(e3('AH KH QH').score > e3('AH 2H 3H').score);
  // 順 > 同花（教學重點）
  assert.ok(e3('2S 3H 4D').score > e3('AS KS JS').score);
  // Q-6-4 邊界比較可直接用 score
  const q64 = e3('QS 6H 4D'), q63 = e3('QS 6H 3D');
  assert.ok(q64.score > q63.score);
  assert.deepEqual(q64.ranks, [12, 6, 4]);
  assert.deepEqual(e3('9S 9H KD').ranks, [9, 9, 13]);
});

test('lib-poker: describe 繁中 + 英文', () => {
  assert.equal(PK.describe(e5('KS KH 8D 4C 2S')), '一對 K（Pair of Kings）');
  assert.equal(PK.describe(e5('AS KS QS JS TS')), '皇家同花順（Royal Flush）');
  assert.equal(PK.describe(e5('AS 2H 3D 4C 5S')), '5 高順子（Straight, Five High）');
  assert.equal(PK.describe(e5('KS KH KD 4C 4S')), '葫蘆 K 帶 4（Full House, Kings full of Fours）');
  assert.equal(PK.describe(e5('6S 6H 4D 4C 2S')), '兩對 6 和 4（Two Pair, Sixes and Fours）');
  assert.equal(PK.describe(e5('AS JH 8D 4C 2S')), 'A 高牌（Ace High）');
  assert.equal(PK.describe(P('9S 9H 9D')), '三條 9（Three Nines）');
  assert.match(PK.describe(P('AS AH 3D 4C 5S 9H KD')), /一對 A（Pair of Aces）/);
});

test('lib-poker: equity Monte Carlo 合理', () => {
  LG.rng.seed(11);
  const aa = PK.equity(P('AS AH'), [], 1, 4000);
  assert.ok(aa > 0.82 && aa < 0.88, `AA vs 1 = ${aa}`);
  const aa3 = PK.equity(P('AS AH'), [], 3, 3000);
  assert.ok(aa3 > 0.58 && aa3 < 0.70, `AA vs 3 = ${aa3}`);
  const nuts = PK.equity(P('AS KS'), P('QS JS TS 2D 3C'), 2, 500);
  assert.equal(nuts, 1);
  const d = PK.equityDetail(P('7C 2D'), [], 1, 3000);
  assert.ok(d.equity > 0.28 && d.equity < 0.40, `72o ${d.equity}`);
  assert.ok(Math.abs(d.win + d.tie + d.lose - 1) < 1e-9);
  // 公牌鎖死平手 → 0.5
  assert.equal(PK.equity(P('2C 3D'), P('AS KS QS JS TS'), 1, 300), 0.5);
});

test('lib-poker: outs 同花聽 9、兩頭順聽 8', () => {
  assert.equal(PK.outs(P('AH KH'), P('2H 7H 9C')), 9 + 6); // 9 張同花 + A/K 各 3 張成對
  const fd = PK.outsDetail(P('AH KH'), P('2H 7H 9C'));
  const flushOuts = fd.cards.filter((c) => c.suit === 'H').length;
  assert.equal(flushOuts, 9);
  assert.equal(PK.outs(P('8S 9D'), P('TC JH 2S')), 8 + 6); // 8 張成順 + 3×2 張成對（8、9 各 3 張）
  const oesd = PK.outsDetail(P('8S 9D'), P('TC JH 2S')).cards.filter((c) => c.rank === '7' || c.rank === 'Q');
  assert.equal(oesd.length, 8);
  assert.equal(PK.outs(P('AS KD'), []), 0);
  assert.equal(PK.outs(P('AS KD'), P('2C 3C 4C 5C 6C')), 0);
});
