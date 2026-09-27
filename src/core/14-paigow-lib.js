// LG.paigow — 牌九撲克評牌（含小丑）、房規排牌、比牌。見 docs/05-game-rules/paigow-poker.md
(() => {
  const LG = globalThis.LG;
  const P = LG.poker;
  const C = P.CATEGORY;
  const B5 = 1048576;
  const FIVE_ACES = 10;
  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const SUITS = ['S', 'H', 'D', 'C'];
  const RANKS = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'J', 'Q', 'K', 'A'];

  const CATEGORY = Object.assign({}, C, { FIVE_ACES });
  const CATEGORY_NAME = P.CATEGORY_NAME.concat([{ zh: '五條 A', en: 'Five Aces' }]);

  const isJoker = (c) => c.rank === 'X';
  /** 有效點數：小丑 = A(14)。 */
  const eff = (c) => (isJoker(c) ? 14 : RV[c.rank]);
  const byEffDesc = (a, b) => eff(b) - eff(a) || (isJoker(a) ? 1 : 0) - (isJoker(b) ? 1 : 0);
  const STRAIGHTISH = (cat) => cat === C.STRAIGHT || cat === C.FLUSH || cat === C.STRAIGHT_FLUSH || cat === C.ROYAL;

  /** 撲克分數 → 牌九分數：T-J-Q-K-A 順最大（15），A-2-3-4-5 第二大（14）。同花順同理。 */
  function remap(score) {
    const cat = Math.floor(score / B5);
    if (cat !== C.STRAIGHT && cat !== C.STRAIGHT_FLUSH) return score;
    const hi = ((score % B5) >> 16) & 15;
    const h = hi === 14 ? 15 : hi === 5 ? 14 : hi;
    return cat * B5 + (h << 16);
  }

  function wrap(res, cards, jokerAs) {
    return { cat: res.cat, score: remap(res.score), ranks: res.ranks, name: CATEGORY_NAME[res.cat], cards, jokerAs: jokerAs || null };
  }

  /**
   * 牌九高手牌（5 張）評牌，含小丑規則：小丑可當 A，或補順/同花/同花順（不能補對子）；
   * A-2-3-4-5 為第二大順（僅次 T-J-Q-K-A）；A-A-A-A+小丑 = 五條 A（最大）。
   * @param {Array} cards 5 張（可含 {rank:'X'} 小丑）
   * @returns {{cat:number, score:number, ranks:number[], name:{zh,en}, cards:Array, jokerAs:object|null}}
   *   cat 同 LG.poker.CATEGORY，另加 FIVE_ACES=10；score 可直接比較（也可與 eval2 的 score 比，見 isValidSplit）
   */
  function eval5(cards) {
    const ji = cards.findIndex(isJoker);
    if (ji < 0) return wrap(P.eval5(cards), cards);
    const others = cards.filter((c) => !isJoker(c));
    const have = new Set(others.map((c) => c.rank + c.suit));
    if (others.filter((c) => c.rank === 'A').length === 4) {
      return { cat: FIVE_ACES, score: FIVE_ACES * B5 + 0xEEEEE, ranks: [14, 14, 14, 14, 14], name: CATEGORY_NAME[FIVE_ACES], cards, jokerAs: { rank: 'A', suit: 'J', id: 'AJ' } };
    }
    let best = null, bestSub = null;
    const tryCard = (rank, suit, onlyStraightish) => {
      if (have.has(rank + suit)) return;
      const sub = { rank, suit, id: rank + suit };
      const raw = P.score(others.concat([sub]));
      if (onlyStraightish && !STRAIGHTISH(Math.floor(raw / B5))) return;
      const s = remap(raw);
      if (!best || s > best.s) { best = { s }; bestSub = sub; }
    };
    for (const s of SUITS) tryCard('A', s, false);                 // 當 A
    for (const s of SUITS) for (const r of RANKS) tryCard(r, s, true); // 補順/同花/同花順
    return wrap(P.eval5(others.concat([bestSub])), cards, bestSub);
  }

  /**
   * 牌九低手牌（2 張）：對子 > 高牌；小丑 = A。
   * @param {Array} cards 2 張
   * @returns {{cat:'PAIR'|'HIGH', score:number, ranks:number[], name:{zh,en}, cards:Array}}
   *   score 與 eval5 同一尺度（對子 = 一對 [p,p,0,0,0]），可直接比較高/低手
   */
  function eval2(cards) {
    const a = eff(cards[0]), b = eff(cards[1]);
    const hi = Math.max(a, b), lo = Math.min(a, b);
    if (a === b) return { cat: 'PAIR', score: 1 * B5 + (a << 16) + (a << 12), ranks: [a, a], name: { zh: '一對', en: 'Pair' }, cards };
    return { cat: 'HIGH', score: (hi << 16) + (lo << 12), ranks: [hi, lo], name: { zh: '高牌', en: 'High Card' }, cards };
  }

  /**
   * 7 張中最佳 5 張（Fortune 旁注等用）。
   * @param {Array} cards 5–7 張
   * @returns {object} eval5 結果 + best5
   */
  function best(cards) {
    let b = null;
    const n = cards.length;
    const idx = [];
    const rec = (start) => {
      if (idx.length === 5) {
        const h = idx.map((i) => cards[i]);
        const r = eval5(h);
        if (!b || r.score > b.score) b = r;
        return;
      }
      for (let i = start; i < n; i++) { idx.push(i); rec(i + 1); idx.pop(); }
    };
    rec(0);
    return Object.assign({}, b, { best5: b.cards });
  }

  /**
   * 是否合法分牌（高手牌必須 ≥ 低手牌，否則 Foul）。
   * @param {Array} high 5 張
   * @param {Array} low 2 張
   * @returns {boolean}
   */
  function isValidSplit(high, low) {
    if (!high || !low || high.length !== 5 || low.length !== 2) return false;
    return eval5(high).score >= eval2(low).score;
  }

  const sign = (x) => (x > 0 ? 1 : x < 0 ? -1 : 0);

  /**
   * 玩家 vs 莊家比牌（玩家不做莊）。高、低分別比；相同（copy）歸莊。
   * @param {{high:Array, low:Array}} playerSplit
   * @param {{high:Array, low:Array}} dealerSplit
   * @returns {{high:1|0|-1, low:1|0|-1, result:'win'|'lose'|'push', foul:boolean}}
   *   high/low：1 玩家贏、0 相同（copy，算莊贏）、-1 莊贏。兩邊都贏 → win（扣 5% 佣）；一贏一輸 → push；否則 lose。
   *   玩家 Foul（高 < 低）→ lose。
   */
  function compare(playerSplit, dealerSplit) {
    if (!isValidSplit(playerSplit.high, playerSplit.low)) return { high: -1, low: -1, result: 'lose', foul: true };
    const high = sign(eval5(playerSplit.high).score - eval5(dealerSplit.high).score);
    const low = sign(eval2(playerSplit.low).score - eval2(dealerSplit.low).score);
    const hw = high > 0, lw = low > 0;
    const result = hw && lw ? 'win' : (!hw && !lw) ? 'lose' : 'push';
    return { high, low, result, foul: false };
  }

  /**
   * 主注淨輸贏：win → +stake × 0.95（5% 佣）、push → 0、lose → −stake。
   * @param {number} stake
   * @param {'win'|'lose'|'push'} result
   * @returns {number}
   */
  function net(stake, result) {
    if (result === 'win') return Math.round(stake * 0.95 * 100) / 100;
    if (result === 'lose') return -stake;
    return 0;
  }

  // ---- 房規 House Way ----
  const RULE_TEXT = {
    1: '無對：最高牌放高手，次高兩張放低手',
    2: '一對：對子放高，最高兩張單牌放低',
    3: '兩對：兩對皆 ≤ 6 且有 A 單牌 → 兩對放高、A 放低；否則拆開，小對放低',
    4: '三對：最高的一對放低',
    5: '三條：三條放高、最高兩張單牌放低；三條 A → 拆一張 A 放低',
    6: '順/同花/同花順：能同時放一對到低手就這樣排；否則保留順/同花，低手放最大兩張',
    7: '葫蘆：拆開，對子放低（另有一對可放低則保留葫蘆）',
    8: '四條：2–6 不拆；7–10 拆，除非有對子可放低；J–A 一律拆成兩對',
    9: '五條 A：拆一對 A 放低',
  };

  const out = (high, low, rule) => ({ high: high.slice().sort(byEffDesc), low: low.slice().sort(byEffDesc), rule, why: RULE_TEXT[rule] });
  const minus = (all, ...parts) => { const s = new Set(parts.flat()); return all.filter((c) => !s.has(c)); };

  /**
   * 房規排牌（莊家永遠依此；玩家可按「房規排牌」）。依 paigow-poker.md §2 九條（優先序：9→8→7→6→4→3→5→2→1）。
   * 小丑分組時視為 A；順/同花由第 6 條以列舉所有分法處理（小丑可補）。
   * @param {Array} seven 7 張
   * @returns {{high:Array, low:Array, rule:number, why:string}} rule = 套用的房規條號
   */
  function houseWay(seven) {
    if (!seven || seven.length !== 7) throw new Error('HOUSEWAY_NEEDS_7');
    const cards = seven.slice().sort(byEffDesc);
    const groups = new Map();
    for (const c of cards) { const r = eff(c); if (!groups.has(r)) groups.set(r, []); groups.get(r).push(c); }
    const gl = [...groups.entries()].sort((a, b) => b[0] - a[0]); // [[rank, cards]] 由大到小
    const quints = gl.filter(([, g]) => g.length === 5).map(([, g]) => g);
    const quads = gl.filter(([, g]) => g.length === 4).map(([, g]) => g);
    const trips = gl.filter(([, g]) => g.length === 3).map(([, g]) => g);
    const pairs = gl.filter(([, g]) => g.length === 2).map(([, g]) => g);
    const singles = gl.filter(([, g]) => g.length === 1).map(([, g]) => g[0]); // 由大到小

    // 9. 五條 A
    if (quints.length) {
      const five = quints[0];
      const low = five.filter((c) => !isJoker(c)).slice(0, 2);
      return out(minus(cards, low), low, 9);
    }
    // 8. 四條
    if (quads.length) {
      const q = quads[0], qr = eff(q[0]);
      const rest = minus(cards, q);
      const restPair = bestPairIn(rest);
      if (qr <= 6 || (qr <= 10 && restPair)) {
        const low = restPair || rest.slice(0, 2);
        return out(minus(cards, low), low, 8);
      }
      const low = q.slice(0, 2);
      return out(minus(cards, low), low, 8);
    }
    // 7. 葫蘆（含兩組三條）
    if (trips.length >= 2) {
      const low = trips[0].slice(0, 2);
      return out(minus(cards, low), low, 7);
    }
    if (trips.length === 1 && pairs.length >= 2) {
      const low = pairs[0];
      return out(minus(cards, low), low, 7);
    }
    if (trips.length === 1 && pairs.length === 1) {
      const low = pairs[0];
      return out(minus(cards, low), low, 7);
    }
    // 6. 順 / 同花 / 同花順
    const six = straightFlushWay(cards, pairs.length);
    if (six) return six;
    // 4. 三對
    if (pairs.length === 3) {
      const low = pairs[0];
      return out(minus(cards, low), low, 4);
    }
    // 3. 兩對
    if (pairs.length === 2) {
      const [hp, lp] = pairs;
      const ace = singles.find((c) => eff(c) === 14);
      if (eff(hp[0]) <= 6 && ace) {
        const other = singles.filter((c) => c !== ace);
        const low = [ace, other[0]];
        return out(minus(cards, low), low, 3);
      }
      return out(minus(cards, lp), lp, 3);
    }
    // 5. 三條
    if (trips.length === 1) {
      const t = trips[0];
      if (eff(t[0]) === 14) {
        const a = t.find(isJoker) || t[t.length - 1];
        const low = [a, singles[0]];
        return out(minus(cards, low), low, 5);
      }
      const low = singles.slice(0, 2);
      return out(minus(cards, low), low, 5);
    }
    // 2. 一對
    if (pairs.length === 1) {
      const low = singles.slice(0, 2);
      return out(minus(cards, low), low, 2);
    }
    // 1. 無對
    const low = singles.slice(1, 3);
    return out(minus(cards, low), low, 1);
  }

  /** rest 中最大的一對（小丑視為 A），無則 null。 */
  function bestPairIn(rest) {
    const m = new Map();
    for (const c of rest) { const r = eff(c); if (!m.has(r)) m.set(r, []); m.get(r).push(c); }
    const ps = [...m.entries()].filter(([, g]) => g.length >= 2).sort((a, b) => b[0] - a[0]);
    return ps.length ? ps[0][1].slice(0, 2) : null;
  }

  /** 快速預檢：7 張（含小丑）是否可能組成順或同花。 */
  function maybeStraightish(cards) {
    const jk = cards.filter(isJoker).length;
    const sc = { S: 0, H: 0, D: 0, C: 0 };
    let mask = 0;
    for (const c of cards) {
      if (isJoker(c)) continue;
      sc[c.suit]++;
      const r = RV[c.rank];
      mask |= 1 << r;
      if (r === 14) mask |= 2;
    }
    if (Math.max(sc.S, sc.H, sc.D, sc.C) + jk >= 5) return true;
    for (let lo = 1; lo <= 10; lo++) {
      let n = 0;
      for (let r = lo; r < lo + 5; r++) if (mask & (1 << r)) n++;
      if (n + jk >= 5) return true;
    }
    return false;
  }

  /** 第 6 條：列舉 21 種分法中高手為順/同花/同花順者。 */
  function straightFlushWay(cards, nPairs) {
    if (!maybeStraightish(cards)) return null;
    const cands = [];
    for (let i = 0; i < 7; i++) for (let j = i + 1; j < 7; j++) {
      const low = [cards[i], cards[j]];
      const high = cards.filter((_, k) => k !== i && k !== j);
      const h = eval5(high);
      if (!STRAIGHTISH(h.cat)) continue;
      cands.push({ high, low, hs: h.score, ls: eval2(low).score, pair: eval2(low).cat === 'PAIR' });
    }
    if (!cands.length) return null;
    const pick = (list) => list.sort((a, b) => b.ls - a.ls || b.hs - a.hs)[0];
    const withPair = cands.filter((c) => c.pair);
    if (withPair.length) { const c = pick(withPair); return out(c.high, c.low, 6); }
    if (nPairs >= 2) return null; // 兩對/三對 → 依第 3、4 條
    const c = pick(cands);
    return out(c.high, c.low, 6);
  }

  LG.paigow = { CATEGORY, CATEGORY_NAME, RULE_TEXT, eval5, eval2, best, houseWay, isValidSplit, compare, net };
})();
