// LG.baccarat — 點數、第三張牌規則、發一局、四變體結算。見 docs/05-game-rules/baccarat.md
(() => {
  const LG = globalThis.LG;

  // ---- 金額格式（優先使用 LG.money） ----
  const round2 = (n) => (LG.money && LG.money.round2) ? LG.money.round2(n) : Math.round((n + Number.EPSILON) * 100) / 100;
  function fmtAbs(n) {
    if (LG.money && LG.money.fmt) return LG.money.fmt(n);
    const hasCents = Math.round(n * 100) % 100 !== 0;
    const s = hasCents ? n.toFixed(2) : String(Math.round(n));
    const [i, d] = s.split('.');
    return 'RM ' + i.replace(/\B(?=(\d{3})+(?!\d))/g, ',') + (d ? '.' + d : '');
  }
  /** 金額文字，負數前加 '−'。 */
  const money = (n) => (n < 0 ? '−' + fmtAbs(-n) : fmtAbs(n));

  /**
   * 百家樂點數：A=1、2–9 面值、T/J/Q/K=0。
   * @param {{rank:string}} card
   * @returns {number}
   */
  function point(card) {
    const r = card.rank;
    if (r === 'A') return 1;
    if (r === 'T' || r === 'J' || r === 'Q' || r === 'K') return 0;
    return Number(r);
  }

  /**
   * 手牌點數（Σ點數取個位）。
   * @param {Array} cards
   * @returns {number} 0–9
   */
  function total(cards) { let s = 0; for (const c of cards) s += point(c); return s % 10; }

  /**
   * 閒家是否補第三張：0–5 補、6–7 停（8–9 為天牌，不會進到這裡；也回傳 false）。
   * @param {number} pTotal 閒兩張點數
   * @returns {boolean}
   */
  function playerDraws(pTotal) { return pTotal <= 5; }

  /**
   * 莊家是否補第三張（標準規則表）。
   * @param {number} bTotal 莊兩張點數
   * @param {{rank:string}|number|null} playerThirdCard 閒第三張（牌物件或其點數）；閒未補牌傳 null
   * @returns {boolean}
   */
  function bankerDraws(bTotal, playerThirdCard) {
    if (bTotal >= 7) return false;
    if (playerThirdCard === null || playerThirdCard === undefined) return bTotal <= 5;
    const p = typeof playerThirdCard === 'number' ? playerThirdCard : point(playerThirdCard);
    switch (bTotal) {
      case 0: case 1: case 2: return true;
      case 3: return p !== 8;
      case 4: return p >= 2 && p <= 7;
      case 5: return p >= 4 && p <= 7;
      case 6: return p === 6 || p === 7;
      default: return false;
    }
  }

  /**
   * 開局燒牌：翻第一張，依點數（10/J/Q/K 算 10）再燒對應張數。
   * @param {Shoe} shoe
   * @returns {{first:{rank,suit,id}, burned:Array}} burned 不含 first
   */
  function burnStart(shoe) {
    const first = shoe.draw();
    const n = point(first) || 10;
    return { first, burned: shoe.burn(n) };
  }

  /**
   * 發一局（閒、莊、閒、莊，依規則補第三張）。
   * @param {Shoe} shoe LG.cards 牌靴（可先 shoe.stack('...') 指定牌）
   * @returns {{player:Array, banker:Array, pTotal:number, bTotal:number, outcome:'P'|'B'|'T',
   *   natural:boolean, playerPair:boolean, bankerPair:boolean, bankerCards:2|3, playerCards:2|3,
   *   bankerWinsWith6:boolean}}
   */
  function dealCoup(shoe) {
    const player = [shoe.draw()];
    const banker = [shoe.draw()];
    player.push(shoe.draw());
    banker.push(shoe.draw());
    return resolveCoup(player, banker, () => shoe.draw());
  }

  /**
   * 由已知牌完成一局（教學/測試用）：player/banker 前兩張已給，其餘依規則由 drawFn 補。
   * 若 player/banker 已含第三張，直接採用（不再抽）。
   * @param {Array} player
   * @param {Array} banker
   * @param {(()=>object)|Shoe} [drawFn] 抽牌函式或牌靴；需要補牌卻未提供時丟 Error('RESOLVE_NEEDS_CARD')
   */
  function resolveCoup(player, banker, drawFn) {
    player = player.slice(); banker = banker.slice();
    const draw = typeof drawFn === 'function' ? drawFn
      : (drawFn && typeof drawFn.draw === 'function') ? () => drawFn.draw()
        : () => { throw new Error('RESOLVE_NEEDS_CARD'); };
    const p2 = total(player.slice(0, 2));
    const b2 = total(banker.slice(0, 2));
    const natural = p2 >= 8 || b2 >= 8;
    const needP = !natural && playerDraws(p2);
    if (needP && player.length < 3) player.push(draw());
    player.length = needP ? 3 : 2;
    const pThird = needP ? player[2] : null;
    const needB = !natural && bankerDraws(b2, pThird);
    if (needB && banker.length < 3) banker.push(draw());
    banker.length = needB ? 3 : 2;
    const pTotal = total(player), bTotal = total(banker);
    const outcome = pTotal > bTotal ? 'P' : bTotal > pTotal ? 'B' : 'T';
    return {
      player, banker, pTotal, bTotal, outcome, natural,
      playerPair: player[0].rank === player[1].rank,
      bankerPair: banker[0].rank === banker[1].rank,
      playerCards: player.length, bankerCards: banker.length,
      bankerWinsWith6: outcome === 'B' && bTotal === 6,
    };
  }

  /** 下注格名稱 */
  const SPOTS = {
    player: { zh: '閒', en: 'Player' },
    banker: { zh: '莊', en: 'Banker' },
    tie: { zh: '和', en: 'Tie' },
    playerPair: { zh: '閒對', en: 'Player Pair' },
    bankerPair: { zh: '莊對', en: 'Banker Pair' },
    super6: { zh: '超級六', en: 'Super 6' },
    tiger: { zh: '老虎', en: 'Tiger' },
    bigTiger: { zh: '大老虎', en: 'Big Tiger' },
    smallTiger: { zh: '小老虎', en: 'Small Tiger' },
    tigerTie: { zh: '老虎和', en: 'Tiger Tie' },
    tigerPair: { zh: '老虎對', en: 'Tiger Pair' },
  };

  /**
   * 判定單一注的結果。
   * @returns {{result:'win'|'lose'|'push', odds:number, why:string}}
   */
  function judge(spot, coup, variant) {
    const o = coup.outcome;
    const commission = variant === 'classic' || variant === 'squeeze' || !variant;
    const b6 = coup.bankerWinsWith6;
    const win = (odds, why) => ({ result: 'win', odds, why });
    const lose = (why) => ({ result: 'lose', odds: 0, why });
    const push = (why) => ({ result: 'push', odds: 0, why });
    switch (spot) {
      case 'player':
        if (o === 'P') return win(1, `閒 ${coup.pTotal} 點贏，賠 1:1`);
        if (o === 'T') return push('和局，閒注退回');
        return lose(`莊 ${coup.bTotal} 點贏`);
      case 'banker':
        if (o === 'B') {
          if (commission) return win(0.95, `莊 ${coup.bTotal} 點贏，賠 1:1 抽 5% 佣 = 0.95`);
          if (b6) return win(0.5, '莊以 6 點贏，只賠一半 0.5:1');
          return win(1, `莊 ${coup.bTotal} 點贏，免佣 1:1`);
        }
        if (o === 'T') return push('和局，莊注退回');
        return lose(`閒 ${coup.pTotal} 點贏`);
      case 'tie':
        return o === 'T' ? win(8, `和局 ${coup.pTotal} 點，賠 8:1`) : lose('不是和局');
      case 'playerPair':
        return coup.playerPair ? win(11, '閒前兩張成對，賠 11:1') : lose('閒前兩張不成對');
      case 'bankerPair':
        return coup.bankerPair ? win(11, '莊前兩張成對，賠 11:1') : lose('莊前兩張不成對');
      case 'super6':
        return b6 ? win(12, '莊以 6 點贏，Super 6 賠 12:1') : lose('莊沒有以 6 點贏');
      case 'tiger':
        if (!b6) return lose('莊沒有以 6 點贏');
        return coup.bankerCards === 3 ? win(20, '莊三張 6 點贏，賠 20:1') : win(12, '莊兩張 6 點贏，賠 12:1');
      case 'bigTiger':
        return b6 && coup.bankerCards === 3 ? win(50, '莊三張 6 點贏，賠 50:1') : lose('需要莊三張牌 6 點贏');
      case 'smallTiger':
        return b6 && coup.bankerCards === 2 ? win(22, '莊兩張 6 點贏，賠 22:1') : lose('需要莊兩張牌 6 點贏');
      case 'tigerTie':
        return o === 'T' && coup.bTotal === 6 ? win(35, '6 點和局，賠 35:1') : lose('不是 6 點和局');
      case 'tigerPair': {
        const pp = coup.playerPair, bp = coup.bankerPair;
        if (pp && bp && coup.player[0].rank === coup.banker[0].rank) return win(100, '雙邊同點數對子（Twin），賠 100:1');
        if (pp && bp) return win(20, '莊閒雙邊都是對子，賠 20:1');
        if (pp || bp) return win(4, '單邊對子，賠 4:1');
        return lose('莊閒前兩張都不成對');
      }
      default:
        throw new Error('UNKNOWN_SPOT:' + spot);
    }
  }

  /** 將 bets（LG.Bets 實例 / {spot:amt} / [[spot,amt]] / Map）轉為 [[spot, amt]] */
  function toEntries(bets) {
    if (!bets) return [];
    if (Array.isArray(bets)) return bets;
    if (bets instanceof Map) return [...bets.entries()];
    if (typeof bets.entries === 'function') return [...bets.entries()];
    return Object.entries(bets);
  }

  /**
   * 結算一局。
   * @param {object} bets LG.Bets 實例、{spotId: amount}、[[spotId, amount]] 或 Map
   * @param {object} coup dealCoup() 的結果
   * @param {'classic'|'squeeze'|'super6'|'tiger'} [variant='classic']
   * @returns {{payouts:Object<string,number>, net:number, wagered:number, returned:number,
   *   lines:Array<{spot:string, name:{zh,en}, stake:number, result:'win'|'lose'|'push', odds:number,
   *   pay:number, returned:number, formula:string, why:string}>}}
   *   payouts[spot] = 拿回金額（含本金；輸為 0、push 為本金）；pay = 該注淨輸贏（贏 +、輸 −、push 0）
   */
  function settle(bets, coup, variant = 'classic') {
    const payouts = {};
    const lines = [];
    let wagered = 0, returned = 0;
    for (const [spot, raw] of toEntries(bets)) {
      const stake = Number(raw) || 0;
      if (stake <= 0) continue;
      const j = judge(spot, coup, variant);
      let pay, back, formula;
      if (j.result === 'win') {
        pay = round2(stake * j.odds);
        back = round2(stake + pay);
        formula = `${money(stake)} × ${j.odds} = ${money(pay)}`;
      } else if (j.result === 'push') {
        pay = 0; back = stake;
        formula = `${money(stake)} 退回（push）= ${money(0)}`;
      } else {
        pay = -stake; back = 0;
        formula = `${money(stake)} 輸 = ${money(-stake)}`;
      }
      payouts[spot] = back;
      wagered = round2(wagered + stake);
      returned = round2(returned + back);
      lines.push({ spot, name: SPOTS[spot], stake, result: j.result, odds: j.odds, pay, returned: back, formula, why: j.why });
    }
    return { payouts, net: round2(returned - wagered), wagered, returned, lines };
  }

  LG.baccarat = {
    SPOTS, point, total, playerDraws, bankerDraws, burnStart, dealCoup, resolveCoup, settle,
    /** 單注判定（教學/提示用）。 */ judge,
  };
})();
