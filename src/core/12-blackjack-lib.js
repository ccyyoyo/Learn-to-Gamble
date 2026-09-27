// LG.blackjack — 手牌點數、基本策略表（6 副、S17、DAS、無投降）、莊家補牌。見 docs/05-game-rules/blackjack.md
(() => {
  const LG = globalThis.LG;

  /**
   * 單張 21 點牌值：A=1（value() 會視情況算 11）、T/J/Q/K=10。
   * @param {{rank:string}} card
   * @returns {number}
   */
  function cardValue(card) {
    const r = card.rank;
    if (r === 'A') return 1;
    if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 10;
    return Number(r);
  }

  /**
   * 手牌點數。
   * @param {Array} cards
   * @param {{fromSplit?:boolean}} [opts] fromSplit=true 表示分牌後的手，A+10 只算 21 不算 BJ
   * @returns {{total:number, soft:boolean, bust:boolean, blackjack:boolean}}
   *   soft = 有一張 A 以 11 計且未爆
   */
  function value(cards, { fromSplit = false } = {}) {
    let sum = 0, aces = 0;
    for (const c of cards) { const v = cardValue(c); sum += v; if (v === 1) aces++; }
    let total = sum, soft = false;
    if (aces > 0 && sum + 10 <= 21) { total = sum + 10; soft = true; }
    return {
      total, soft, bust: total > 21,
      blackjack: !fromSplit && cards.length === 2 && total === 21,
    };
  }

  // ---- 基本策略表（逐格照 blackjack.md §5） ----
  const DEALER = ['2', '3', '4', '5', '6', '7', '8', '9', 'T', 'A'];
  const row = (s) => s.trim().split(/\s+/);
  const all = (a) => row(Array(10).fill(a).join(' '));

  const hard = {};
  for (let t = 4; t <= 8; t++) hard[t] = all('H');
  hard[9] = row('H D D D D H H H H H');
  hard[10] = row('D D D D D D D D H H');
  hard[11] = row('D D D D D D D D D H');
  hard[12] = row('H H S S S H H H H H');
  for (let t = 13; t <= 16; t++) hard[t] = row('S S S S S H H H H H');
  for (let t = 17; t <= 21; t++) hard[t] = all('S');

  const soft = {
    A2: row('H H H D D H H H H H'),
    A3: row('H H H D D H H H H H'),
    A4: row('H H D D D H H H H H'),
    A5: row('H H D D D H H H H H'),
    A6: row('H D D D D H H H H H'),
    A7: row('S Ds Ds Ds Ds S S H H H'),
    A8: all('S'),
    A9: all('S'),
  };

  const pairs = {
    AA: all('P'),
    TT: all('S'),
    99: row('P P P P P S P P S S'),
    88: all('P'),
    77: row('P P P P P P H H H H'),
    66: row('P P P P P H H H H H'),
    55: row('D D D D D D D D H H'), // 視為硬 10
    44: row('H H H P P H H H H H'), // DAS
    33: row('P P P P P P H H H H'),
    22: row('P P P P P P H H H H'),
  };

  /**
   * 策略表（教學渲染用）。代碼：H 加牌、S 停牌、D 加倍（不能則加牌）、Ds 加倍（不能則停牌）、P 分牌。
   * hard[total]、soft['A2'..'A9']、pairs['22'..'TT','AA'] 皆為 10 格陣列，順序同 dealer。
   * rows 提供與規格書相同的分組列（label + key），方便直接渲染成表格。
   */
  const STRATEGY_TABLE = {
    dealer: DEALER,
    hard, soft, pairs,
    legend: {
      H: { zh: '加牌', en: 'Hit' },
      S: { zh: '停牌', en: 'Stand' },
      D: { zh: '加倍（不能加倍則加牌）', en: 'Double (else Hit)' },
      Ds: { zh: '加倍（不能加倍則停牌）', en: 'Double (else Stand)' },
      P: { zh: '分牌', en: 'Split' },
    },
    rows: {
      hard: [
        { label: '17+', key: 17 }, { label: '16', key: 16 }, { label: '15', key: 15 },
        { label: '13–14', key: 13 }, { label: '12', key: 12 }, { label: '11', key: 11 },
        { label: '10', key: 10 }, { label: '9', key: 9 }, { label: '5–8', key: 8 },
      ],
      soft: [
        { label: 'A,9', key: 'A9' }, { label: 'A,8', key: 'A8' }, { label: 'A,7', key: 'A7' },
        { label: 'A,6', key: 'A6' }, { label: 'A,4–A,5', key: 'A4' }, { label: 'A,2–A,3', key: 'A2' },
      ],
      pairs: ['AA', 'TT', '99', '88', '77', '66', '55', '44', '33', '22'].map((k) => ({
        label: k === 'TT' ? '10,10' : k[0] + ',' + k[1], key: k,
      })),
    },
    rules: { decks: 6, s17: true, das: true, surrender: false },
  };

  /** 莊明牌 → 欄位索引 0..9（2..A） */
  function dealerIndex(up) {
    let v;
    if (typeof up === 'number') v = up;
    else if (typeof up === 'string') {
      const r = up.startsWith('10') ? 'T' : up[0].toUpperCase(); // 接受 'A'、'T'、'7'、'10'、'KH' 等
      v = r === 'A' ? 11 : 'TJQK'.includes(r) ? 10 : Number(r);
    }
    else v = up.rank === 'A' ? 11 : cardValue(up);
    if (v === 1) v = 11;
    if (!(v >= 2 && v <= 11)) throw new Error('BAD_DEALER_UP:' + (up && up.id || up));
    return v - 2;
  }

  /**
   * 查表（不考慮能否加倍/分牌），回傳原始代碼與所用的表/列。
   * @returns {{code:'H'|'S'|'D'|'Ds'|'P', table:'hard'|'soft'|'pairs', key:string|number, col:number}}
   */
  function lookup(playerCards, dealerUp, opts = {}) {
    const { canSplit, s17 = true, das = true } = opts;
    const col = dealerIndex(dealerUp);
    const v = value(playerCards);
    const two = playerCards.length === 2;
    const isPair = two && cardValue(playerCards[0]) === cardValue(playerCards[1]);
    const splitOk = canSplit === undefined ? isPair : (canSplit && isPair);
    if (isPair && splitOk) {
      const r = cardValue(playerCards[0]);
      const key = r === 1 ? 'AA' : r === 10 ? 'TT' : `${r}${r}`;
      let code = pairs[key][col];
      if (!das) { // 不可分牌後加倍時的修正（常見表）
        if ((key === '22' || key === '33') && col <= 1) code = 'H';
        if (key === '44') code = 'H';
        if (key === '66' && col === 0) code = 'H';
      }
      if (code !== 'D') return { code, table: 'pairs', key, col };
      // 55 → 走硬 10
    }
    if (v.soft && v.total >= 13 && v.total <= 20) {
      const key = 'A' + (v.total - 11);
      let code = soft[key][col];
      if (!s17) { // H17 修正
        if (key === 'A8' && col === 4) code = 'Ds';
        if (key === 'A7' && col === 0) code = 'Ds';
      }
      return { code, table: 'soft', key, col };
    }
    if (v.soft && v.total <= 12) return { code: 'H', table: 'soft', key: 'A' + (v.total - 11), col };
    const t = Math.max(4, Math.min(21, v.total));
    let code = hard[t][col];
    if (!s17 && t === 11 && col === 9) code = 'D';
    return { code, table: 'hard', key: t, col };
  }

  /**
   * 基本策略建議。
   * @param {Array} playerCards 玩家手牌
   * @param {{rank:string}|string|number} dealerUp 莊明牌（牌物件、'A'/'T'/'7' 或 2..11）
   * @param {{canDouble?:boolean, canSplit?:boolean, decks?:number, s17?:boolean, das?:boolean}} [opts]
   *   canDouble 預設 = 兩張牌；canSplit 預設 = 兩張同點數
   * @returns {'H'|'S'|'D'|'P'} 不能加倍時 D→H、Ds→S；不能分牌時改查點數表
   */
  function basicStrategy(playerCards, dealerUp, opts = {}) {
    const canDouble = opts.canDouble === undefined ? playerCards.length === 2 : !!opts.canDouble;
    const v = value(playerCards);
    if (v.total >= 21) return 'S';
    const { code } = lookup(playerCards, dealerUp, opts);
    if (code === 'D') return canDouble ? 'D' : 'H';
    if (code === 'Ds') return canDouble ? 'D' : 'S';
    return code;
  }

  /**
   * 莊家依規則補牌直到停牌。
   * @param {Array} dealerCards 莊目前的牌（至少兩張）
   * @param {{draw:()=>object}} shoe 牌靴
   * @param {{s17?:boolean}} [opts] s17=true：軟 17 停（本站規則）
   * @returns {Array} 完成後的牌（新陣列）
   */
  function dealerPlay(dealerCards, shoe, { s17 = true } = {}) {
    const cards = dealerCards.slice();
    for (;;) {
      const v = value(cards);
      if (v.total > 17) break;
      if (v.total === 17 && (!v.soft || s17)) break;
      cards.push(shoe.draw());
    }
    return cards;
  }

  LG.blackjack = { cardValue, value, basicStrategy, lookup, STRATEGY_TABLE, dealerPlay };
})();
