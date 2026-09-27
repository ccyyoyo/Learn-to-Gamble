import test from 'node:test';
import assert from 'node:assert/strict';
import { loadLG } from './_load.mjs';

// [slow] 測試：npm test 時略過（package.json 的 --test-name-pattern 負向前瞻在 Node 22 無效，見 docs/change-requests/core-b.md）
const SLOW = process.env.npm_lifecycle_event === 'test' && !process.env.SLOW ? { skip: '[slow] 請用 npm run test:slow' } : {};

const LG = loadLG({ core: 'libs' });
const B = LG.baccarat;
const P = LG.cards.parseMany;
const coup = (p, b) => B.resolveCoup(P(p), P(b));

test('lib-baccarat: point / total', () => {
  assert.equal(B.point(LG.cards.parse('AS')), 1);
  assert.equal(B.point(LG.cards.parse('9S')), 9);
  for (const r of 'TJQK') assert.equal(B.point(LG.cards.parse(r + 'S')), 0);
  assert.equal(B.total(P('9S 8H')), 7);
  assert.equal(B.total(P('KS QH')), 0);
  assert.equal(B.total(P('5S 5H 9D')), 9);
});

test('lib-baccarat: 閒補牌 0–5 補、6–7 停', () => {
  for (let t = 0; t <= 5; t++) assert.equal(B.playerDraws(t), true, `閒 ${t}`);
  for (let t = 6; t <= 9; t++) assert.equal(B.playerDraws(t), false, `閒 ${t}`);
});

test('lib-baccarat: 莊第三張牌規則表全部格（莊 0–7 × 閒第三張 0–9）', () => {
  // 規格 baccarat.md §2：1 = 補、0 = 停
  const TABLE = {
    0: '1111111111',
    1: '1111111111',
    2: '1111111111',
    3: '1111111101', // ≠8 補
    4: '0011111100', // 2–7 補
    5: '0000111100', // 4–7 補
    6: '0000001100', // 6–7 補
    7: '0000000000', // 停
  };
  let cells = 0;
  for (let b = 0; b <= 7; b++) {
    for (let p = 0; p <= 9; p++) {
      assert.equal(B.bankerDraws(b, p), TABLE[b][p] === '1', `莊 ${b} × 閒第三張 ${p}`);
      // 以牌物件（含 T/J/Q/K = 0）再驗一次
      const card = p === 0 ? LG.cards.parse('KD') : p === 1 ? LG.cards.parse('AD') : LG.cards.parse(p + 'D');
      assert.equal(B.bankerDraws(b, card), TABLE[b][p] === '1');
      cells++;
    }
  }
  assert.equal(cells, 80);
  // 閒未補牌：莊 0–5 補、6–7 停
  for (let b = 0; b <= 7; b++) assert.equal(B.bankerDraws(b, null), b <= 5, `閒停牌時莊 ${b}`);
});

test('lib-baccarat: 天牌後不補牌', () => {
  const shoe = LG.cards.newShoe(1).stack('8S 2H KD 3C 5S 5H'); // 閒 8S KD = 8；莊 2H 3C = 5
  const c = B.dealCoup(shoe);
  assert.equal(c.natural, true);
  assert.equal(c.playerCards, 2);
  assert.equal(c.bankerCards, 2);
  assert.equal(c.outcome, 'P');
  const c2 = coup('2S 3H', '9D KC'); // 莊天牌 9，閒 5 也不補
  assert.equal(c2.natural, true);
  assert.equal(c2.player.length, 2);
});

test('lib-baccarat: 閒 6/7 停；莊依閒是否補牌', () => {
  const c = coup('TS 6H', 'TD 5C 9S'); // 閒 6 停；莊 5 → 補（閒未補）
  assert.equal(c.playerCards, 2);
  assert.equal(c.bankerCards, 3);
  assert.equal(c.bTotal, 4);
  const c2 = coup('TS 7H', 'TD 6C'); // 閒 7 停；莊 6 停
  assert.equal(c2.bankerCards, 2);
  assert.equal(c2.outcome, 'P');
});

test('lib-baccarat: 閒補後莊依表（dealCoup 發牌順序 閒莊閒莊）', () => {
  // 閒 AS 4H = 5 → 補 8D；莊 KC 3S = 3，閒第三張 8 → 停
  let c = B.dealCoup(LG.cards.newShoe(1).stack('AS KC 4H 3S 8D 9C'));
  assert.deepEqual(c.player.map((x) => x.id), ['AS', '4H', '8D']);
  assert.deepEqual(c.banker.map((x) => x.id), ['KC', '3S']);
  assert.equal(c.pTotal, 3);
  assert.equal(c.bTotal, 3);
  assert.equal(c.outcome, 'T');
  // 同樣但閒第三張 7 → 莊 3 補
  c = B.dealCoup(LG.cards.newShoe(1).stack('AS KC 4H 3S 7D 5C'));
  assert.equal(c.bankerCards, 3);
  assert.equal(c.bTotal, 8);
  assert.equal(c.outcome, 'B');
});

test('lib-baccarat: 對子判定只看前兩張、bankerWinsWith6', () => {
  const c = coup('4S 4H', '5D 5C'); // 閒 8 天牌
  assert.equal(c.playerPair, true);
  assert.equal(c.bankerPair, true);
  const c2 = coup('2S 3D TC', '3S 3H'); // 閒 5+0；莊 6 停 → 莊 6 贏（兩張）
  assert.equal(c2.outcome, 'B');
  assert.equal(c2.bankerWinsWith6, true);
  assert.equal(c2.bankerCards, 2);
});

test('lib-baccarat: settle classic 莊贏 RM 100 → +95（拿回 195）', () => {
  const c = coup('2S 3D TC', 'TH 7C'); // 莊 7 贏
  const r = B.settle({ banker: 100, player: 50 }, c, 'classic');
  assert.equal(r.payouts.banker, 195);
  assert.equal(r.payouts.player, 0);
  assert.equal(r.net, 45);
  const line = r.lines.find((l) => l.spot === 'banker');
  assert.equal(line.result, 'win');
  assert.equal(line.pay, 95);
  assert.equal(line.formula, 'RM 100 × 0.95 = RM 95');
  assert.equal(r.lines.find((l) => l.spot === 'player').result, 'lose');
  // squeeze 同 classic
  assert.equal(B.settle({ banker: 100 }, c, 'squeeze').net, 95);
  // 奇數金額也正確（小數）
  assert.equal(B.settle({ banker: 25 }, c, 'classic').net, 23.75);
});

test('lib-baccarat: settle super6 / tiger 莊 6 點贏半賠；非 6 點全賠', () => {
  const six = coup('2S 3D TC', '3S 3H');
  assert.equal(B.settle({ banker: 100 }, six, 'super6').net, 50);
  assert.equal(B.settle({ banker: 100 }, six, 'tiger').net, 50);
  assert.equal(B.settle({ banker: 100 }, six, 'classic').net, 95);
  const seven = coup('2S 3D TC', 'TH 7C');
  assert.equal(B.settle({ banker: 100 }, seven, 'super6').net, 100);
  const r = B.settle({ super6: 10 }, six, 'super6');
  assert.equal(r.net, 120);
  assert.equal(r.payouts.super6, 130);
  assert.equal(B.settle({ super6: 10 }, seven, 'super6').net, -10);
});

test('lib-baccarat: 和局主注 push、和注 8:1', () => {
  const t = coup('TS 6D', 'TH 6C');
  assert.equal(t.outcome, 'T');
  for (const v of ['classic', 'super6', 'tiger']) {
    const r = B.settle({ banker: 100, player: 100, tie: 10 }, t, v);
    assert.equal(r.payouts.banker, 100);
    assert.equal(r.payouts.player, 100);
    assert.equal(r.payouts.tie, 90);
    assert.equal(r.net, 80);
    assert.equal(r.lines.find((l) => l.spot === 'banker').result, 'push');
  }
});

test('lib-baccarat: 對子 11:1；輸入格式（物件/陣列/Map/Bets-like）', () => {
  const c = coup('4S 4H', '5D 5C');
  const expect = { playerPair: 110, bankerPair: 110 };
  for (const bets of [
    { playerPair: 10, bankerPair: 10 },
    [['playerPair', 10], ['bankerPair', 10]],
    new Map([['playerPair', 10], ['bankerPair', 10]]),
    { entries: () => [['playerPair', 10], ['bankerPair', 10]] },
  ]) {
    const r = B.settle(bets, c, 'classic');
    assert.equal(r.net, expect.playerPair + expect.bankerPair);
  }
  assert.throws(() => B.settle({ nope: 10 }, c, 'classic'), /UNKNOWN_SPOT/);
});

test('lib-baccarat: Tiger 旁注實例', () => {
  const two6 = coup('2S 3D TC', '3S 3H');       // 莊兩張 6 贏；莊對
  const three6 = coup('2S 3D 6C', '2H 2D 2C');  // 閒 1；莊 4 + 2 = 6 三張贏；莊對
  const tie6 = coup('TS 6D', 'TH 6C');          // 6 點和
  const s = (bets, c) => B.settle(bets, c, 'tiger');
  assert.equal(three6.bankerCards, 3);
  assert.equal(three6.bTotal, 6);
  assert.equal(three6.outcome, 'B');
  // Tiger：兩張 12:1、三張 20:1
  assert.equal(s({ tiger: 10 }, two6).net, 120);
  assert.equal(s({ tiger: 10 }, three6).net, 200);
  assert.equal(s({ tiger: 10 }, tie6).net, -10);
  // Big Tiger 50:1（三張）；Small Tiger 22:1（兩張）
  assert.equal(s({ bigTiger: 10 }, three6).net, 500);
  assert.equal(s({ bigTiger: 10 }, two6).net, -10);
  assert.equal(s({ smallTiger: 10 }, two6).net, 220);
  assert.equal(s({ smallTiger: 10 }, three6).net, -10);
  // Tiger Tie 35:1
  assert.equal(s({ tigerTie: 10 }, tie6).net, 350);
  assert.equal(s({ tigerTie: 10 }, coup('TS 7D', 'TH 7C')).net, -10);
  // Tiger Pair：單邊 4:1、雙邊 20:1、雙邊同 rank 100:1
  assert.equal(s({ tigerPair: 10 }, two6).net, 40);
  assert.equal(s({ tigerPair: 10 }, coup('4S 4H', '5D 5C')).net, 200);
  assert.equal(s({ tigerPair: 10 }, coup('8S 8D', '8H 8C')).net, 1000);
  assert.equal(s({ tigerPair: 10 }, coup('TS 7D', 'TH 7C')).net, -10);
  const r = s({ tiger: 10 }, three6);
  assert.equal(r.lines[0].formula, 'RM 10 × 20 = RM 200');
});

test('lib-baccarat: Monte Carlo 5 萬局粗檢（莊 > 閒 > 和）', () => {
  LG.rng.seed(2024);
  const shoe = LG.cards.newShoe(8);
  const n = 50000;
  const k = { P: 0, B: 0, T: 0 };
  for (let i = 0; i < n; i++) {
    if (shoe.needsShuffle()) shoe.shuffle();
    k[B.dealCoup(shoe).outcome]++;
  }
  assert.ok(Math.abs(k.B / n - 0.4586) < 0.01);
  assert.ok(Math.abs(k.P / n - 0.4462) < 0.01);
  assert.ok(Math.abs(k.T / n - 0.0952) < 0.006);
});

test('lib-baccarat [slow]: Monte Carlo 100 萬局 莊 45.86% / 閒 44.62% / 和 9.52%（±0.3%）與主注優勢', SLOW, () => {
  LG.rng.seed(123);
  const shoe = LG.cards.newShoe(8);
  const n = 1000000;
  const k = { P: 0, B: 0, T: 0 };
  let bankNet = 0, playNet = 0;
  for (let i = 0; i < n; i++) {
    if (shoe.needsShuffle()) shoe.shuffle();
    const c = B.dealCoup(shoe);
    k[c.outcome]++;
    if (c.outcome === 'B') { bankNet += 0.95; playNet -= 1; }
    else if (c.outcome === 'P') { bankNet -= 1; playNet += 1; }
  }
  const pct = (x) => (x / n) * 100;
  assert.ok(Math.abs(pct(k.B) - 45.86) < 0.3, `莊 ${pct(k.B)}`);
  assert.ok(Math.abs(pct(k.P) - 44.62) < 0.3, `閒 ${pct(k.P)}`);
  assert.ok(Math.abs(pct(k.T) - 9.52) < 0.3, `和 ${pct(k.T)}`);
  assert.ok(Math.abs(pct(bankNet) + 1.06) < 0.3, `莊優勢 ${pct(bankNet)}`);
  assert.ok(Math.abs(pct(playNet) + 1.24) < 0.3, `閒優勢 ${pct(playNet)}`);
});
