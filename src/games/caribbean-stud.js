// ============================================================================
// Caribbean Stud Poker（id: caribbean-stud）— 規格：docs/05-game-rules/caribbean-stud.md
//
// 一局：Ante（+ 累積獎金旁注 RM 5）→ No more bets → 各 5 張、莊翻 1 張明牌
//      → 玩家棄牌 Fold / 跟注 Bet（自動放 2×Ante；真實 30 秒未操作 = 棄牌）
//      → 莊開牌 → 判合格（A-K 以上）→ 結算（Ante、Bet、旁注各自一行）。
// 金流（CR-A1）：下注階段不扣款；No more bets 後 debit(Ante+旁注)；跟注時 debit(2×Ante)；
//              結算 credit(拿回含本金)；局中卸載退回已扣未結算金額。
// 旁注規則假設（見 docs/change-requests/caribbean-stud.md）：棄牌 = 旁注也輸；固定彩金另退本金。
// ============================================================================
(() => {
  const { ui, money, poker } = LG;
  const { el, term } = ui;
  const { fmt, round2, fmtSigned } = money;
  const CAT = poker.CATEGORY;

  // ---------------------------------------------------------------- 常數
  const ID = 'caribbean-stud';
  const PROG_STAKE = 5;           // 旁注固定 RM 5
  const PROG_CONTRIB = 3.5;       // 每注 70% 進獎池
  const POOL_SEED = 100000;       // 獎池種子
  const DECIDE_SECONDS = 30;      // 真實模式決策秒數
  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const rv = (c) => RV[c.rank];

  /** Bet 賠率（依玩家牌型；HIGH = A-K） */
  const BET_PAY = {
    [CAT.HIGH]: 1, [CAT.PAIR]: 1, [CAT.TWO_PAIR]: 2, [CAT.TRIPS]: 3, [CAT.STRAIGHT]: 4, [CAT.FLUSH]: 5,
    [CAT.FULL_HOUSE]: 7, [CAT.QUADS]: 20, [CAT.STRAIGHT_FLUSH]: 50, [CAT.ROYAL]: 100,
  };
  /** 累積獎金旁注（不論莊牌）：固定金額或獎池百分比 */
  const PROG_PAY = {
    [CAT.FLUSH]: { fixed: 50 }, [CAT.FULL_HOUSE]: { fixed: 100 }, [CAT.QUADS]: { fixed: 500 },
    [CAT.STRAIGHT_FLUSH]: { pct: 0.1 }, [CAT.ROYAL]: { pct: 1 },
  };
  /** 5 張牌型組合數（52 取 5 = 2,598,960），用於旁注優勢計算 */
  const COMBOS = { total: 2598960, [CAT.FLUSH]: 5108, [CAT.FULL_HOUSE]: 3744, [CAT.QUADS]: 624, [CAT.STRAIGHT_FLUSH]: 36, [CAT.ROYAL]: 4 };

  // ---------------------------------------------------------------- 文案
  const T = {
    ante: { zh: '底注', en: 'Ante', odds: '1:1' },
    bet: { zh: '跟注', en: 'Bet', odds: '1:1–100:1', note: '2×Ante・看牌後自動放' },
    progressive: { zh: '累積獎金', en: 'Progressive', odds: 'RM 5 · 同花 RM 50 起' },
    dealer: { zh: '莊家', en: 'Dealer' },
    you: { zh: '你', en: 'You' },
    jackpot: { zh: '獎池', en: 'Jackpot' },
    qualifyPrint: 'DEALER QUALIFIES WITH ACE-KING OR HIGHER',
    qualifyZh: '莊家 A-K 高牌以上才合格',
    fold: { zh: '棄牌', en: 'Fold' },
    raise: { zh: '跟注', en: 'Bet' },
    betAuto: '「跟注 Bet」格不用自己放：看牌後按「跟注」會自動放 2×Ante',
    needAnte: '請先押底注 <i class="en">Ante</i>（旁注不能單獨押）',
    raiseWarn: (x) => `提醒：跟注時要再放 2×Ante（${fmt(x)}），餘額可能不夠`,
    noRaiseCash: '餘額不足以跟注',
    progOn: '已投入累積獎金旁注 RM 5 <i class="en">Progressive</i>',
    progOff: '已取消累積獎金旁注',
    decide: ['請決定：跟 或 棄', 'Play or fold?'],
    timeout: '30 秒未決定 → 視為棄牌 <i class="en">Fold</i>',
    payTable: [
      ['一對或 A-K', 'Pair / A-K', '1:1'], ['兩對', 'Two Pair', '2:1'], ['三條', 'Three of a Kind', '3:1'],
      ['順子', 'Straight', '4:1'], ['同花', 'Flush', '5:1'], ['葫蘆', 'Full House', '7:1'],
      ['四條', 'Four of a Kind', '20:1'], ['同花順', 'Straight Flush', '50:1'], ['皇家同花順', 'Royal Flush', '100:1'],
    ],
    progTable: [['同花', 'Flush', 'RM 50'], ['葫蘆', 'Full House', 'RM 100'], ['四條', 'Four of a Kind', 'RM 500'],
      ['同花順', 'Straight Flush', '獎池 10%'], ['皇家同花順', 'Royal Flush', '獎池 100%']],
    rules: [
      '① 一對以上：一律跟注 <i class="en">Bet</i>。',
      '② 只有 A-K：莊明牌 2–Q 且你手上有同點數的牌 → 跟；莊明牌是 A 或 K 且你有 Q 或 J → 跟；其餘棄牌。',
      '③ 比 A-K 還小：棄牌 <i class="en">Fold</i>。',
    ],
  };

  // ---------------------------------------------------------------- 純邏輯（Node 可測）
  const label = (c) => LG.cards.label(c);
  const labels = (cs) => cs.map(label).join(' ');
  const describe = (ev) => poker.describe(ev);
  /** 牌型相同時補一句差在哪一張（踢腳 kicker） */
  const kickerNote = (a, b) => { const k = LG.poker.kicker(a, b); return k ? `（${k}）` : ''; };

  /** 莊家合格：A-K 高牌以上（任何一對以上，或最大兩張為 A、K） */
  function qualifies(dealer) {
    const de = Array.isArray(dealer) ? poker.eval5(dealer) : dealer;
    return de.cat >= CAT.PAIR || (de.ranks[0] === 14 && de.ranks[1] === 13);
  }
  const isAK = (ev) => ev.cat === CAT.HIGH && ev.ranks[0] === 14 && ev.ranks[1] === 13;

  /**
   * 規格策略（提示用 + Monte Carlo）。
   * @returns {{action:'raise'|'fold', rule:1|2|3, zh:string}}
   */
  function strategy(player, up, pe) {
    pe = pe || poker.eval5(player);
    if (pe.cat >= CAT.PAIR) return { action: 'raise', rule: 1, zh: `你有${pe.name.zh}（一對以上）→ 一律跟注` };
    if (!isAK(pe)) return { action: 'fold', rule: 3, zh: '最大兩張不到 A-K → 棄牌' };
    const u = rv(up);
    if (u >= 2 && u <= 12 && player.some((c) => rv(c) === u)) {
      return { action: 'raise', rule: 2, zh: `只有 A-K，但莊明牌 ${label(up)} 和你手上一張同點數（他少一張成對的機會）→ 跟注` };
    }
    if ((u === 14 || u === 13) && player.some((c) => rv(c) === 12 || rv(c) === 11)) {
      return { action: 'raise', rule: 2, zh: `只有 A-K，莊明牌是 ${label(up)} 且你有 Q 或 J → 跟注` };
    }
    return { action: 'fold', rule: 2, zh: `只有 A-K，莊明牌 ${label(up)} 不符合跟注條件 → 棄牌` };
  }

  /** 旁注彩金（不論莊牌）：→ {amount, kind:'fixed'|'pct', pct?, name} | null */
  function progressivePrize(pe, pool) {
    const p = PROG_PAY[pe.cat];
    if (!p) return null;
    if (p.fixed) return { amount: p.fixed, kind: 'fixed', name: pe.name };
    return { amount: round2(pool * p.pct), kind: 'pct', pct: p.pct, name: pe.name };
  }

  /** 旁注莊家優勢（%，依獎池；用 5 張牌型組合數精確計算） */
  function progressiveEdge(pool = POOL_SEED) {
    let win = 0, hits = 0;
    for (const cat of [CAT.FLUSH, CAT.FULL_HOUSE, CAT.QUADS, CAT.STRAIGHT_FLUSH, CAT.ROYAL]) {
      const p = COMBOS[cat] / COMBOS.total;
      const pr = PROG_PAY[cat];
      win += p * (pr.fixed || pool * pr.pct);
      hits += p;
    }
    const ev = win - (1 - hits) * PROG_STAKE;   // 中獎退本金；不中輸 RM 5
    return round2((-ev / PROG_STAKE) * 100);
  }

  /** 核心判定（Monte Carlo 也用）：→ {pe, de, q, cmp, mult} */
  function resolve(player, dealer) {
    const pe = poker.eval5(player), de = poker.eval5(dealer);
    const q = qualifies(de);
    const cmp = Math.sign(poker.compare(pe, de));
    return { pe, de, q, cmp, mult: BET_PAY[pe.cat] };
  }

  const nm = (spot) => term(T[spot].zh, T[spot].en);
  const line = (spot, stake, result, pay, formula, extra = {}) => ({ spot, stake, result, pay: round2(pay), returned: round2(result === 'lose' ? 0 : stake + pay), formula, ...extra });

  /**
   * 結算一局。
   * @param {{ante:number, bet?:number, progressive?:number, folded:boolean, player:Array, dealer:Array, pool?:number}} o
   * @returns {{pe, de, qualifies, cmp, folded, lines, wagered, returned, net, jackpot, poolAfter, outcome, steps}}
   */
  function settle(o) {
    const { ante, bet = 0, progressive = 0, folded, player, dealer } = o;
    const pool = o.pool ?? POOL_SEED;
    const { pe, de, q, cmp, mult } = resolve(player, dealer);
    const lines = [];
    const steps = {};
    if (folded) {
      steps.qualify = `你已棄牌，莊牌不影響 Ante（莊牌：${describe(de)}）`;
      steps.compare = '棄牌不比牌';
      lines.push(line('ante', ante, 'lose', -ante, `${nm('ante')} ${fmt(ante)} 輸（棄牌）= −${fmt(ante)}`));
    } else {
      steps.qualify = q
        ? `莊家 ${describe(de)} ≥ A-K → <b>合格</b> <i class="en">Dealer qualifies</i>`
        : `莊家 ${describe(de)} 不到 A-K → <b>不合格</b> <i class="en">Dealer does not qualify</i>`;
      if (!q) {
        steps.compare = '莊不合格 → 不比牌：Ante 賠 1:1、Bet 退回';
        lines.push(line('ante', ante, 'win', ante, `${nm('ante')} ${fmt(ante)} × 1 = +${fmt(ante)}（拿回 ${fmt(ante * 2)}）`));
        lines.push(line('bet', bet, 'push', 0, `${nm('bet')} ${fmt(bet)} 退回（push）= RM 0`));
      } else if (cmp > 0) {
        steps.compare = `你的 ${describe(pe)} > 莊的 ${describe(de)}${kickerNote(pe, de)} → <b>你贏</b>`;
        const pay = round2(bet * mult);
        lines.push(line('ante', ante, 'win', ante, `${nm('ante')} ${fmt(ante)} × 1 = +${fmt(ante)}（拿回 ${fmt(ante * 2)}）`));
        lines.push(line('bet', bet, 'win', pay, `${nm('bet')} ${fmt(bet)} × ${mult}（${pe.cat === CAT.HIGH ? 'A-K' : pe.name.zh} ${mult}:1）= +${fmt(pay)}（拿回 ${fmt(bet + pay)}）`));
      } else if (cmp < 0) {
        steps.compare = `你的 ${describe(pe)} < 莊的 ${describe(de)}${kickerNote(pe, de)} → <b>莊贏</b>`;
        lines.push(line('ante', ante, 'lose', -ante, `${nm('ante')} ${fmt(ante)} 輸 = −${fmt(ante)}`));
        lines.push(line('bet', bet, 'lose', -bet, `${nm('bet')} ${fmt(bet)} 輸 = −${fmt(bet)}`));
      } else {
        steps.compare = `雙方同為 ${describe(pe)} → <b>平手</b> <i class="en">Push</i>`;
        lines.push(line('ante', ante, 'push', 0, `${nm('ante')} ${fmt(ante)} 退回（push）= RM 0`));
        lines.push(line('bet', bet, 'push', 0, `${nm('bet')} ${fmt(bet)} 退回（push）= RM 0`));
      }
    }
    let jackpot = null, poolAfter = pool;
    if (progressive > 0) {
      const pz = folded ? null : progressivePrize(pe, pool);
      if (pz) {
        jackpot = { ...pz, cat: pe.cat };
        const how = pz.kind === 'fixed' ? `固定 ${fmt(pz.amount)}` : `獎池 ${fmt(pool)} × ${pz.pct * 100}%`;
        lines.push(line('progressive', progressive, 'win', pz.amount,
          `${nm('progressive')} ${fmt(progressive)}：${pz.name.zh} → ${how} = +${fmt(pz.amount)}（本金 ${fmt(progressive)} 退回）`));
        if (pe.cat === CAT.ROYAL) poolAfter = POOL_SEED;
        else if (pz.kind === 'pct') poolAfter = Math.max(POOL_SEED, round2(pool - pz.amount));
      } else {
        lines.push(line('progressive', progressive, 'lose', -progressive,
          `${nm('progressive')} ${fmt(progressive)}：${folded ? '已棄牌' : '未達同花'} → 輸 = −${fmt(progressive)}`));
      }
    }
    const wagered = round2(ante + bet + progressive);
    const returned = round2(lines.reduce((s, l) => s + l.returned, 0));
    const net = round2(returned - wagered);
    return { pe, de, qualifies: q, cmp, folded, lines, wagered, returned, net, jackpot, poolAfter, steps,
      outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' };
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: ID,
    category: 'poker-table',
    order: 1,
    name: { zh: '加勒比撲克', en: 'Caribbean Stud Poker' },
    summary: '五張梭哈對莊家：看牌後棄牌或跟注 2 倍，莊家 A-K 以上才合格。',
    houseEdge: [
      { bet: { zh: '底注 Ante（最佳策略）', en: 'Ante' }, edge: 5.22, best: true },
      { bet: { zh: '累積獎金旁注（獎池 RM 10 萬時）', en: 'Progressive' }, edge: progressiveEdge(POOL_SEED), approx: true },
    ],
    limits: { real: { min: 25, max: 500 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: { settle, resolve, qualifies, strategy, progressivePrize, progressiveEdge, BET_PAY, PROG_PAY, POOL_SEED, PROG_STAKE, PROG_CONTRIB, DECIDE_SECONDS },

    create(ctx) {
      const state = { phase: 'idle', player: [], dealer: [], staked: 0, rounds: 0, decision: null, forced: null, progToggles: 0, last: null };
      const lim = ctx.limits;
      const bets = new LG.Bets({
        min: lim.min, max: Infinity, perSpotMin: 0, perSpotMax: lim.max,
        spotRules: {
          ante: { min: lim.min, max: lim.max, label: '底注 Ante' },
          bet: { min: 0, max: Infinity, label: '跟注 Bet' },
          progressive: { min: PROG_STAKE, max: PROG_STAKE, label: '累積獎金 Progressive' },
        },
      });
      const shoe = LG.cards.newShoe(1, { cutCard: 0 });
      let root, tableEl, dealerHand, playerHand, dealerRank, playerRank, jackpotEl, jackpotAmt, hintEl, progEl, tray, layer, bar, acts, decideCd = null;

      // ---------------------------------------------------------- 獎池
      const getPool = () => { const j = LG.store.peek().jackpots[ID]; return j && Number.isFinite(j.pool) ? j.pool : POOL_SEED; };
      const setPool = (v) => LG.store.update((s) => { (s.jackpots[ID] = s.jackpots[ID] || {}).pool = round2(v); });
      const paintPool = () => { if (!jackpotEl) return; const p = getPool(); jackpotAmt.textContent = fmt(p); jackpotEl.dataset.pool = String(p); };

      // ---------------------------------------------------------- 桌面
      function spot(id, extra = []) {
        return el('div', { class: ['lg-spot', 'cstud-spot', `cstud-spot--${id}`], dataset: { bet: id } }, [
          el('span.lg-spot__zh', { text: T[id].zh }),
          el('span.lg-spot__en', { text: T[id].en }),
          el('span.lg-spot__odds', { text: T[id].odds }),
          ...extra,
        ]);
      }
      function buildTable() {
        tableEl = el('div.lg-table.cstud-table', [
          el('div.cstud-top', [
            el('div.cstud-area.cstud-area--dealer', [
              el('div.lg-table__label', { html: `${T.dealer.zh} ${T.dealer.en.toUpperCase()}` }),
              dealerHand = el('div.lg-hand.cstud-hand.cstud-dealer', { dataset: { role: 'dealer' } }),
              dealerRank = el('div.cstud-rank', { dataset: { role: 'dealer-rank' } }),
            ]),
            jackpotEl = el('div.cstud-jackpot', [
              el('span', { html: `${T.jackpot.zh} <i class="en">JACKPOT</i>` }),
              jackpotAmt = el('b', { text: fmt(POOL_SEED) }),
            ]),
          ]),
          el('div.cstud-qualify', { html: `<span class="cstud-qualify__en">${T.qualifyPrint}</span><span class="cstud-qualify__zh">${T.qualifyZh}</span>` }),
          el('div.cstud-area.cstud-area--player', [
            playerHand = el('div.lg-hand.cstud-hand.cstud-player', { dataset: { role: 'player' } }),
            playerRank = el('div.cstud-rank', { dataset: { role: 'player-rank' } }),
            el('div.lg-table__label', { html: `${T.you.zh} ${T.you.en.toUpperCase()}` }),
          ]),
          el('div.cstud-spots', [
            spot('bet', [el('span.cstud-spot__note', { text: T.bet.note })]),
            spot('ante'),
            progEl = spot('progressive', [el('span.cstud-slot', { 'aria-hidden': 'true' })]),
          ]),
        ]);
        hintEl = el('div.lg-hint.cstud-hint', { hidden: true });
        const actions = el('div.lg-actions.cstud-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, hintEl, actions, chips, barEl);

        acts = ui.actionBar(actions, [
          { id: 'fold', label: T.fold.zh, en: T.fold.en, hidden: true, onClick: () => decide('fold') },
          { id: 'raise', label: T.raise.zh, en: 'Bet 2×Ante', primary: true, hidden: true, onClick: () => decide('raise') },
        ]);
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId, canPlace });
        bar = ui.betBar(barEl, { bets, layer });
        bets.subscribe(paintProg);
        paintProg();
        paintPool();
        renderHands([], [], { placeholders: true });
      }

      function paintProg() {
        if (!progEl) return;
        const on = bets.get('progressive') > 0;
        progEl.classList.toggle('is-in', on);
        progEl.setAttribute('aria-pressed', on ? 'true' : 'false');
      }

      /** betLayer 的放注檢查：Bet 格不能手放；旁注是切換式；Ante 提醒保留跟注籌碼 */
      function canPlace(spotId, amount) {
        if (spotId === 'bet') return T.betAuto;
        if (spotId === 'progressive') { toggleProgressive(); return false; }
        if (spotId === 'ante') {
          const ante = round2(bets.get('ante') + amount);
          const need = round2(bets.total() + amount + ante * 2);
          if (!ctx.bank.canAfford(need) && ctx.bank.canAfford(round2(bets.total() + amount))) ui.toast(T.raiseWarn(ante * 2), { type: 'warn' });
        }
        return true;
      }
      function toggleProgressive() {
        if (bets.locked) return;
        state.progToggles += 1;
        if (bets.get('progressive') > 0) { bets.set('progressive', 0); ui.toast(T.progOff); return; }
        if (!ctx.bank.canAfford(round2(bets.total() + PROG_STAKE))) { ui.toast('籌碼不足 <i class="en">Insufficient chips</i>', { type: 'warn' }); return; }
        bets.set('progressive', PROG_STAKE);
        ui.toast(T.progOn);
      }

      /** 畫牌：down = 蓋著的索引 */
      function renderHand(container, cards, down, n = 5) {
        container.innerHTML = '';
        const out = [];
        for (let i = 0; i < n; i++) {
          const c = cards[i] || null;
          const e = ui.card(c, { faceDown: !c || down.includes(i), dim: !c });
          container.appendChild(e);
          out.push(e);
        }
        return out;
      }
      function renderHands(player, dealer, { revealDealer = false, placeholders = false } = {}) {
        const pEls = renderHand(playerHand, player, placeholders ? [0, 1, 2, 3, 4] : []);
        const dEls = renderHand(dealerHand, dealer, revealDealer ? [] : [1, 2, 3, 4]);
        playerRank.innerHTML = player.length === 5 ? describe(poker.eval5(player)) : '';
        dealerRank.innerHTML = revealDealer && dealer.length === 5 ? describe(poker.eval5(dealer)) : '';
        return { pEls, dEls };
      }
      function markSpots(lines) {
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          const l = lines && lines.find((x) => x.spot === s.dataset.bet);
          s.classList.toggle('is-win', !!l && l.result === 'win');
          s.classList.toggle('is-lose', !!l && l.result === 'lose');
        });
      }

      // ---------------------------------------------------------- 提示
      function paintHints() {
        const show = ctx.hints;
        hintEl.hidden = !show;
        if (!show) return;
        if (state.phase === 'decide') {
          const s = strategy(state.player, state.dealer[0]);
          hintEl.innerHTML = `建議：<b>${s.action === 'raise' ? '跟注 Bet' : '棄牌 Fold'}</b>（策略第 ${s.rule} 條）— ${s.zh}`;
        } else {
          hintEl.innerHTML = `提示：只押底注 <i class="en">Ante</i>；累積獎金旁注目前優勢約 ${progressiveEdge(getPool())}%，不建議。`;
        }
      }
      function strategyNode() {
        return el('div', [
          el('p', { html: T.rules.join('<br>') }),
          ui.table([['牌型', 'Bet 賠率'], ...T.payTable.map(([z, e, o]) => [term(z, e), o])], { caption: '跟注 Bet 賠付表（莊合格且你贏）' }),
          ui.table([['旁注牌型', '彩金'], ...T.progTable.map(([z, e, o]) => [term(z, e), o])], { caption: '累積獎金旁注（不論莊牌）' }),
          el('p.lg-muted', { html: `莊家優勢：Ante 5.22%（照上面策略）；旁注目前約 ${progressiveEdge(getPool())}%。` }),
        ]);
      }

      // ---------------------------------------------------------- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        state.decision = null;
        acts.set('fold', { hidden: true, disabled: true });
        acts.set('raise', { hidden: true, disabled: true });
        paintHints();
        ctx.bettingWindow({ bets, onClose: onNoMoreBets, validate: preDealCheck });
      }

      function preDealCheck() {
        if (!(bets.get('ante') > 0)) return T.needAnte;
        return true;
      }

      async function onNoMoreBets({ ok, validation }) {
        const own = ok ? preDealCheck() : validation.zh;
        if (own !== true) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(own, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        if (bets.get('progressive') > 0 && !ctx.isTutorial) { setPool(getPool() + PROG_CONTRIB); paintPool(); }
        state.phase = 'dealing';
        markSpots(null);
        ctx.dealer.say('發牌', 'Dealing');
        shoe.shuffle();                              // 1 副牌，每局重洗
        if (state.forced) { shoe.stack(state.forced); state.forced = null; }
        const player = [], dealer = [];
        for (let i = 0; i < 5; i++) { player.push(shoe.draw()); dealer.push(shoe.draw()); }
        state.player = player; state.dealer = dealer;
        playerRank.innerHTML = ''; dealerRank.innerHTML = '';
        const pEls = renderHand(playerHand, player, [0, 1, 2, 3, 4]);
        const dEls = renderHand(dealerHand, dealer, [0, 1, 2, 3, 4]);
        await ctx.wait(250);
        for (const e of pEls) { await ui.flip(e); if (!ctx.alive()) return; }
        await ui.flip(dEls[0]);                      // 莊家明牌 Up card
        if (!ctx.alive()) return;
        playerRank.innerHTML = describe(poker.eval5(player));
        enterDecision();
      }

      function enterDecision() {
        state.phase = 'decide';
        const add = round2(bets.get('ante') * 2);
        const can = ctx.bank.canAfford(add);
        acts.set('fold', { hidden: false, disabled: false });
        acts.set('raise', { hidden: false, disabled: !can, label: can ? T.raise.zh : `${T.raise.zh}（${T.noRaiseCash}）`, en: can ? `Bet ${fmt(add)}` : '' });
        ctx.dealer.say(...T.decide);
        paintHints();
        if (ctx.isReal) {
          decideCd = ui.countdown(DECIDE_SECONDS, { onDone: () => { decideCd = null; if (ctx.alive() && state.phase === 'decide') { ui.toast(T.timeout, { type: 'warn' }); decide('fold', true); } } });
        }
      }

      async function decide(choice, auto = false) {
        if (state.phase !== 'decide') return;
        if (decideCd) { decideCd.cancel(); decideCd = null; }
        if (choice === 'raise') {
          const add = round2(bets.get('ante') * 2);
          if (!ctx.bank.canAfford(add)) { ui.toast(T.noRaiseCash, { type: 'warn' }); return; }
          bets.set('bet', add);                     // 自動放 2×Ante
          ctx.bank.debit(add);
          state.staked = round2(state.staked + add);
          ctx.dealer.say('跟注', 'Bet');
        } else {
          ctx.dealer.say(auto ? '時間到，棄牌' : '棄牌', 'Fold');
        }
        state.decision = choice;
        state.phase = 'showdown';
        acts.set('fold', { hidden: true, disabled: true });
        acts.set('raise', { hidden: true, disabled: true });
        paintHints();
        await ctx.wait(300);
        const dEls = [...dealerHand.children];
        for (let i = 1; i < 5; i++) { await ui.flip(dEls[i]); if (!ctx.alive()) return; }
        dealerRank.innerHTML = describe(poker.eval5(state.dealer));
        finishRound();
      }

      function finishRound() {
        const pool = getPool();
        const r = settle({
          ante: bets.get('ante'), bet: bets.get('bet'), progressive: bets.get('progressive'),
          folded: state.decision === 'fold', player: state.player, dealer: state.dealer, pool,
        });
        ctx.bank.credit(r.returned);
        state.staked = 0;
        if (r.jackpot && !ctx.isTutorial) { setPool(r.poolAfter); paintPool(); }
        state.last = r;
        markSpots(r.lines);
        playerHand.querySelectorAll('.lg-card').forEach((c) => c.classList.toggle('is-win', !r.folded && r.qualifies && r.cmp > 0));
        ctx.dealer.say(r.folded ? '棄牌，收 Ante' : r.qualifies ? (r.cmp > 0 ? '你贏' : r.cmp < 0 ? '莊贏' : '平手') : '莊家不合格', 'Paying out');
        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.outcome });
        ctx.explain(explainOf(r));
        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      function explainOf(r) {
        const s = strategy(state.player, state.dealer[0], r.pe);
        const did = state.decision === 'raise' ? '跟注' : '棄牌';
        const ok = (s.action === 'raise') === (state.decision === 'raise');
        return {
          hand: `你 <i class="en">You</i>：${labels(state.player)} → <b>${describe(r.pe)}</b><br>`
            + `莊 <i class="en">Dealer</i>：${labels(state.dealer)}（明牌 ${label(state.dealer[0])}）→ <b>${describe(r.de)}</b>`,
          result: `① 莊是否合格：${r.steps.qualify}<br>② 比牌：${r.steps.compare}`,
          formula: `③ 每注計算：<br>${r.lines.map((l) => l.formula).join('<br>')}<br>淨 <b>${fmtSigned(r.net)}</b>（拿回 ${fmt(r.returned)} − 下注 ${fmt(r.wagered)}）`,
          why: `策略：${s.zh}。你選了<b>${did}</b>${ok ? ' ✓ 符合策略' : '，和策略不同'}。`
            + (r.folded ? '棄牌只輸 Ante，省下 2×Ante 的跟注。' : !r.qualifies ? '莊不合格時你只贏 Ante，Bet 退回——這是本遊戲莊家優勢的主要來源。' : '')
            + (r.jackpot ? ` 旁注中 ${r.jackpot.name.zh}，不論莊牌都派彩。` : ''),
        };
      }

      // ---------------------------------------------------------- 教學用
      const demo = {
        ensureBetting() { if (state.phase === 'idle' || state.phase === 'settled') startRound(); },
        /** 下一局指定牌：player 5 張、dealer 5 張（dealer 第 1 張 = 明牌） */
        force(p, d) {
          const P = LG.cards.parseMany(p), D = LG.cards.parseMany(d);
          const seq = [];
          for (let i = 0; i < 5; i++) seq.push(P[i], D[i]);
          state.forced = seq;
        },
        /** 擺示範牌（發牌/決策中不動） */
        show(p, d, { reveal = true } = {}) {
          if (['dealing', 'decide', 'showdown'].includes(state.phase)) return;
          renderHands(LG.cards.parseMany(p), LG.cards.parseMany(d), { revealDealer: reveal });
        },
        say(zh, en) { ctx.dealer.say(zh, en); },
      };

      // ---------------------------------------------------------- 教學步驟（22 步）
      function tutorialSteps() {
        const edge = progressiveEdge(getPool());
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>上方是莊家 <i class="en">Dealer</i> 五張牌，下方是你的五張牌和三個下注位置。</p>',
            highlight: ['.cstud-table'] },
          { id: 'layout-ante', section: 'layout', title: '底注 <i class="en">Ante</i>',
            body: '<p>每局一定要先押 <b>Ante</b> 才能拿牌。莊合格且你贏時賠 <b>1:1</b>。</p>',
            highlight: ['[data-bet="ante"]'] },
          { id: 'layout-bet', section: 'layout', title: '跟注 <i class="en">Bet</i> 格',
            body: '<p>看牌後決定要不要玩，要玩就在這格放 <b>2 × Ante</b>。這格你不用自己放籌碼。</p>',
            highlight: ['[data-bet="bet"]'] },
          { id: 'layout-progressive', section: 'layout', title: '累積獎金 <i class="en">Progressive</i> 投幣孔',
            body: '<p>旁注 <i class="en">Side bet</i> 固定 <b>RM 5</b>，點一下投入、再點一下取消，不用籌碼。</p>',
            highlight: ['[data-bet="progressive"]'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '點投幣孔投入，再點一次取消', check: (inst) => (inst.state.progToggles >= 2 && inst.bets.get('progressive') === 0) || (inst.bets.get('progressive') ? '再點一次取消' : '點一下投幣孔') } },
          { id: 'layout-upcard', section: 'layout', title: '莊家明牌 <i class="en">Up card</i>',
            body: '<p>莊家五張裡只翻開 <b>第一張</b>，其餘蓋著。你要靠這張明牌做決定。</p>',
            highlight: ['.cstud-dealer'],
            setup: (inst) => inst.demo.show('9S 9H KD 5C 2S', 'KC AD 7H 4S 3D', { reveal: false }) },
          { id: 'layout-jackpot', section: 'layout', title: '獎池 <i class="en">Jackpot</i>',
            body: '<p>獎池顯示累積獎金目前金額。每注 RM 5 有 RM 3.5 進獎池，皇家同花順全拿。</p>',
            highlight: ['.cstud-jackpot'] },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>押 Ante → 發牌 → 你看牌決定 <b>棄牌</b> 或 <b>跟注</b> → 莊開牌 → 結算。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.say('請下注', 'Place your bets'); } },
          { id: 'flow-ante', section: 'flow', title: '押底注',
            body: '<p>選 RM 25 籌碼，點「底注 ANTE」格。長按或右鍵可拿回一枚。</p>',
            highlight: ['[data-bet="ante"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「底注 ANTE」放 RM 25', check: (inst) => inst.bets.get('ante') >= 25 || inst.state.rounds > 0 || inst.state.phase !== 'betting' || `目前 Ante 上有 ${fmt(inst.bets.get('ante'))}` } },
          { id: 'flow-deal', section: 'flow', title: '發牌 <i class="en">Deal</i>',
            body: '<p>按「發牌」。你拿 5 張，莊家 5 張只翻一張。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.force('9S 9H KD 5C 2S', 'KC AD 7H 4S 3D'); },
            action: { label: '按「發牌 Deal」', check: (inst) => inst.state.phase === 'decide' || inst.state.rounds > 0 || '先放 Ante，再按發牌' } },
          { id: 'flow-hands-off', section: 'flow', title: 'Ante 放好後不能碰',
            body: '<p>荷官說 <b>No more bets</b> 之後，手放桌下。Ante 不能加、減、移動，只能等你決定跟或棄。</p>',
            highlight: ['[data-bet="ante"]', '.lg-dealer-banner'] },
          { id: 'flow-decide', section: 'flow', title: '棄牌或跟注',
            body: '<p>你有一對 9。按 <b>跟注</b>，系統自動在 Bet 格放 2×Ante；按 <b>棄牌</b> 只輸 Ante。</p>',
            highlight: ['[data-action="raise"]', '[data-bet="bet"]'],
            action: { label: '按「跟注 Bet」', check: (inst) => inst.state.rounds > 0 || (inst.state.phase === 'decide' ? '按下方「跟注」' : '先回上一步發牌') } },
          { id: 'flow-qualify', section: 'flow', title: '莊家合格 <i class="en">Qualify</i>',
            body: '<p>莊開牌後要有 <b>A-K 高牌以上</b>（A 與 K 同在，或任何一對）才合格。A-Q-J 不合格。</p>',
            highlight: ['.cstud-qualify'] },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼賠',
            body: '<p>先看 <b>莊是否合格</b>，再 <b>比牌</b>，最後每注各算一次。以下都用 Ante RM 25、Bet RM 50。</p>',
            highlight: ['.cstud-spots'] },
          { id: 'payout-noqual', section: 'payout', title: '情境一：莊不合格',
            body: '<p>莊只有 A-Q 高牌 → 不合格。<br>Ante：<b>RM 25 × 1 = RM 25</b>（淨贏，拿回 RM 50）<br>Bet：退回（push）RM 50</p>',
            highlight: ['.cstud-dealer', '[data-bet="ante"]'],
            setup: (inst) => inst.demo.show('8S 8H 4D 5C 2S', 'AC QD 7H 4S 3D') },
          { id: 'payout-win', section: 'payout', title: '情境二：莊合格，你兩對贏',
            body: '<p>Ante：<b>RM 25 × 1 = RM 25</b><br>Bet：<b>RM 50 × 2 = RM 100</b>（兩對 2:1）<br>淨贏 RM 125，拿回 RM 200。</p>',
            highlight: ['.cstud-player', '[data-bet="bet"]'],
            setup: (inst) => inst.demo.show('JS JH 4D 4C 9S', 'KC KD 7H 5S 3D') },
          { id: 'payout-lose', section: 'payout', title: '情境三：莊合格，你輸',
            body: '<p>你一對 5，莊一對 Q。<br>Ante 輸 RM 25，Bet 輸 RM 50，<b>共 −RM 75</b>。</p>',
            highlight: ['.cstud-dealer', '.cstud-player'],
            setup: (inst) => inst.demo.show('5S 5H KD 8C 2S', 'QC QD 7H 4S 3D') },
          { id: 'payout-progressive', section: 'payout', title: '旁注獨立結算',
            body: '<p>旁注只看你的五張，<b>不論莊牌</b>：同花 RM 50、葫蘆 RM 100、四條 RM 500、同花順 獎池 10%、皇家 獎池全部。棄牌則旁注也輸。</p>',
            highlight: ['[data-bet="progressive"]', '.cstud-jackpot'],
            setup: (inst) => inst.demo.show('7S 7H 7D 7C 2S', 'AC QD 9H 4S 3D') },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: `<table class="lg-datatable"><tr><th>注</th><th>優勢</th></tr><tr><td>Ante（照策略）</td><td>5.22%</td></tr><tr><td>累積獎金旁注</td><td>約 ${edge}%</td></tr></table><p>旁注優勢很高：以目前獎池約 ${edge}%（獎池 RM 100,000 時約 86%），獎池要漲到約 RM 1.58M 才打平。</p>`,
            highlight: null },
          { id: 'strategy-rules', section: 'strategy', title: '策略三條',
            body: '<p>① 一對以上 → <b>跟注</b><br>② 只有 A-K → 看莊明牌決定（下一步）<br>③ 比 A-K 小 → <b>棄牌</b></p>',
            highlight: ['[data-action="raise"]', '[data-action="fold"]', '.cstud-player'] },
          { id: 'strategy-ak', section: 'strategy', title: 'A-K 怎麼決定',
            body: '<p>只有 A-K 時：莊明牌 2–Q 且你有同點數 → 跟；明牌 A/K 且你有 Q 或 J → 跟；其餘棄。例：你 A-K-8-5-2、莊明牌 8 → <b>跟注</b>。</p>',
            highlight: ['.cstud-dealer', '.cstud-player'],
            setup: (inst) => inst.demo.show('AS KH 8D 5C 2S', '8C 6D 9H 4S 3D', { reveal: false }) },
          { id: 'strategy-do-dont', section: 'strategy', title: '該押 / 別押',
            body: '<p>該押：只押 <b>Ante</b>，照三條策略決定。<br>別押：<b>累積獎金旁注</b>——除非獎池大到離譜，每 RM 5 平均虧一大半。</p>',
            highlight: ['[data-bet="ante"]', '[data-bet="progressive"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>跟注要再放 2 倍，所以每局最多用到 3×Ante。今晚只帶 RM 500，輸完就走。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      return {
        bets, state, demo,
        tray: () => tray,
        mount(el0) {
          root = el0;
          root.classList.add('cstud');
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          ctx.on('store:reset', paintPool);
          if (ctx.isPractice) ctx.strategyPanel(strategyNode());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (decideCd) { decideCd.cancel(); decideCd = null; }
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
