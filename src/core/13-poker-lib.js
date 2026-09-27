// LG.poker — 5/7 張評牌、三張撲克、勝率 Monte Carlo、outs、描述。見 docs/02-architecture.md §2.10
(() => {
  const LG = globalThis.LG;

  const CATEGORY = { HIGH: 0, PAIR: 1, TWO_PAIR: 2, TRIPS: 3, STRAIGHT: 4, FLUSH: 5, FULL_HOUSE: 6, QUADS: 7, STRAIGHT_FLUSH: 8, ROYAL: 9 };
  const CATEGORY_NAME = [
    { zh: '高牌', en: 'High Card' },
    { zh: '一對', en: 'One Pair' },
    { zh: '兩對', en: 'Two Pair' },
    { zh: '三條', en: 'Three of a Kind' },
    { zh: '順子', en: 'Straight' },
    { zh: '同花', en: 'Flush' },
    { zh: '葫蘆', en: 'Full House' },
    { zh: '四條', en: 'Four of a Kind' },
    { zh: '同花順', en: 'Straight Flush' },
    { zh: '皇家同花順', en: 'Royal Flush' },
  ];

  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const SI = { S: 0, H: 1, D: 2, C: 3 };
  const SUIT_CH = ['S', 'H', 'D', 'C'];
  const B5 = 1048576; // 16^5：score = cat × 16^5 + 5 個 rank nibble

  // 直線表：mask（bit r = 有 rank r，bit 1 = A 當 1）→ 順子最高張（0 = 無）
  const STRAIGHT_HIGH = new Uint8Array(1 << 15);
  for (let m = 0; m < (1 << 15); m++) {
    for (let h = 14; h >= 5; h--) {
      const need = 0x1F << (h - 4);
      if ((m & need) === need) { STRAIGHT_HIGH[m] = h; break; }
    }
  }
  const withLowAce = (m) => (m & (1 << 14)) ? (m | 2) : m;
  const encStraight = (h) => h === 5 ? (((5 * 16 + 4) * 16 + 3) * 16 + 2) * 16 + 1
    : ((((h * 16 + h - 1) * 16 + h - 2) * 16 + h - 3) * 16 + h - 4);

  // ---- 評牌核心：在共用暫存陣列上運算（避免配置），回傳 score ----
  const R = new Int32Array(16), S = new Int32Array(16);
  const cnt = new Int32Array(15), sc = new Int32Array(4), sm = new Int32Array(4);

  /** 對 R[0..n)、S[0..n) 評分（n 可為 1–7；需無重複牌）。 */
  function core(n) {
    for (let i = 2; i < 15; i++) cnt[i] = 0;
    sc[0] = sc[1] = sc[2] = sc[3] = 0; sm[0] = sm[1] = sm[2] = sm[3] = 0;
    let mask = 0;
    for (let i = 0; i < n; i++) {
      const r = R[i], s = S[i];
      cnt[r]++; sc[s]++; sm[s] |= 1 << r; mask |= 1 << r;
    }
    let fs = -1;
    for (let s = 0; s < 4; s++) if (sc[s] >= 5) fs = s;
    if (fs >= 0) {
      const h = STRAIGHT_HIGH[withLowAce(sm[fs])];
      if (h) return (h === 14 ? 9 : 8) * B5 + encStraight(h);
    }
    // 由大到小掃描分組
    let q = 0, t1 = 0, t2 = 0, p1 = 0, p2 = 0, p3 = 0;
    for (let r = 14; r >= 2; r--) {
      const c = cnt[r];
      if (c >= 4) { if (!q) q = r; }
      else if (c === 3) { if (!t1) t1 = r; else if (!t2) t2 = r; }
      else if (c === 2) { if (!p1) p1 = r; else if (!p2) p2 = r; else if (!p3) p3 = r; }
    }
    if (q) {
      let k = 0;
      for (let r = 14; r >= 2; r--) if (r !== q && cnt[r]) { k = r; break; }
      return 7 * B5 + (((q * 16 + q) * 16 + q) * 16 + q) * 16 + k;
    }
    if (t1 && (t2 || p1)) {
      const pr = t2 > p1 ? t2 : p1;
      return 6 * B5 + (((t1 * 16 + t1) * 16 + t1) * 16 + pr) * 16 + pr;
    }
    if (fs >= 0) {
      let e = 0, k = 0;
      const m = sm[fs];
      for (let r = 14; r >= 2 && k < 5; r--) if (m & (1 << r)) { e = e * 16 + r; k++; }
      return 5 * B5 + e;
    }
    const sh = STRAIGHT_HIGH[withLowAce(mask)];
    if (sh) return 4 * B5 + encStraight(sh);
    // 其餘：依序取 k 張非排除 rank 當踢腳
    const kick = (e, need, x1, x2) => {
      let k = 0;
      for (let r = 14; r >= 2 && k < need; r--) if (cnt[r] && r !== x1 && r !== x2) { e = e * 16 + r; k++; }
      for (; k < need; k++) e *= 16;
      return e;
    };
    if (t1) return 3 * B5 + kick((t1 * 16 + t1) * 16 + t1, 2, t1, 0);
    if (p1 && p2) return 2 * B5 + kick((((p1 * 16 + p1) * 16 + p2) * 16 + p2), 1, p1, p2);
    if (p1) return 1 * B5 + kick(p1 * 16 + p1, 3, p1, 0);
    return kick(0, 5, 0, 0);
  }

  function loadCards(cards) {
    const n = cards.length;
    for (let i = 0; i < n; i++) {
      const c = cards[i];
      const r = RV[c.rank], s = SI[c.suit];
      if (r === undefined || s === undefined) throw new Error('BAD_CARD:' + (c && c.id));
      R[i] = r; S[i] = s;
    }
    return n;
  }

  /** score → ranks 陣列（去掉補位的 0；輪子順 A 以 1 表示） */
  function ranksOf(score) {
    const out = [];
    const e = score % B5;
    for (let i = 16; i >= 0; i -= 4) { const v = (e >> i) & 15; if (v) out.push(v); }
    return out;
  }

  /** 由 ranks 從 cards 中挑出對應牌（best5）。 */
  function pickCards(cards, cat, ranks) {
    let pool = cards.slice();
    if (cat === CATEGORY.FLUSH || cat === CATEGORY.STRAIGHT_FLUSH || cat === CATEGORY.ROYAL) {
      const bySuit = {};
      for (const c of pool) (bySuit[c.suit] = bySuit[c.suit] || []).push(c);
      pool = Object.values(bySuit).find((a) => a.length >= 5) || pool;
    }
    const out = [];
    for (const r0 of ranks) {
      const r = r0 === 1 ? 14 : r0;
      const i = pool.findIndex((c) => RV[c.rank] === r);
      if (i >= 0) out.push(pool.splice(i, 1)[0]);
    }
    return out;
  }

  function makeResult(score, cards) {
    const cat = Math.floor(score / B5);
    const ranks = ranksOf(score);
    return { cat, score, ranks, name: CATEGORY_NAME[cat], cards };
  }

  /**
   * 評 5 張牌。
   * @param {Array} cards 5 張牌物件
   * @returns {{cat:number, score:number, ranks:number[], name:{zh,en}, cards:Array}}
   *   score 越大越強可直接比較；ranks 依重要性排列（例：葫蘆 [K,K,K,7,7]；輪子順 [5,4,3,2,1]）
   */
  function eval5(cards) {
    const score = core(loadCards(cards));
    return makeResult(score, cards);
  }

  /**
   * 1–7 張取最佳 5 張（德州撲克 7 張、梭哈 5 張；少於 5 張時只評對子/高牌）。
   * @param {Array} cards
   * @returns {{cat, score, ranks, name, cards:Array, best5:Array}} cards 與 best5 皆為最佳 5 張（依 ranks 順序）
   */
  function best(cards) {
    const score = core(loadCards(cards));
    const cat = Math.floor(score / B5);
    const ranks = ranksOf(score);
    const best5 = pickCards(cards, cat, ranks);
    return { cat, score, ranks, name: CATEGORY_NAME[cat], cards: best5, best5 };
  }

  /**
   * 只回傳分數（最快；大量模擬用）。
   * @param {Array} cards 1–7 張
   * @returns {number}
   */
  function score(cards) { return core(loadCards(cards)); }

  /**
   * 比較兩手（評牌結果或牌陣列皆可）。
   * @returns {number} >0 a 強、<0 b 強、0 平
   */
  function compare(a, b) {
    const sa = Array.isArray(a) ? score(a) : a.score;
    const sb = Array.isArray(b) ? score(b) : b.score;
    return sa - sb;
  }

  // ---- Three Card Poker ----
  const CAT3 = { HIGH: 0, PAIR: 1, FLUSH: 2, STRAIGHT: 3, TRIPS: 4, SF: 5 };
  const CAT3_KEYS = ['HIGH', 'PAIR', 'FLUSH', 'STRAIGHT', 'TRIPS', 'SF'];
  const CAT3_NAME = {
    SF: { zh: '同花順', en: 'Straight Flush' },
    TRIPS: { zh: '三條', en: 'Three of a Kind' },
    STRAIGHT: { zh: '順子', en: 'Straight' },
    FLUSH: { zh: '同花', en: 'Flush' },
    PAIR: { zh: '一對', en: 'Pair' },
    HIGH: { zh: '高牌', en: 'High Card' },
  };

  /**
   * 三張撲克評牌：同花順 > 三條 > 順 > 同花 > 一對 > 高牌。A-2-3 最小順、Q-K-A 最大順。
   * @param {Array} cards 3 張
   * @returns {{cat:'SF'|'TRIPS'|'STRAIGHT'|'FLUSH'|'PAIR'|'HIGH', level:number, score:number, ranks:number[], name:{zh,en}, cards:Array}}
   *   ranks 依重要性（例：一對 [9,9,K]；A-2-3 順 [3,2,1]）；比 Q-6-4 可直接比 ranks
   */
  function eval3(cards) {
    const r = cards.map((c) => RV[c.rank]).sort((a, b) => b - a);
    const flush = cards[0].suit === cards[1].suit && cards[1].suit === cards[2].suit;
    let straightHigh = 0;
    if (r[0] !== r[1] && r[1] !== r[2]) {
      if (r[0] - r[2] === 2) straightHigh = r[0];
      else if (r[0] === 14 && r[1] === 3 && r[2] === 2) straightHigh = 3;
    }
    let key, ranks;
    if (straightHigh && flush) key = 'SF';
    else if (r[0] === r[2]) key = 'TRIPS';
    else if (straightHigh) key = 'STRAIGHT';
    else if (flush) key = 'FLUSH';
    else if (r[0] === r[1] || r[1] === r[2]) key = 'PAIR';
    else key = 'HIGH';
    if (straightHigh && (key === 'SF' || key === 'STRAIGHT')) ranks = [straightHigh, straightHigh - 1, straightHigh - 2 || 1];
    else if (key === 'PAIR') ranks = r[0] === r[1] ? [r[0], r[0], r[2]] : [r[1], r[1], r[0]];
    else ranks = r;
    const level = CAT3[key];
    const sc = level * 4096 + (ranks[0] * 16 + ranks[1]) * 16 + ranks[2];
    return { cat: key, level, score: sc, ranks, name: CAT3_NAME[key], cards };
  }

  // ---- 勝率 / outs ----
  const toInt = (c) => RV[c.rank] * 4 + SI[c.suit];
  function scoreInts(arr, n) {
    for (let i = 0; i < n; i++) { const v = arr[i]; R[i] = v >> 2; S[i] = v & 3; }
    return core(n);
  }

  /**
   * 德州撲克勝率（Monte Carlo）。平手依人數分攤。
   * @param {Array} hole 自己兩張
   * @param {Array} board 公共牌 0–5 張
   * @param {number} [nOpponents=1] 對手人數（手牌未知）
   * @param {number} [iters=2000] 模擬次數（AI 建議 300；提示 1000–2000）
   * @returns {number} 0–1（win + tie 分攤）
   */
  function equity(hole, board = [], nOpponents = 1, iters = 2000) {
    return equityDetail(hole, board, nOpponents, iters).equity;
  }

  /**
   * 同 equity，但回傳細項。
   * @returns {{equity:number, win:number, tie:number, lose:number, iters:number}}
   */
  function equityDetail(hole, board = [], nOpponents = 1, iters = 2000) {
    const known = new Set();
    const heroFixed = [], boardFixed = [];
    for (const c of hole) { const v = toInt(c); heroFixed.push(v); known.add(v); }
    for (const c of board) { const v = toInt(c); boardFixed.push(v); known.add(v); }
    const deck = [];
    for (let r = 2; r <= 14; r++) for (let s = 0; s < 4; s++) { const v = r * 4 + s; if (!known.has(v)) deck.push(v); }
    const needBoard = 5 - boardFixed.length;
    const need = needBoard + 2 * nOpponents;
    const hero = new Int32Array(7), opp = new Int32Array(7), bd = new Int32Array(5);
    for (let i = 0; i < boardFixed.length; i++) bd[i] = boardFixed[i];
    let eq = 0, wins = 0, ties = 0;
    // 模擬內部用 mulberry32（種子取自 LG.rng，seed 後仍可重現；避免每張牌呼叫 crypto 太慢）
    let a = Math.floor(LG.rng.random() * 4294967296) | 0;
    const rnd = () => {
      a = (a + 0x6D2B79F5) | 0;
      let t = Math.imul(a ^ (a >>> 15), 1 | a);
      t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
      return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
    };
    const len = deck.length;
    for (let it = 0; it < iters; it++) {
      // 部分 Fisher–Yates：把 need 張隨機牌換到陣列尾端
      for (let k = 0; k < need; k++) {
        const top = len - 1 - k;
        const j = Math.floor(rnd() * (top + 1));
        const t = deck[top]; deck[top] = deck[j]; deck[j] = t;
      }
      let p = len - 1;
      for (let i = boardFixed.length; i < 5; i++) bd[i] = deck[p--];
      for (let i = 0; i < 5; i++) { hero[i] = bd[i]; opp[i] = bd[i]; }
      hero[5] = heroFixed[0]; hero[6] = heroFixed[1];
      const hs = scoreInts(hero, 7);
      let best = 0, nBest = 0;
      for (let o = 0; o < nOpponents; o++) {
        opp[5] = deck[p--]; opp[6] = deck[p--];
        const s = scoreInts(opp, 7);
        if (s > best) { best = s; nBest = 1; } else if (s === best) nBest++;
      }
      if (hs > best) { eq += 1; wins++; }
      else if (hs === best) { eq += 1 / (nBest + 1); ties++; }
    }
    return { equity: eq / iters, win: wins / iters, tie: ties / iters, lose: (iters - wins - ties) / iters, iters };
  }

  /**
   * 簡易 outs：下一張牌能讓「牌型類別」升級、且升級不是只靠公共牌的張數（翻牌/轉牌時有意義）。
   * @param {Array} hole
   * @param {Array} board 3 或 4 張（其他張數回傳 0）
   * @returns {number}
   */
  function outs(hole, board) { return outsDetail(hole, board).count; }

  /**
   * 同 outs，但回傳能升級的牌。
   * @returns {{count:number, cards:Array}}
   */
  function outsDetail(hole, board) {
    if (!board || board.length < 3 || board.length > 4) return { count: 0, cards: [] };
    const all = hole.concat(board);
    const known = new Set(all.map((c) => c.id));
    const cur = Math.floor(score(all) / B5);
    const cards = [];
    for (const s of SUIT_CH) for (const r of Object.keys(RV)) {
      const id = r + s;
      if (known.has(id)) continue;
      const c = { rank: r, suit: s, id };
      const nc = Math.floor(score(all.concat([c])) / B5);
      if (nc <= cur) continue;
      const bc = Math.floor(score(board.concat([c])) / B5);
      if (nc > bc) cards.push(c);
    }
    return { count: cards.length, cards };
  }

  // ---- 描述 ----
  const RANK_ZH = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const RANK_EN = { 1: 'Ace', 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const plural = (r) => (r === 6 ? 'Sixes' : RANK_EN[r] + 's');

  /**
   * 牌型描述（繁中 + 英文），例如 '一對 K（Pair of Kings）'。
   * @param {object|Array} result eval5/best/eval3 的結果，或牌陣列（自動 best/eval3）
   * @returns {string}
   */
  function describe(result) {
    if (Array.isArray(result)) result = result.length === 3 ? eval3(result) : best(result);
    const r = result.ranks || [];
    const z = (x) => RANK_ZH[x], e = (x) => RANK_EN[x];
    if (typeof result.cat === 'string') { // 三張撲克
      switch (result.cat) {
        case 'SF': return `${z(r[0])} 高同花順（Straight Flush, ${e(r[0])} High）`;
        case 'TRIPS': return `三條 ${z(r[0])}（Three ${plural(r[0])}）`;
        case 'STRAIGHT': return `${z(r[0])} 高順子（Straight, ${e(r[0])} High）`;
        case 'FLUSH': return `${z(r[0])} 高同花（Flush, ${e(r[0])} High）`;
        case 'PAIR': return `一對 ${z(r[0])}（Pair of ${plural(r[0])}）`;
        default: return `${z(r[0])} 高牌（${e(r[0])} High）`;
      }
    }
    switch (result.cat) {
      case CATEGORY.ROYAL: return '皇家同花順（Royal Flush）';
      case CATEGORY.STRAIGHT_FLUSH: return `${z(r[0])} 高同花順（Straight Flush, ${e(r[0])} High）`;
      case CATEGORY.QUADS: return `四條 ${z(r[0])}（Four ${plural(r[0])}）`;
      case CATEGORY.FULL_HOUSE: return `葫蘆 ${z(r[0])} 帶 ${z(r[3])}（Full House, ${plural(r[0])} full of ${plural(r[3])}）`;
      case CATEGORY.FLUSH: return `${z(r[0])} 高同花（Flush, ${e(r[0])} High）`;
      case CATEGORY.STRAIGHT: return `${z(r[0])} 高順子（Straight, ${e(r[0])} High）`;
      case CATEGORY.TRIPS: return `三條 ${z(r[0])}（Three ${plural(r[0])}）`;
      case CATEGORY.TWO_PAIR: return `兩對 ${z(r[0])} 和 ${z(r[2])}（Two Pair, ${plural(r[0])} and ${plural(r[2])}）`;
      case CATEGORY.PAIR: return `一對 ${z(r[0])}（Pair of ${plural(r[0])}）`;
      default: return r.length ? `${z(r[0])} 高牌（${e(r[0])} High）` : '高牌（High Card）';
    }
  }

  LG.poker = {
    CATEGORY, CATEGORY_NAME, CAT3, CAT3_NAME, CAT3_KEYS,
    eval5, best, score, compare, eval3, equity, equityDetail, outs, outsDetail, describe,
  };
})();
