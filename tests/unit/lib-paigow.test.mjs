import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

// [slow] 測試：npm test 時略過（package.json 的 --test-name-pattern 負向前瞻在 Node 22 無效，見 docs/change-requests/core-b.md）
const SLOW = process.env.npm_lifecycle_event === 'test' && !process.env.SLOW ? { skip: '[slow] 請用 npm run test:slow' } : {};

const LG = loadLG({ core: 'libs' });
const PG = LG.paigow;
const K = PG.CATEGORY;
const P = LG.cards.parseMany;
const e5 = (s) => PG.eval5(P(s));
const ids = (a) => a.map((c) => c.id).sort().join(' ');
const sorted = (s) => s.split(' ').sort().join(' ');

test('lib-paigow: 小丑 — A-A-X-9-8 = 三條 A；補順；補同花；補同花順', () => {
  assert.equal(e5('AS AH XJ 9D 8C').cat, K.TRIPS);
  assert.equal(e5('AS AH XJ 9D 8C').ranks[0], 14);
  const st = e5('9S TD JC QH XJ');
  assert.equal(st.cat, K.STRAIGHT);
  assert.equal(st.ranks[0], 13, '補成 9-K（最大可能）');
  const gut = e5('9S TD QH KC XJ');
  assert.equal(gut.cat, K.STRAIGHT, '補中洞');
  const fl = e5('2H 7H 9H JH XJ');
  assert.equal(fl.cat, K.FLUSH);
  assert.equal(fl.ranks[0], 14, '小丑補同花時當 A♥');
  const fl2 = e5('AH 7H 9H JH XJ');
  assert.equal(fl2.cat, K.FLUSH);
  assert.equal(fl2.ranks[1], 13, 'A 已在 → 小丑當 K♥');
  assert.equal(e5('5H 6H 7H 8H XJ').cat, K.STRAIGHT_FLUSH);
  assert.equal(e5('TH JH QH KH XJ').cat, K.ROYAL);
});

test('lib-paigow: 小丑不能補對子（非 A 時只算 A 高牌）', () => {
  const r = e5('KS KH 7D 4C XJ');
  assert.equal(r.cat, K.PAIR, 'K K + 小丑 ≠ 三條 K');
  assert.deepEqual(r.ranks, [13, 13, 14, 7, 4]);
  assert.equal(e5('KS QH 7D 4C XJ').cat, K.HIGH);
  assert.equal(e5('KS QH 7D 4C XJ').ranks[0], 14);
  assert.equal(e5('7S 7H 7D 4C XJ').cat, K.TRIPS);
  assert.equal(e5('7S 7H 4D 4C XJ').cat, K.TWO_PAIR, '不能補成葫蘆');
  assert.equal(e5('AS AH 4D 4C XJ').cat, K.FULL_HOUSE, '當 A 可成葫蘆');
});

test('lib-paigow: 五條 A 最高', () => {
  const five = e5('AS AH AD AC XJ');
  assert.equal(five.cat, K.FIVE_ACES);
  assert.deepEqual(five.name, { zh: '五條 A', en: 'Five Aces' });
  assert.ok(five.score > e5('AS KS QS JS TS').score);
  assert.equal(PG.best(P('AS AH AD AC XJ 2C 3D')).cat, K.FIVE_ACES);
});

test('lib-paigow: A-2-3-4-5 第二大順（僅輸 T-J-Q-K-A，大於 9-T-J-Q-K）', () => {
  const wheel = e5('AS 2H 3D 4C 5S');
  const broadway = e5('TS JH QD KC AS');
  const nineK = e5('9S TH JD QC KS');
  assert.ok(wheel.score > nineK.score, 'A2345 > 9TJQK（房規）');
  assert.ok(broadway.score > wheel.score, 'TJQKA > A2345');
  assert.ok(wheel.score > e5('2S 3H 4D 5C 6S').score);
  // 同花順同理，但皇家仍最大
  const sw = e5('AH 2H 3H 4H 5H');
  assert.ok(sw.score > e5('9H TH JH QH KH').score);
  assert.ok(e5('TH JH QH KH AH').score > sw.score);
  // 小丑補成的 A2345 也是第二大
  assert.ok(e5('XJ 2H 3D 4C 5S').score > nineK.score);
});

test('lib-paigow: eval2 對子 > 高牌；小丑 = A', () => {
  assert.equal(PG.eval2(P('2S 2H')).cat, 'PAIR');
  assert.ok(PG.eval2(P('2S 2H')).score > PG.eval2(P('AS KH')).score);
  assert.equal(PG.eval2(P('AS XJ')).cat, 'PAIR');
  assert.deepEqual(PG.eval2(P('XJ 9H')).ranks, [14, 9]);
  assert.ok(PG.eval2(P('AS QH')).score > PG.eval2(P('KS JH')).score);
  assert.ok(PG.eval2(P('AS QH')).score > PG.eval2(P('AD JH')).score);
});

test('lib-paigow: isValidSplit 檢查 Foul', () => {
  assert.equal(PG.isValidSplit(P('KS 9D 7C 5H 3S'), P('AS 2D')), false, '高牌 K < 低 A');
  assert.equal(PG.isValidSplit(P('KS 9D 7C 5H 3S'), P('QS 2D')), true);
  assert.equal(PG.isValidSplit(P('5S 5D 7C 4H 3S'), P('6S 6D')), false, '一對 5 < 一對 6');
  assert.equal(PG.isValidSplit(P('6S 6H 7C 4H 3S'), P('6C 6D')), true, '一對 6 帶踢腳 ≥ 一對 6');
  assert.equal(PG.isValidSplit(P('AS 9D 7C 5H 3S'), P('AD 9H')), true, '相同高牌 A9 ≥ A9');
  assert.equal(PG.isValidSplit(P('AS 8D 7C 5H 3S'), P('AD 9H')), false);
  assert.equal(PG.isValidSplit(P('2S 3D 4C 5H 7S'), P('AD KH')), false);
  assert.equal(PG.isValidSplit(P('2S 2D 4C 5H 7S'), P('AD KH')), true, '一對 > 高牌');
  assert.equal(PG.isValidSplit(P('2S 2D 4C 5H'), P('AD KH')), false, '張數錯誤');
});

test('lib-paigow: compare — 兩贏 win、一贏一輸 push、copy 歸莊、Foul 輸', () => {
  const pl = { high: P('KS KD 7C 5H 3S'), low: P('AS QD') };
  const dl = { high: P('QS QD 7D 5C 3H'), low: P('KH JD') };
  assert.deepEqual(PG.compare(pl, dl), { high: 1, low: 1, result: 'win', foul: false });
  assert.equal(PG.compare(dl, pl).result, 'lose');
  const dl2 = { high: P('AS AD 7D 5C 3H'), low: P('KH JD') };
  assert.equal(PG.compare(pl, dl2).result, 'push');
  // copies：高相同、低玩家贏 → push；兩邊都相同 → lose
  const copyHigh = { high: P('KH KC 7S 5D 3C'), low: P('KC JD') };
  const r = PG.compare(pl, copyHigh);
  assert.equal(r.high, 0);
  assert.equal(r.result, 'push');
  const allCopy = { high: P('KH KC 7S 5D 3C'), low: P('AH QC') };
  const r2 = PG.compare(pl, allCopy);
  assert.deepEqual([r2.high, r2.low, r2.result], [0, 0, 'lose']);
  // Foul
  const foul = { high: P('KS 9D 7C 5H 3S'), low: P('AS 2D') };
  assert.equal(PG.compare(foul, dl).result, 'lose');
  assert.equal(PG.compare(foul, dl).foul, true);
  assert.equal(PG.net(100, 'win'), 95);
  assert.equal(PG.net(100, 'push'), 0);
  assert.equal(PG.net(100, 'lose'), -100);
});

// 房規九條，各至少一筆
const HW = [
  // [7 張, 期望低手, 條號]
  ['AS KD 9C 7H 5S 3D 2C', 'KD 9C', 1],
  ['QS QD AC KH 8S 5D 3C', 'AC KH', 2],
  ['5S 5D 3C 3H AS 9D 2C', 'AS 9D', 3],   // 兩對皆 ≤ 6 且有 A → 兩對放高、A 放低
  ['KS KD 4C 4H AS 9D 2C', '4C 4H', 3],   // 否則拆，小對放低
  ['6S 6D 4C 4H KS 9D 2C', '4C 4H', 3],   // ≤ 6 但沒有 A → 拆
  ['KS KD 8C 8H 4S 4D AC', 'KS KD', 4],
  ['9S 9D 9C AH KS 5D 2C', 'AH KS', 5],
  ['AS AD AC KH QS 5D 2C', 'AC KH', 5],   // 三條 A → 拆一張 A 放低
  ['4S 5D 6C 7H 8S KD 2C', 'KD 2C', 6],   // 順，無對
  ['5S 6D 7C 8H 9S KD KC', 'KD KC', 6],   // 順 + 對子可放低
  ['AH 9H 7H 4H 2H 7D KC', 'KC 7D', 6],   // 同花 + 對子無法放低 → 保留同花
  ['9S TD JC QH XJ 3D 2C', '3D 2C', 6],   // 小丑補順
  ['KS KD KC 4H 4S 9D 2C', '4H 4S', 7],
  ['KS KD KC 4H 4S 9D 9C', '9D 9C', 7],   // 另有一對可放低 → 保留葫蘆
  ['KS KD KC 4H 4S 4D 2C', 'KS KD', 7],   // 兩組三條
  ['5S 5D 5C 5H AS KD 2C', 'AS KD', 8],   // 四條 2–6 不拆
  ['9S 9D 9C 9H QS QD 2C', 'QS QD', 8],   // 7–10 有對子放低 → 不拆
  ['9S 9D 9C 9H AS KD 2C', '9S 9D', 8],   // 7–10 無對子 → 拆
  ['KS KD KC KH QS QD 2C', 'KS KD', 8],   // J–A 一律拆
  ['AS AD AC AH XJ KD 2C', 'AS AD', 9],   // 五條 A
];

test('lib-paigow: houseWay 九條規則', () => {
  const seen = new Set();
  for (const [h, low, rule] of HW) {
    const r = PG.houseWay(P(h));
    assert.equal(r.rule, rule, `${h} 條號`);
    assert.equal(ids(r.low), sorted(low), `${h} 低手`);
    assert.equal(r.high.length, 5);
    assert.equal(ids(r.high.concat(r.low)), sorted(h), '7 張都用到');
    assert.ok(PG.isValidSplit(r.high, r.low), `${h} 合法`);
    assert.ok(r.why);
    seen.add(rule);
  }
  assert.equal(seen.size, 9, '九條都有測資');
  // 抽查高手內容
  const five = PG.houseWay(P('AS AD AC AH XJ KD 2C'));
  assert.equal(PG.eval5(five.high).cat, K.TRIPS);
  const t = PG.houseWay(P('AS AD AC KH QS 5D 2C'));
  assert.equal(PG.eval5(t.high).cat, K.PAIR);
});

test('lib-paigow: houseWay 隨機 3000 手皆合法（含小丑）', () => {
  LG.rng.seed(77);
  const deck = LG.cards.newDeck({ jokers: 1 });
  for (let i = 0; i < 3000; i++) {
    LG.rng.shuffle(deck);
    const seven = deck.slice(0, 7);
    const r = PG.houseWay(seven);
    assert.equal(r.high.length, 5);
    assert.equal(r.low.length, 2);
    assert.equal(ids(r.high.concat(r.low)), ids(seven));
    assert.ok(PG.isValidSplit(r.high, r.low), seven.map((c) => c.id).join(' '));
  }
});

test('lib-paigow [slow]: 雙方房規 10 萬手 優勢 2%–4%、push 38%–44%', SLOW, () => {
  LG.rng.seed(3);
  const deck = LG.cards.newDeck({ jokers: 1 });
  const n = 100000;
  let net = 0, push = 0;
  for (let i = 0; i < n; i++) {
    LG.rng.shuffle(deck);
    const r = PG.compare(PG.houseWay(deck.slice(0, 7)), PG.houseWay(deck.slice(7, 14)));
    net += PG.net(1, r.result);
    if (r.result === 'push') push++;
  }
  const edge = (-net / n) * 100, pr = (push / n) * 100;
  assert.ok(edge > 2 && edge < 4, `edge ${edge}`);
  assert.ok(pr > 38 && pr < 44, `push ${pr}`);
});
