// ============================================================================
// Casino Hold'em（id: casino-holdem）— 規格：docs/05-game-rules/casino-holdem.md
//
// 規則摘要：1 副牌。押 Ante（可加 AA Bonus 旁注）。玩家 2 張、莊 2 張暗、翻牌 3 張。
//   看完翻牌：Fold（輸 Ante；AA 照算）或 Call（= 2 × Ante，自動放）。
//   轉牌、河牌翻開後比牌。莊家合格：一對 4 以上（44+）。
//     不合格 → Ante 照賠付表、Call 退回；合格且玩家勝 → Ante 照表、Call 1:1；
//     合格且莊勝 → 兩注皆輸；平手 → 退注。
//   AA Bonus：只看玩家 2 張 + 翻牌 3 張（前 5 張），一對 A 以上才贏。
//
// 金流：No more bets 後扣 Ante + AA；按 Call 時再扣 2 × Ante；結算 credit（含本金）。
// ============================================================================
(() => {
  const { ui, money, poker } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;
  const CAT = poker.CATEGORY;
  const RV = LG.cards.RANK_VALUE;

  // ---------------------------------------------------------------- 文案集中
  const T = {
    dealer: { zh: '莊家', en: 'Dealer' },
    board: { zh: '公共牌', en: 'Community' },
    you: { zh: '你', en: 'You' },
    spots: {
      aa: { zh: 'AA 旁注', en: 'AA Bonus', odds: '7:1–100:1' },
      ante: { zh: '底注', en: 'Ante', odds: '1:1–100:1' },
      call: { zh: '跟注 2×', en: 'Call', odds: '1:1' },
    },
    slotLabels: ['F', 'F', 'F', 'T', 'R'],
    qualifyRule: '莊家一對 4 以上才合格 <i class="en">Dealer qualifies with 4s or better</i>',
    callDisabled: 'Call 不用自己放：看完翻牌按「跟注」會自動放 2× Ante',
    needAnte: '先押底注 Ante（AA 旁注不能單獨押）',
    reserve: (n) => `籌碼要預留 Call（2× Ante），目前 Ante 最多 ${fmt(n)}`,
    softReserve: '提醒：餘額不夠之後的 Call（2× Ante），翻牌後只能棄牌',
    decide: ['請決定：跟 或 棄', 'Play or fold?'],
    dealing: ['發牌', 'Dealing'],
    paying: ['派彩', 'Paying out'],
    fold: { zh: '棄牌', en: 'Fold' },
    call: { zh: '跟注 2×', en: 'Call' },
    paytable: '賠付表 <i class="en">Pay table</i>',
  };

  // ---------------------------------------------------------------- 規則常數
  /** Ante 賠付表（玩家最佳 5 張）：順子或更低 1:1 */
  const ANTE_PAY = { [CAT.ROYAL]: 100, [CAT.STRAIGHT_FLUSH]: 20, [CAT.QUADS]: 10, [CAT.FULL_HOUSE]: 3, [CAT.FLUSH]: 2 };
  /** AA Bonus 賠付表（玩家 2 張 + 翻牌 3 張）；一對 A 到順子 7:1 */
  const AA_PAY = {
    [CAT.ROYAL]: 100, [CAT.STRAIGHT_FLUSH]: 50, [CAT.QUADS]: 40, [CAT.FULL_HOUSE]: 30, [CAT.FLUSH]: 20,
    [CAT.STRAIGHT]: 7, [CAT.TRIPS]: 7, [CAT.TWO_PAIR]: 7,
  };
  const AA_LIMITS_REAL = { min: 10, max: 100 };
  const DECISION_SECONDS = 30;

  // ---------------------------------------------------------------- 純邏輯（可在 Node 單元測試）
  const cardTxt = (c) => (c.rank === 'T' ? '10' : c.rank) + ui.SUIT[c.suit].symbol;
  const antePayOf = (cat) => ANTE_PAY[cat] || 1;

  /** 莊家合格：一對 4 以上（兩對以上一定合格） */
  function qualifies(res) {
    return res.cat >= CAT.TWO_PAIR || (res.cat === CAT.PAIR && res.ranks[0] >= 4);
  }

  /** AA Bonus：玩家 2 張 + 翻牌 3 張 → {res, win, mult} */
  function aaEval(hole, flop) {
    const res = poker.eval5(hole.concat(flop.slice(0, 3)));
    let mult = AA_PAY[res.cat] || 0;
    if (res.cat === CAT.PAIR && res.ranks[0] === 14) mult = 7;
    return { res, win: mult > 0, mult };
  }

  /**
   * 策略提示（簡化，規格 §4 的量化版本）：
   *   Call，除非同時：①沒有用到手牌的對子、也沒有順子以上 ②沒有 4 張同花 / 順子聽牌（含手牌）
   *   ③手牌太小：大張 + 小張÷2（有 3 張同花再 +1）< 12。J 以上一定跟。
   * @returns {{action:'call'|'fold', why:string, score?:number}}
   */
  function strategy(hole, flop) {
    const all = hole.concat(flop);
    const res = poker.eval5(all);
    if (res.cat >= CAT.STRAIGHT) return { action: 'call', why: `已經有${res.name.zh}，一定跟。` };
    const hr = hole.map((c) => RV[c.rank]);
    const fr = flop.map((c) => RV[c.rank]);
    if (hr[0] === hr[1]) return { action: 'call', why: `手上有口袋對 ${cardTxt(hole[0]).slice(0, -1)}，有對子就跟。` };
    const hit = hr.find((r) => fr.includes(r));
    if (hit) return { action: 'call', why: `手牌配中公共牌成對（${hit === 14 ? 'A' : hit > 10 ? 'JQK'[hit - 11] : hit}），有對子就跟。` };
    for (const s of 'SHDC') {
      const n = all.filter((c) => c.suit === s).length;
      if (n >= 4 && hole.some((c) => c.suit === s)) return { action: 'call', why: '有 4 張同花聽牌，跟。' };
    }
    const has = new Set(all.map((c) => RV[c.rank]));
    if (has.has(14)) has.add(1);
    const hs = new Set(hr);
    if (hs.has(14)) hs.add(1);
    for (let lo = 1; lo <= 10; lo++) {
      let n = 0, useHole = false;
      for (let r = lo; r < lo + 5; r++) if (has.has(r)) { n++; if (hs.has(r)) useHole = true; }
      if (n >= 4 && useHole) return { action: 'call', why: '有 4 張順子聽牌，跟。' };
    }
    const hi = Math.max(...hr), lo = Math.min(...hr);
    let bd = 0;
    for (const s of 'SHDC') {
      const n = all.filter((c) => c.suit === s).length;
      if (n >= 3 && hole.some((c) => c.suit === s)) bd = 1;
    }
    const score = hi + lo / 2 + bd;
    const sTxt = `${hi} + ${lo}÷2${bd ? ' + 1（三張同花）' : ''} = ${score}`;
    if (score < 12) return { action: 'fold', score, why: `沒對子、沒聽牌，手牌分數 ${sTxt} < 12，太小 → 棄牌。` };
    return { action: 'call', score, why: `沒對子也沒聽牌，但手牌分數 ${sTxt} ≥ 12，還是跟。` };
  }

  /** 由牌靴依序發：玩家 2、莊 2、公共牌 5 */
  function dealHand(shoe) {
    const d = () => shoe.draw();
    const player = [d(), d()];
    const dealer = [d(), d()];
    const board = [d(), d(), d(), d(), d()];
    return { player, dealer, board };
  }

  function line(spot, label, stake, result, mult) {
    let pay = 0, returned = 0, formula;
    if (result === 'win') {
      pay = round2(stake * mult); returned = round2(stake + pay);
      formula = `${label} ${fmt(stake)} × ${mult} = +${fmt(pay)}（拿回 ${fmt(returned)}）`;
    } else if (result === 'push') {
      returned = stake;
      formula = `${label} ${fmt(stake)} 退回 <i class="en">push</i> = ${fmt(0)}`;
    } else {
      pay = -stake;
      formula = `${label} ${fmt(stake)} 輸 = −${fmt(stake)}`;
    }
    return { spot, label, stake, result, mult: result === 'win' ? mult : 0, pay, returned, formula };
  }

  /**
   * 結算。
   * @param {{ante:number, aa?:number, call?:number}} stakes call 已放（= 2 × ante）或 0/省略
   * @param {{player, dealer, board}} hand board 5 張
   * @param {{folded?:boolean}} [o]
   */
  function settle(stakes, hand, { folded = false } = {}) {
    const { ante = 0, aa = 0 } = stakes;
    const call = folded ? 0 : (stakes.call ?? 2 * ante);
    const p = poker.best(hand.player.concat(hand.board));
    const d = poker.best(hand.dealer.concat(hand.board));
    const qual = qualifies(d);
    const cmp = poker.compare(p, d);
    const aaR = aaEval(hand.player, hand.board.slice(0, 3));
    const lines = [];
    let outcome;
    if (folded) {
      outcome = 'fold';
      if (ante) lines.push(line('ante', '底注 Ante', ante, 'lose'));
    } else if (!qual) {
      outcome = 'noqual';
      lines.push(line('ante', '底注 Ante', ante, 'win', antePayOf(p.cat)));
      lines.push(line('call', '跟注 Call', call, 'push'));
    } else if (cmp > 0) {
      outcome = 'win';
      lines.push(line('ante', '底注 Ante', ante, 'win', antePayOf(p.cat)));
      lines.push(line('call', '跟注 Call', call, 'win', 1));
    } else if (cmp < 0) {
      outcome = 'lose';
      lines.push(line('ante', '底注 Ante', ante, 'lose'));
      lines.push(line('call', '跟注 Call', call, 'lose'));
    } else {
      outcome = 'tie';
      lines.push(line('ante', '底注 Ante', ante, 'push'));
      lines.push(line('call', '跟注 Call', call, 'push'));
    }
    if (aa > 0) lines.push(line('aa', 'AA 旁注', aa, aaR.win ? 'win' : 'lose', aaR.mult));
    const wagered = round2(lines.reduce((a, l) => a + l.stake, 0));
    const returned = round2(lines.reduce((a, l) => a + l.returned, 0));
    return { outcome, lines, wagered, returned, net: round2(returned - wagered), p, d, qual, cmp, aa: aaR, folded };
  }

  /**
   * Monte Carlo：依 strategy() 玩 n 手，只押 Ante 1 單位；edge 為 Ante 的百分比。
   * @returns {{edge:number, foldRate:number, hands:number, sd:number}}
   */
  function simulate(n = 100000) {
    const deck = LG.cards.newDeck();
    let net = 0, sq = 0, folds = 0;
    const B5 = 1048576;
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 9; k++) {
        const top = 51 - k;
        const j = Math.floor(LG.rng.random() * (top + 1));
        const t = deck[top]; deck[top] = deck[j]; deck[j] = t;
      }
      const hole = [deck[43], deck[44]], dealer = [deck[45], deck[46]];
      const board = [deck[47], deck[48], deck[49], deck[50], deck[51]];
      let x;
      if (strategy(hole, board.slice(0, 3)).action === 'fold') { x = -1; folds++; }
      else {
        const ps = poker.score(hole.concat(board)), ds = poker.score(dealer.concat(board));
        const pc = Math.floor(ps / B5), dc = Math.floor(ds / B5);
        const q = dc >= CAT.TWO_PAIR || (dc === CAT.PAIR && ((ds % B5) >> 16) >= 4);
        const am = antePayOf(pc);
        if (!q) x = am; else if (ps > ds) x = am + 2; else if (ps < ds) x = -3; else x = 0;
      }
      net += x; sq += x * x;
    }
    const m = net / n;
    return { edge: -m * 100, foldRate: folds / n, hands: n, sd: Math.sqrt(Math.max(0, sq / n - m * m)) };
  }

  // ---------------------------------------------------------------- 顯示小工具
  const mc = (c, extra = '') => `<span class="ch-mc${ui.SUIT[c.suit].color === 'red' ? ' is-red' : ''}${extra}">${cardTxt(c)}</span>`;
  const mcs = (arr, hl) => arr.map((c) => mc(c, hl && hl.some((x) => x.id === c.id) ? ' is-hl' : '')).join('');
  const handName = (res) => poker.describe(res);

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'casino-holdem',
    category: 'poker-table',
    order: 3,
    name: { zh: '賭場德州撲克', en: "Casino Hold'em" },
    summary: '看完翻牌再決定跟不跟；莊家要一對 4 以上才合格。',
    houseEdge: [
      { bet: { zh: '底注', en: 'Ante' }, edge: 2.16, best: true },
      { bet: { zh: 'AA 旁注', en: 'AA Bonus' }, edge: 6.26 },
    ],
    limits: { real: { min: 25, max: 500 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: { qualifies, aaEval, strategy, settle, simulate, dealHand, antePayOf, ANTE_PAY, AA_PAY, AA_LIMITS_REAL, DECISION_SECONDS },

    create(ctx) {
      const state = {
        phase: 'idle', hand: null, stakes: null, staked: 0, rounds: 0, decisions: 0,
        script: null, lastAction: null, lastResult: null,
      };
      const L = ctx.limits;
      const aaLim = ctx.isReal ? AA_LIMITS_REAL : { min: L.min, max: L.max };
      const bets = new LG.Bets({
        min: L.min, max: Infinity, perSpotMin: L.min, perSpotMax: L.max,
        spotRules: {
          ante: { min: L.min, max: L.max, label: '底注 Ante' },
          aa: { min: aaLim.min, max: aaLim.max, label: 'AA 旁注' },
          call: { min: 0, max: Infinity, label: '跟注 Call' },
        },
      });
      let root, tableEl, dealerHand, playerHand, boardEl, slots = [], dealerBadge, playerBadge, hintEl;
      let tray, layer, bar, ab, decisionCd = null;
      const cardEls = { player: [], dealer: [], board: [] };

      // ---------------------------------------------------------- 桌面
      function spot(id) {
        const s = T.spots[id];
        const attrs = { class: ['lg-spot', 'ch-spot', `ch-spot--${id}`], dataset: { bet: id } };
        if (id === 'call') { attrs.dataset.betDisabled = ''; attrs.dataset.disabledMsg = T.callDisabled; }
        return el('div', attrs, [
          el('span.lg-spot__zh', { text: s.zh }),
          el('span.lg-spot__en', { text: s.en }),
          el('span.lg-spot__odds', { text: s.odds }),
        ]);
      }

      function buildTable() {
        dealerHand = el('div.lg-hand.ch-hand', { dataset: { role: 'dealer' } });
        playerHand = el('div.lg-hand.ch-hand', { dataset: { role: 'player' } });
        dealerBadge = el('div.ch-badge', { dataset: { role: 'dealer-badge' } });
        playerBadge = el('div.ch-badge', { dataset: { role: 'player-badge' } });
        slots = T.slotLabels.map((lab, i) => el('div.ch-slot', { dataset: { slot: String(i), label: lab } }));
        boardEl = el('div.ch-board', { dataset: { role: 'board' } }, slots);
        const ptBtn = el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-btn--ghost ch-ptbtn', dataset: { action: 'paytable' }, html: T.paytable });
        ptBtn.addEventListener('click', showPaytable);
        tableEl = el('div.lg-table.ch-table', [
          el('div.ch-row.ch-row--dealer', [
            el('div.lg-table__label', { html: term(T.dealer.zh, T.dealer.en) }), dealerHand, dealerBadge,
          ]),
          el('div.ch-row.ch-row--board', [
            el('div.lg-table__label', { html: term(T.board.zh, T.board.en) }), boardEl,
          ]),
          el('div.ch-rule', { html: T.qualifyRule }),
          el('div.ch-row.ch-row--player', [
            playerBadge, playerHand, el('div.lg-table__label', { html: term(T.you.zh, T.you.en) }),
          ]),
          el('div.ch-spots', [spot('aa'), spot('ante'), spot('call')]),
          ptBtn,
        ]);
        const actions = el('div.lg-actions.ch-actions', { dataset: { dealSlot: '' } });
        hintEl = el('div.lg-hint.ch-hint', { hidden: true, dataset: { role: 'hint' } });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, hintEl, actions, chips, barEl);

        ab = ui.actionBar(actions, [
          { id: 'fold', label: T.fold.zh, en: T.fold.en, hidden: true, onClick: () => decide('fold') },
          { id: 'call', label: T.call.zh, en: T.call.en, primary: true, hidden: true, onClick: () => decide('call') },
        ]);
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId, canPlace });
        bar = ui.betBar(barEl, { bets, layer });
        clearTable();
      }

      /**
       * 放 Ante 時檢查能否預留 Call（2× Ante）。
       * 餘額連「最低注 × 3」都不夠時不再擋（否則真實模式會卡住），改成提醒「翻牌後只能棄牌」。
       */
      function reserveCheck(ante, aa) {
        const bal = ctx.bank.balance();
        if (round2(ante * 3 + aa) <= bal + 1e-9) return true;
        if (round2(ante + aa) > bal + 1e-9) return '籌碼不足 <i class="en">Insufficient chips</i>';
        if (round2(L.min * 3 + aa) <= bal + 1e-9) return T.reserve(Math.max(0, Math.floor((bal - aa) / 3)));
        return 'soft';
      }
      function canPlace(spotId, amount) {
        const ante = bets.get('ante') + (spotId === 'ante' ? amount : 0);
        const aa = bets.get('aa') + (spotId === 'aa' ? amount : 0);
        const r = reserveCheck(ante, aa);
        if (r === 'soft') { ui.toast(T.softReserve, { type: 'warn' }); return true; }
        return r;
      }

      function validateBets() {
        if (!(bets.get('ante') > 0)) return T.needAnte;
        const r = reserveCheck(bets.get('ante'), bets.get('aa'));
        return r === 'soft' ? true : r;
      }

      function showPaytable() {
        const ante = ui.table([['玩家牌型', 'Ante 賠率'], ['皇家同花順 Royal Flush', '100:1'], ['同花順 Straight Flush', '20:1'], ['四條 Four of a Kind', '10:1'], ['葫蘆 Full House', '3:1'], ['同花 Flush', '2:1'], ['順子或更低 Straight or less', '1:1']], { caption: 'Ante（莊不合格或你贏時）' });
        const aa = ui.table([['前 5 張（2 + 翻牌）', 'AA 賠率'], ['皇家同花順', '100:1'], ['同花順', '50:1'], ['四條', '40:1'], ['葫蘆', '30:1'], ['同花', '20:1'], ['一對 A 到 順子', '7:1']], { caption: 'AA Bonus 旁注' });
        const body = el('div', [ante, aa, el('p.lg-muted', { html: 'Call 贏 1:1。莊家一對 4 以上才合格。' })]);
        ui.modal({ title: T.paytable, body });
      }

      // ---------------------------------------------------------- 牌區
      function clearTable() {
        dealerHand.innerHTML = ''; playerHand.innerHTML = '';
        slots.forEach((s) => { s.innerHTML = ''; });
        cardEls.player = []; cardEls.dealer = []; cardEls.board = [];
        dealerBadge.textContent = ''; playerBadge.textContent = '';
        dealerBadge.className = 'ch-badge'; playerBadge.className = 'ch-badge';
        markSpots(null);
      }
      function put(container, card, up) {
        const c = ui.card(up ? card : null, { faceDown: !up });
        if (!up) c.dataset.pending = card.id;
        container.appendChild(c);
        return c;
      }
      async function flipUp(cEl, card) {
        delete cEl.dataset.pending;
        await ui.flip(cEl, card);
      }
      function showHand(hand, { dealerUp = true, boardN = 5 } = {}) {
        clearTable();
        cardEls.player = hand.player.map((c) => put(playerHand, c, true));
        cardEls.dealer = hand.dealer.map((c) => put(dealerHand, c, dealerUp));
        cardEls.board = hand.board.slice(0, boardN).map((c, i) => put(slots[i], c, true));
      }
      function paintBadges(hand, { boardN, dealerUp }) {
        if (ctx.isReal) return;
        const pb = poker.best(hand.player.concat(hand.board.slice(0, boardN)));
        playerBadge.innerHTML = boardN ? handName(pb) : '';
        if (dealerUp) {
          const db = poker.best(hand.dealer.concat(hand.board.slice(0, boardN)));
          const q = boardN === 5 ? (qualifies(db) ? ' · 合格 ✓' : ' · 不合格 ✗') : '';
          dealerBadge.innerHTML = handName(db) + q;
        } else dealerBadge.textContent = '';
      }
      function markWinner(r) {
        const winIds = r.folded ? [] : r.outcome === 'lose' ? r.d.best5.map((c) => c.id) : (r.outcome === 'win' || r.outcome === 'noqual') ? r.p.best5.map((c) => c.id) : [];
        tableEl.querySelectorAll('.lg-card').forEach((c) => c.classList.toggle('is-win', winIds.includes(c.dataset.id)));
        playerBadge.classList.toggle('is-win', r.outcome === 'win' || r.outcome === 'noqual');
        dealerBadge.classList.toggle('is-win', r.outcome === 'lose');
      }
      function markSpots(lines) {
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          const l = lines && lines.find((x) => x.spot === s.dataset.bet);
          s.classList.toggle('is-win', !!l && l.result === 'win');
          s.classList.toggle('is-lose', !!l && l.result === 'lose');
        });
      }

      // ---------------------------------------------------------- 動作列 / 提示
      function showActions(on) {
        ab.set('fold', { hidden: !on, disabled: !on });
        ab.set('call', { hidden: !on, disabled: !on });
      }
      function paintHint() {
        const show = ctx.hints && !ctx.isReal;
        hintEl.hidden = !show;
        if (!show) return;
        if (state.phase === 'decision' && state.hand) {
          const s = strategy(state.hand.player, state.hand.board.slice(0, 3));
          hintEl.innerHTML = `建議：<b>${s.action === 'call' ? '跟注 <i class="en">Call</i>' : '棄牌 <i class="en">Fold</i>'}</b>——${s.why}`;
          hintEl.dataset.advice = s.action;
        } else {
          hintEl.innerHTML = '提示：只押 Ante 就好。看完翻牌大約 85% 的手牌都該跟注；AA 旁注優勢 6.26%，比 Ante 貴將近 3 倍。';
          delete hintEl.dataset.advice;
        }
      }
      function strategyHtml() {
        return `<p><b>跟注 Call</b>，除非下面三點<b>同時</b>成立才棄牌：</p>
          <ol class="lg-list"><li>沒有用到手牌的對子（口袋對或配中翻牌），也沒有順子以上</li>
          <li>沒有 4 張同花或 4 張順子聽牌（要用到手牌）</li>
          <li>手牌分數 = 大張 + 小張÷2（有 3 張同花 +1）<b>&lt; 12</b>（A=14、K=13、Q=12、J=11）</li></ol>
          <p class="lg-muted">J 以上一定跟。例：9-5、10-3 棄；9-6、10-4 跟。照這個打優勢約 2.7%（完美策略 2.16%），約棄 15% 的手。</p>`;
      }

      // ---------------------------------------------------------- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        showActions(false);
        paintHint();
        ctx.bettingWindow({ bets, validate: validateBets, onClose: onNoMoreBets });
      }

      function nextShoe() {
        const shoe = LG.cards.newShoe(1);
        if (state.script) { shoe.stack(state.script); state.script = null; }
        return shoe;
      }

      async function onNoMoreBets({ ok, validation }) {
        const v = validateBets();
        if (!ok || v !== true) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(ok ? v : validation.zh, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        state.stakes = { ante: bets.get('ante'), aa: bets.get('aa'), call: 0 };
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'dealing';
        state.lastAction = null;
        await ctx.wait(500);                   // 荷官說完 No more bets 再發牌
        if (!ctx.alive()) return;
        ctx.dealer.say(...T.dealing);
        const hand = dealHand(nextShoe());
        state.hand = hand;
        clearTable();
        // 發牌：玩家 2 張（翻開）、莊 2 張（蓋著）、翻牌 3 張
        cardEls.player = hand.player.map((c) => put(playerHand, c, false));
        cardEls.dealer = hand.dealer.map((c) => put(dealerHand, c, false));
        for (const c of cardEls.player) { await ctx.wait(120); await flipUp(c, hand.player[cardEls.player.indexOf(c)]); }
        if (!ctx.alive()) return;
        for (let i = 0; i < 3; i++) {
          await ctx.wait(120);
          const cEl = put(slots[i], hand.board[i], false);
          cardEls.board[i] = cEl;
          await flipUp(cEl, hand.board[i]);
        }
        if (!ctx.alive()) return;
        paintBadges(hand, { boardN: 3, dealerUp: false });
        state.phase = 'decision';
        showActions(true);
        if (!ctx.bank.canAfford(2 * state.stakes.ante)) ab.set('call', { disabled: true });
        ctx.dealer.say(...T.decide);
        paintHint();
        if (ctx.isReal) {
          decisionCd = ui.countdown(DECISION_SECONDS, { onDone: () => { decisionCd = null; decide('fold', { timeout: true }); } });
        }
      }

      async function decide(action, { timeout = false } = {}) {
        if (state.phase !== 'decision') return;
        if (decisionCd) { decisionCd.cancel(); decisionCd = null; }
        const hand = state.hand;
        if (action === 'call') {
          const c = round2(2 * state.stakes.ante);
          if (!ctx.bank.canAfford(c)) { ui.toast('籌碼不足，不能跟注', { type: 'warn' }); return; }
          ctx.bank.debit(c);
          state.staked = round2(state.staked + c);
          state.stakes.call = c;
          bets.set('call', c);
        }
        state.phase = 'showdown';
        state.lastAction = action;
        state.decisions += 1;
        showActions(false);
        paintHint();
        if (timeout) ui.toast('時間到，視為棄牌 <i class="en">Fold</i>', { type: 'warn' });
        ctx.dealer.say(action === 'call' ? '跟注' : '棄牌', action === 'call' ? 'Call' : 'Fold');
        // 轉牌、河牌、莊家開牌
        for (let i = 3; i < 5; i++) {
          await ctx.wait(220);
          const cEl = put(slots[i], hand.board[i], false);
          cardEls.board[i] = cEl;
          await flipUp(cEl, hand.board[i]);
        }
        if (!ctx.alive()) return;
        await ctx.wait(200);
        for (let i = 0; i < 2; i++) await flipUp(cardEls.dealer[i], hand.dealer[i]);
        if (!ctx.alive()) return;
        finishRound(action === 'fold');
      }

      function finishRound(folded) {
        const hand = state.hand;
        const r = settle(state.stakes, hand, { folded });
        state.lastResult = r;
        ctx.bank.credit(r.returned);
        state.staked = 0;
        paintBadges(hand, { boardN: 5, dealerUp: true });
        markWinner(r);
        markSpots(r.lines);
        ctx.dealer.say(...T.paying);
        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
        ctx.explain(explainOf(r, hand));
        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      // ---------------------------------------------------------- 結果面板內容
      function explainOf(r, hand) {
        const flop = hand.board.slice(0, 3);
        const handHtml = `<div class="ch-res">
          <div><span class="ch-res__k">公共牌 <i class="en">Board</i></span>${mcs(flop)}<span class="ch-res__sep"></span>${mcs(hand.board.slice(3))}</div>
          <div><span class="ch-res__k">你 <i class="en">You</i></span>${mcs(hand.player)} → 最佳 5 張 ${mcs(r.p.best5)} <b>${handName(r.p)}</b></div>
          <div><span class="ch-res__k">莊 <i class="en">Dealer</i></span>${mcs(hand.dealer)} → 最佳 5 張 ${mcs(r.d.best5)} <b>${handName(r.d)}</b></div>
          <div><span class="ch-res__k">合格 <i class="en">Qualify</i></span>${r.qual ? '<b class="lg-win">合格 ✓</b>' : '<b class="lg-lose">不合格 ✗</b>'}（需一對 4 以上）</div>
          ${r.lines.some((l) => l.spot === 'aa') ? `<div><span class="ch-res__k">AA 前 5 張</span>${mcs(hand.player)}${mcs(flop)} <b>${handName(r.aa.res)}</b></div>` : ''}
        </div>`;
        const RESULT = {
          fold: '你棄牌 <i class="en">FOLD</i>',
          noqual: '莊家不合格 <i class="en">DEALER DOES NOT QUALIFY</i>',
          win: '你贏 <i class="en">YOU WIN</i>',
          lose: '莊家贏 <i class="en">DEALER WINS</i>',
          tie: '平手 <i class="en">PUSH</i>',
        };
        const formula = r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>`;
        const why = [];
        const pN = handName(r.p), dN = handName(r.d);
        if (r.outcome === 'fold') {
          why.push('棄牌只輸底注 Ante；翻牌後就不用再放 Call。');
          const alt = settle({ ante: r.lines[0].stake, aa: 0 }, hand, { folded: false });
          why.push(`如果跟注：你 ${pN} vs 莊 ${dN}，Ante + Call 會是 ${money.fmtSigned(alt.net)}。`);
        } else if (r.outcome === 'noqual') {
          why.push(`莊家最佳是 ${dN}，沒到一對 4 → 不合格：Ante 照賠付表（你的${r.p.name.zh} ${antePayOf(r.p.cat)}:1），Call 退回。`);
        } else if (r.outcome === 'win') {
          why.push(`莊家 ${dN} 合格；你的 ${pN} 比較大 → Ante 照表 ${antePayOf(r.p.cat)}:1、Call 1:1。`);
        } else if (r.outcome === 'lose') {
          why.push(`莊家 ${dN} 合格，而且比你的 ${pN} 大 → Ante 和 Call 都輸。`);
        } else {
          why.push('兩邊最佳 5 張一樣大 → 平手，Ante 和 Call 都退回。');
        }
        if (r.lines.some((l) => l.spot === 'aa')) {
          why.push(r.aa.win
            ? `AA 旁注只看你的 2 張 + 翻牌：${handName(r.aa.res)} → ${r.aa.mult}:1。`
            : `AA 旁注只看你的 2 張 + 翻牌：${handName(r.aa.res)}，沒到一對 A → 輸。`);
        }
        return { hand: handHtml, result: RESULT[r.outcome], formula, why: why.join('<br>') };
      }

      // ---------------------------------------------------------- 教學用
      const demo = {
        ensureBetting() { if (state.phase === 'idle' || state.phase === 'settled') startRound(); },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        /** 擺出一手（全部翻開），只在沒有進行中的牌局時 */
        show(ids) {
          if (['dealing', 'decision', 'showdown'].includes(state.phase)) return false;
          const P = LG.cards.parseMany;
          const hand = { player: P(ids.player), dealer: P(ids.dealer), board: P(ids.board) };
          showHand(hand);
          const r = settle({ ante: 50, call: 100 }, hand);
          paintBadges(hand, { boardN: 5, dealerUp: true });
          markWinner(r);
          markSpots(null);
          return true;
        },
        script(ids) { state.script = LG.cards.parseMany(ids); },
      };

      // 教學第一手固定：玩家 K♠Q♠、莊 8♥4♦、翻牌 K♥7♠2♣、轉 9♦、河 4♠（莊剛好一對 4 合格）
      const TUTOR_HAND = 'KS QS 8H 4D KH 7S 2C 9D 4S';

      function tutorialSteps() {
        const tbl = (rows) => `<table class="lg-datatable">${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`;
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>上面是<b>莊家 <i class="en">Dealer</i></b>，中間 5 格是<b>公共牌 <i class="en">Community cards</i></b>，下面是你和三個下注格。</p>',
            highlight: ['.ch-table'] },
          { id: 'layout-board', section: 'layout', title: '公共牌 <i class="en">Flop / Turn / River</i>',
            body: '<p>前 3 張叫<b>翻牌 <i class="en">Flop</i></b>（F），第 4 張<b>轉牌 <i class="en">Turn</i></b>（T），第 5 張<b>河牌 <i class="en">River</i></b>（R）。兩邊都用這 5 張。</p>',
            highlight: ['.ch-board'] },
          { id: 'layout-ante', section: 'layout', title: '底注 <i class="en">Ante</i>',
            body: '<p>每局一定要押的主注。贏的時候照<b>賠付表 <i class="en">Pay table</i></b> 賠，1:1 到 100:1。</p>',
            highlight: ['[data-bet="ante"]'] },
          { id: 'layout-call', section: 'layout', title: '跟注 <i class="en">Call</i> 2×',
            body: '<p>看完翻牌決定要玩，就放 <b>2 倍 Ante</b> 在這格。這裡會自動幫你放，不用自己點。</p>',
            highlight: ['[data-bet="call"]'] },
          { id: 'layout-aa', section: 'layout', title: 'AA 旁注 <i class="en">AA Bonus</i>',
            body: '<p>可選的<b>旁注 <i class="en">Side bet</i></b>：你的 2 張 + 翻牌 3 張有一對 A 以上就贏 7:1 起。</p>',
            highlight: ['[data-bet="aa"]'] },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>押 Ante → 發牌看翻牌 → 決定<b>跟 <i class="en">Call</i></b> 或<b>棄 <i class="en">Fold</i></b> → 翻轉牌、河牌 → 莊家開牌比大小。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-ante', section: 'flow', title: '先押底注',
            body: '<p>選一枚籌碼，點「底注 ANTE」。要預留 2 倍 Ante 的籌碼給等一下的 Call。</p>',
            highlight: ['[data-bet="ante"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「底注 ANTE」放籌碼', check: (inst) => inst.bets.get('ante') > 0 || inst.state.rounds > 0 || '點一下「底注 ANTE」' } },
          { id: 'flow-deal', section: 'flow', title: '發牌 <i class="en">Deal</i>',
            body: '<p>按「發牌」：你拿 2 張（翻開）、莊家 2 張（蓋著），再翻 3 張翻牌。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '按「發牌 Deal」', check: (inst) => inst.state.phase === 'decision' || inst.state.decisions > 0 || '先押 Ante，再按發牌' } },
          { id: 'flow-no-more-bets', section: 'flow', title: '停止下注 <i class="en">No more bets</i>',
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下——Ante 和 AA 都不能再碰。接下來只能用按鈕決定跟或棄。</p>',
            highlight: ['.lg-dealer-banner', '.ch-spots'] },
          { id: 'flow-decide', section: 'flow', title: '看翻牌決定：跟或棄',
            body: '<p>你有 K♠Q♠，翻牌 K♥7♠2♣——配成<b>一對 K</b>。有對子就跟：按「跟注」自動放 2× Ante。</p>',
            highlight: ['[data-action="call"]', '[data-action="fold"]', '.ch-board'],
            action: { label: '按「跟注 Call」', check: (inst) => inst.state.decisions > 0 || (inst.state.phase === 'decision' ? '按「跟注 2× Call」' : '先回上一步按「發牌」') } },
          { id: 'flow-qualify', section: 'flow', title: '莊家合格 <i class="en">Qualify</i>',
            body: '<p>莊家要有<b>一對 4 以上</b>才合格。這手莊家剛好一對 4 → 合格，照正常比大小。</p>',
            highlight: ['.ch-row--dealer', '.ch-rule'] },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼賠',
            body: `${tbl([['你的牌型', 'Ante'], ['皇家同花順', '100:1'], ['同花順', '20:1'], ['四條', '10:1'], ['葫蘆', '3:1'], ['同花', '2:1'], ['順子或更低', '1:1']])}<p>Call 贏一律 1:1。</p>`,
            highlight: ['[data-bet="ante"]'] },
          { id: 'payout-win', section: 'payout', title: '情境一：莊合格，你贏',
            body: '<p>Ante 50、Call 100，你同花、莊一對 Q：<br><b>RM 50 × 2 = RM 100</b>＋<b>RM 100 × 1 = RM 100</b><br>淨贏 RM 200，拿回 RM 350（含本金）。</p>',
            highlight: ['.ch-row--player', '.ch-row--dealer'],
            setup: (inst) => inst.demo.show({ player: 'AH JH', dealer: 'QC QD', board: 'KH 7H 2H 9D 3S' }) },
          { id: 'payout-noqual', section: 'payout', title: '情境二：莊不合格',
            body: '<p>莊只有一對 3（沒到 4）→ 不合格：<b>Ante 照表賠</b>、<b>Call 退回</b>。<br>你一對 K：RM 50 × 1 = RM 50，淨贏 RM 50，拿回 RM 200。</p>',
            highlight: ['.ch-row--dealer', '.ch-rule'],
            setup: (inst) => inst.demo.show({ player: 'KS QS', dealer: '8H 3D', board: 'KH 7S 2C 9D 3S' }) },
          { id: 'payout-lose', section: 'payout', title: '情境三：莊家贏',
            body: '<p>莊合格而且比你大 → Ante 和 Call 都輸：<br>−RM 50 − RM 100 = <b>−RM 150</b>。</p>',
            highlight: ['.ch-row--dealer'],
            setup: (inst) => inst.demo.show({ player: 'QS JD', dealer: 'AC KD', board: 'KH 7S 2C 9D 3S' }) },
          { id: 'payout-aa', section: 'payout', title: 'AA 旁注只看前 5 張',
            body: `<p>只用你的 2 張 + 翻牌 3 張（不看轉牌、河牌）。</p>${tbl([['前 5 張', 'AA'], ['皇家', '100:1'], ['同花順', '50:1'], ['四條', '40:1'], ['葫蘆', '30:1'], ['同花', '20:1'], ['一對 A～順子', '7:1']])}`,
            highlight: ['[data-bet="aa"]', '.ch-slot[data-slot="0"]', '.ch-slot[data-slot="1"]', '.ch-slot[data-slot="2"]'] },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: `${tbl([['注', '優勢'], ['底注 Ante（正確策略）', '2.16%'], ['AA 旁注', '6.26%']])}<p>每押 RM 100 Ante，長期平均輸約 RM 2.16。</p>`,
            highlight: null },
          { id: 'strategy-call', section: 'strategy', title: '該押：Ante，而且幾乎都跟',
            body: '<p>大約 85% 的手都該跟。只有「沒對子、沒聽牌、手牌又小（例：9-5、10-3）」才棄。J 以上一定跟。</p>',
            highlight: ['[data-bet="ante"]', '[data-bet="call"]'] },
          { id: 'strategy-avoid', section: 'strategy', title: '別押：AA 旁注',
            body: '<p>AA 旁注優勢 <b>6.26%</b>，是 Ante 的將近 3 倍。一對 A 以上才中，大約 9 局才中 1 次。想玩久一點就別押。</p>',
            highlight: ['[data-bet="aa"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。每局其實要準備 3 倍 Ante（Ante + Call）。上一手的結果不影響下一手。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ---------------------------------------------------------- instance
      return {
        bets, state, demo,
        tray: () => tray,
        decide,
        mount(el0) {
          root = el0;
          root.classList.add('ch-root');
          buildTable();
          if (ctx.isTutorial) state.script = LG.cards.parseMany(TUTOR_HAND);
          paintHint();
          ctx.on('hints:change', paintHint);
          if (ctx.isPractice) ctx.strategyPanel(strategyHtml());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (decisionCd) { decisionCd.cancel(); decisionCd = null; }
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
