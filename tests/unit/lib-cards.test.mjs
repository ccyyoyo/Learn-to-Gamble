import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

const LG = loadLG({ core: 'libs' });
const C = LG.cards;

test('lib-cards: newDeck 52 張不重複；jokers 加小丑', () => {
  const d = C.newDeck();
  assert.equal(d.length, 52);
  assert.equal(new Set(d.map((c) => c.id)).size, 52);
  const j = C.newDeck({ jokers: 1 });
  assert.equal(j.length, 53);
  assert.deepEqual(j[52], { rank: 'X', suit: 'J', id: 'XJ' });
  assert.ok(C.isJoker(j[52]));
});

test('lib-cards: Shoe draw/remaining/needsShuffle/burn/shuffle', () => {
  LG.rng.seed(1);
  const s = C.newShoe(8);
  assert.equal(s.remaining(), 416);
  s.burn(3);
  assert.equal(s.remaining(), 413);
  for (let i = 0; i < 413 - 15; i++) s.draw();
  assert.equal(s.remaining(), 15);
  assert.equal(s.needsShuffle(), false);
  s.draw();
  assert.equal(s.needsShuffle(), true); // 剩 14 = cutCard
  s.shuffle();
  assert.equal(s.remaining(), 416);
  assert.equal(s.needsShuffle(), false);
  const s2 = C.newShoe(1, { cutCard: 0 });
  for (let i = 0; i < 52; i++) s2.draw();
  assert.equal(s2.needsShuffle(), true);
  assert.ok(s2.draw()); // 用完自動重洗不丟錯
});

test('lib-cards: Shoe.stack 指定接下來的牌', () => {
  const s = C.newShoe(1);
  s.stack('AS KH').stack([C.parse('2C')]);
  assert.equal(s.draw().id, 'AS');
  assert.equal(s.draw().id, 'KH');
  assert.equal(s.draw().id, '2C');
});

test('lib-cards: seed 可重現', () => {
  LG.rng.seed(42);
  const a = C.newShoe(1).burn(10).map((c) => c.id).join();
  LG.rng.seed(42);
  const b = C.newShoe(1).burn(10).map((c) => c.id).join();
  assert.equal(a, b);
  LG.rng.seed(43);
  const c = C.newShoe(1).burn(10).map((c) => c.id).join();
  assert.notEqual(a, c);
});

test('lib-cards: parse / parseMany / label / suitName / rankValue', () => {
  assert.deepEqual(C.parse('AS'), { rank: 'A', suit: 'S', id: 'AS' });
  assert.equal(C.parse('10h').id, 'TH');
  assert.equal(C.parse('td').id, 'TD');
  assert.equal(C.parse('JOKER').id, 'XJ');
  assert.throws(() => C.parse('1S'));
  assert.deepEqual(C.parseMany('AS KH, 7D').map((c) => c.id), ['AS', 'KH', '7D']);
  assert.equal(C.label(C.parse('AS')), 'A♠');
  assert.equal(C.label(C.parse('TH')), '10♥');
  assert.equal(C.suitName('D').color, 'red');
  assert.equal(C.suitName('C').zh, '梅花');
  assert.equal(C.rankValue(C.parse('AS')), 14);
  assert.equal(C.rankValue(C.parse('2S')), 2);
  assert.equal(C.rankValue(C.parse('TS')), 10);
  assert.deepEqual(C.RANKS.length, 13);
  assert.deepEqual(C.SUITS, ['S', 'H', 'D', 'C']);
});

test('lib-dice: roll(n) 範圍與分布', () => {
  LG.rng.seed(7);
  assert.equal(LG.dice.roll().length, 3);
  assert.equal(LG.dice.roll(2).length, 2);
  const counts = [0, 0, 0, 0, 0, 0, 0];
  for (let i = 0; i < 20000; i++) for (const d of LG.dice.roll(3)) counts[d]++;
  assert.equal(counts[0], 0);
  for (let f = 1; f <= 6; f++) assert.ok(Math.abs(counts[f] / 60000 - 1 / 6) < 0.01, `face ${f}`);
  assert.equal(LG.dice.sum([1, 2, 6]), 9);
});
