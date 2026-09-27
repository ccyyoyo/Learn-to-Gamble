// ============================================================================
// Pai Gow Poker 牌九撲克（id: paigow-poker）— 規格：docs/05-game-rules/paigow-poker.md
//
// 53 張（含一張小丑）。玩家與莊家各 7 張，分成 高手 High（5 張）+ 低手 Low（2 張），高手必須 ≥ 低手（否則 Foul 判輸）。
// 高、低分別和莊家比：兩邊都贏 → 1:1 扣 5% 佣；一贏一輸 → push；其餘 → 輸。相同（copy）歸莊。莊家永遠依房規排牌。
// Fortune 旁注：以玩家 7 張的最佳 5 張牌型判（與莊家無關）。
//
// 流程：請下注 → No more bets（扣款）→ 發 7 張 → 玩家排牌（真實 60 秒，逾時自動房規）→ 確認 Set
//       → 莊家開牌（依房規）→ 比較 → 結算（credit 拿回含本金）→ recordRound → explain → nextRound
// 評牌 / 房規 / 比牌全部用 LG.paigow（src/core/14-paigow-lib.js）。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const PG = LG.paigow;
  const K = PG.CATEGORY;
  const { el } = ui;
  const { fmt, round2 } = money;

  // ---------------------------------------------------------------- 規則常數
  const ARRANGE_SECONDS = 60;                 // 真實模式排牌時限
  const COMMISSION = 0.05;
  const FORTUNE_EDGE = '≈ 8.6%';              // Fortune 旁注優勢（Monte Carlo 240 萬手估計；[slow] 測試驗 6–11%）
  const FORTUNE_REAL = { min: 10, max: 500 }; // 規格未寫 Fortune 限注 → 假設（見 docs/change-requests/paigow-poker.md）
  /** Fortune Bonus 賠付表（規格 §3；N 賠 1） */
  const FORTUNE = [
    { cat: K.FIVE_ACES, mult: 400, zh: '五條 A', en: 'Five Aces' },
    { cat: K.ROYAL, mult: 150, zh: '皇家同花順', en: 'Royal Flush' },
    { cat: K.STRAIGHT_FLUSH, mult: 50, zh: '同花順', en: 'Straight Flush' },
    { cat: K.QUADS, mult: 25, zh: '四條', en: 'Four of a Kind' },
    { cat: K.FULL_HOUSE, mult: 5, zh: '葫蘆', en: 'Full House' },
    { cat: K.FLUSH, mult: 4, zh: '同花', en: 'Flush' },
    { cat: K.TRIPS, mult: 3, zh: '三條', en: 'Three of a Kind' },
    { cat: K.STRAIGHT, mult: 2, zh: '順子', en: 'Straight' },
  ];
  const FORTUNE_BY_CAT = Object.fromEntries(FORTUNE.map((f) => [f.cat, f]));

  // ---------------------------------------------------------------- 文案（集中）
  const T = {
    main: { zh: '主注', en: 'Bet', odds: '1:1 − 5% 佣' },
    fortune: { zh: 'Fortune 旁注', en: 'Fortune Bonus', odds: '2 – 400 : 1' },
    fortuneTable: '順 2・三條 3・同花 4・葫蘆 5・四條 25・同花順 50・皇家 150・五條 A 400',
    dealer: '莊家 <i class="en">DEALER</i>',
    you: '你 <i class="en">YOU</i>',
    high: '高手 <i class="en">HIGH</i>',
    low: '低手 <i class="en">LOW</i>',
    houseway: { label: '房規排牌', en: 'House Way' },
    set: { label: '確認', en: 'Set' },
    reset: { label: '重排', en: 'Reset' },
    needMain: '要先押主注 <i class="en">BET</i>（Fortune 旁注不能單獨押）',
    tapToLow: (n) => `點牌在高手 / 低手之間切換：低手要剛好 2 張（目前 ${n} 張）`,
    foul: (lo, hi) => `Foul 犯規：低手（${lo}）大於高手（${hi}）。高手必須 ≥ 低手，否則整手直接輸。`,
    ok: (hi, lo) => `高手：${hi}　｜　低手：${lo}　✓ 可以確認`,
    timeout: '排牌逾時：自動依房規排 <i class="en">House Way</i>',
    hwNote: (r) => `房規第 ${r.rule} 條：${r.why}`,
    dealerNote: (r) => `莊家依房規第 ${r.rule} 條：${r.why}`,
    lowEmpty: '點牌放這',
  };

  // ---------------------------------------------------------------- 純邏輯（可在 Node 單元測試）
  const RZ = { 1: 'A', 2: '2', 3: '3', 4: '4', 5: '5', 6: '6', 7: '7', 8: '8', 9: '9', 10: '10', 11: 'J', 12: 'Q', 13: 'K', 14: 'A' };
  const RE = { 2: 'Two', 3: 'Three', 4: 'Four', 5: 'Five', 6: 'Six', 7: 'Seven', 8: 'Eight', 9: 'Nine', 10: 'Ten', 11: 'Jack', 12: 'Queen', 13: 'King', 14: 'Ace' };
  const RV = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const isJoker = (c) => c.rank === 'X';
  const eff = (c) => (isJoker(c) ? 14 : RV[c.rank]);
  /** 由大到小（小丑視為 A，排在 A 前面） */
  const sortCards = (cards) => cards.slice().sort((a, b) => eff(b) - eff(a) || (isJoker(b) ? 1 : 0) - (isJoker(a) ? 1 : 0) || 'SHDC'.indexOf(a.suit) - 'SHDC'.indexOf(b.suit));
  const cardText = (c) => (isJoker(c) ? '小丑★' : `${c.rank === 'T' ? '10' : c.rank}${ui.SUIT[c.suit].symbol}`);
  const cardsText = (cards) => cards.map(cardText).join(' ');
  const parse = (s) => LG.cards.parseMany(s);

  /** 高手牌（eval5 結果）描述，含 A-2-3-4-5 第二大順、五條 A、小丑用途 */
  function describeHigh(ev) {
    let s;
    const wheel = ev.ranks && ev.ranks[0] === 5 && ev.ranks[4] === 1;
    if (ev.cat === K.FIVE_ACES) s = '五條 A（Five Aces）';
    else if (ev.cat === K.STRAIGHT && wheel) s = 'A-2-3-4-5 順子（第二大順 Wheel）';
    else if (ev.cat === K.STRAIGHT_FLUSH && wheel) s = 'A-2-3-4-5 同花順（第二大 Straight Flush）';
    else s = LG.poker.describe(ev);
    if (ev.jokerAs && ev.cat !== K.FIVE_ACES) s += ev.jokerAs.rank === 'A' ? '・小丑當 A' : `・小丑補 ${RZ[RV[ev.jokerAs.rank]]}`;
    return s;
  }
  /** 低手牌（eval2 結果）描述 */
  function describeLow(ev) {
    const [hi, lo] = ev.ranks;
    const j = (ev.cards || []).some(isJoker) ? '・小丑當 A' : '';
    if (ev.cat === 'PAIR') return `一對 ${RZ[hi]}（Pair of ${hi === 6 ? 'Sixes' : RE[hi] + 's'}）${j}`;
    return `${RZ[hi]}-${RZ[lo]} 高牌（${RE[hi]} High）${j}`;
  }
  /** Fortune 旁注：7 張最佳牌型 → {best, row|null, mult} */
  function fortuneOf(seven) {
    const best = PG.best(seven);
    const row = FORTUNE_BY_CAT[best.cat] || null;
    return { best, row, mult: row ? row.mult : 0 };
  }

  /**
   * 結算一局。
   * @param {{main:number, fortune?:number}} stakes
   * @param {Array} seven 玩家 7 張（Fortune 用）
   * @param {{high,low}} player 玩家分牌
   * @param {{high,low}} dealer 莊家分牌
   * @returns {{cmp, wagered, returned, net, mainNet, fortuneNet, fortune, lines:[{spot, stake, result, pay, formula}]}}
   */
  function settle(stakes, seven, player, dealer) {
    const main = stakes.main || 0, fstake = stakes.fortune || 0;
    const cmp = PG.compare(player, dealer);
    const lines = [];
    const mainNet = main ? PG.net(main, cmp.result) : 0;
    if (main) {
      const formula = cmp.result === 'win'
        ? `主注 ${fmt(main)} × 0.95 = +${fmt(mainNet)}（扣 5% 佣；拿回 ${fmt(round2(main + mainNet))}）`
        : cmp.result === 'push'
          ? `主注 ${fmt(main)} 退回（push）= RM 0`
          : `主注 ${fmt(main)} 輸 = −${fmt(main)}`;
      lines.push({ spot: 'main', stake: main, result: cmp.result, pay: mainNet, formula });
    }
    let fortuneNet = 0, fortune = null;
    if (fstake) {
      fortune = fortuneOf(seven);
      if (fortune.mult) {
        fortuneNet = round2(fstake * fortune.mult);
        lines.push({ spot: 'fortune', stake: fstake, result: 'win', pay: fortuneNet,
          formula: `Fortune ${fmt(fstake)} × ${fortune.mult} = +${fmt(fortuneNet)}（${fortune.row.zh}；拿回 ${fmt(round2(fstake + fortuneNet))}）` });
      } else {
        fortuneNet = -fstake;
        lines.push({ spot: 'fortune', stake: fstake, result: 'lose', pay: -fstake,
          formula: `Fortune ${fmt(fstake)} 輸（最佳只有 ${describeHigh(fortune.best).replace(/（.*$/, '')}，未達順子）= −${fmt(fstake)}` });
      }
    }
    const wagered = round2(main + fstake);
    const net = round2(mainNet + fortuneNet);
    return { cmp, wagered, returned: round2(wagered + net), net, mainNet, fortuneNet, fortune, lines };
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'paigow-poker',
    category: 'poker-table',
    order: 5,
    name: { zh: '牌九撲克', en: 'Pai Gow Poker' },
    summary: '7 張分成 5 張高手與 2 張低手，兩手都贏莊家才算贏；約四成是和局。',
    houseEdge: [
      { bet: { zh: '玩家不做莊', en: 'Player never banks' }, edge: 2.84, best: true },
    ],
    limits: { real: { min: 50, max: 3000 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: { settle, fortuneOf, describeHigh, describeLow, sortCards, FORTUNE, FORTUNE_REAL, ARRANGE_SECONDS, COMMISSION },

    create(ctx) {
      const L = ctx.limits;
      const state = {
        phase: 'idle',          // idle | betting | arranging | revealing | settled
        player: null,           // 7 張（排序後）
        dealer: null,           // 莊家 7 張
        dealerSplit: null,      // 莊家房規分牌 {high, low, rule, why}
        playerSplit: null,      // 確認後的玩家分牌
        low: new Set(),         // 目前放在低手的牌 id
        hw: null,               // 玩家這手的房規建議
        hwApplied: null,        // 最近一次按房規排牌的結果（顯示規則）
        staked: 0, rounds: 0, dealt: 0, hwClicks: 0,
        example: false, last: null,
      };
      const bets = new LG.Bets({
        min: L.min, max: Infinity, perSpotMin: L.min, perSpotMax: L.max,
        spotRules: {
          main: { label: '主注 BET' },
          fortune: { ...(ctx.isReal ? FORTUNE_REAL : { min: L.min, max: L.max }), label: 'Fortune 旁注' },
        },
      });
      let root, tableEl, tray, layer, bar, acts, win = null, arrangeCd = null;
      const D = {}; // DOM 參照
      let tutorQueue = ctx.isTutorial ? { player: 'KS KD QC 9H 7S 4D 2C', dealer: 'QH QD JS 8C 6H 5C 3S' } : null;

      // ---------------------------------------------------------- 桌面
      function zone(kind, who) {
        const cards = el('div.pg-zone__cards');
        const evalEl = el('div.pg-zone__eval');
        const z = el(`div.pg-zone.pg-zone--${kind}`, { dataset: { zone: kind, who } }, [
          el('div.pg-zone__label', { html: kind === 'high' ? `${T.high} <span class="pg-zone__n">5</span>` : `${T.low} <span class="pg-zone__n">2</span>` }),
          cards, evalEl,
        ]);
        return { z, cards, evalEl };
      }
      function spot(id) {
        const t = T[id];
        return el(`div.lg-spot.pg-spot.pg-spot--${id}`, { dataset: { bet: id } }, [
          el('span.lg-spot__zh', { text: t.zh }),
          el('span.lg-spot__en', { text: t.en }),
          el('span.lg-spot__odds', { text: t.odds }),
          id === 'fortune' ? el('span.pg-spot__table', { text: T.fortuneTable }) : el('span.pg-spot__table', { text: '兩手都贏才贏・copy 歸莊' }),
        ]);
      }
      function buildTable() {
        const dh = zone('high', 'dealer'), dl = zone('low', 'dealer');
        const ph = zone('high', 'player'), pl = zone('low', 'player');
        Object.assign(D, { dh, dl, ph, pl });
        D.dealerNote = el('div.pg-note.pg-dealer-note');
        D.status = el('div.pg-status', { role: 'status', 'aria-live': 'polite' });
        D.hwNote = el('div.pg-note.pg-hw-note');
        D.dealer = el('div.pg-area.pg-dealer', [el('div.lg-table__label.pg-area__label', { html: T.dealer }), el('div.pg-zones', [dh.z, dl.z]), D.dealerNote]);
        D.player = el('div.pg-area.pg-player', [el('div.lg-table__label.pg-area__label', { html: `${T.you}<span class="pg-area__sub">7 張：點牌切換高手 / 低手</span>` }), el('div.pg-zones', [ph.z, pl.z]), D.status, D.hwNote]);
        D.bets = el('div.pg-bets', [spot('main'), spot('fortune')]);
        tableEl = el('div.lg-table.pg-table', [D.dealer, D.player, D.bets]);

        acts = el('div.lg-actions.pg-actions', { dataset: { dealSlot: '' } });
        D.hint = el('div.lg-hint.pg-hint', { hidden: true });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, D.hint, acts, chips, barEl);

        D.bar = ui.actionBar(acts, [
          { id: 'houseway', label: T.houseway.label, en: T.houseway.en, hidden: true, onClick: () => applyHouseWay() },
          { id: 'reset', label: T.reset.label, en: T.reset.en, hidden: true, onClick: () => resetArrange() },
          { id: 'set', label: T.set.label, en: T.set.en, primary: true, hidden: true, disabled: true, onClick: () => confirmSet() },
        ]);
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 50 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId });
        bar = ui.betBar(barEl, { bets, layer });

        // 點牌切換高手/低手（事件委派；下注格由 betLayer 處理）
        D.player.addEventListener('click', (ev) => {
          const c = ev.target.closest && ev.target.closest('[data-card]');
          if (c) toggle(c.dataset.card);
        });
        D.player.addEventListener('keydown', (ev) => {
          if (ev.key !== 'Enter' && ev.key !== ' ') return;
          const c = ev.target.closest && ev.target.closest('[data-card]');
          if (c) { ev.preventDefault(); toggle(c.dataset.card); }
        });
        renderEmpty();
      }

      // ---------------------------------------------------------- 牌區繪製
      function fillZone(zn, cards, { faceDown = false, interactive = false, slots = 0 } = {}) {
        zn.cards.innerHTML = '';
        cards.forEach((c) => {
          const e = ui.card(c, { faceDown, size: 'md' });
          if (interactive) {
            e.dataset.card = c.id;
            e.setAttribute('tabindex', '0');
            e.setAttribute('role', 'button');
            e.classList.add('pg-tap');
          }
          zn.cards.appendChild(e);
        });
        for (let i = cards.length; i < slots; i++) zn.cards.appendChild(el('div.pg-slot', { 'aria-hidden': 'true' }));
        zn.z.classList.toggle('is-empty', !cards.length);
      }
      function clearMarks() {
        [D.dh, D.dl, D.ph, D.pl].forEach((zn) => { zn.z.classList.remove('is-win', 'is-lose', 'is-copy'); zn.evalEl.innerHTML = ''; });
        tableEl.querySelectorAll('[data-bet]').forEach((s) => s.classList.remove('is-win', 'is-lose'));
      }
      function renderEmpty() {
        clearMarks();
        fillZone(D.dh, [], { slots: 5 }); fillZone(D.dl, [], { slots: 2 });
        fillZone(D.ph, [], { slots: 5 }); fillZone(D.pl, [], { slots: 2 });
        D.dealerNote.textContent = ''; D.hwNote.textContent = '';
        D.status.className = 'pg-status';
        D.status.innerHTML = '下注後按發牌：你和莊家各拿 7 張。';
      }
      const lowCards = () => state.player.filter((c) => state.low.has(c.id));
      const highCards = () => state.player.filter((c) => !state.low.has(c.id));

      function renderDealer({ faceDown }) {
        const s = state.dealerSplit;
        fillZone(D.dh, faceDown ? state.dealer.slice(0, 5) : s.high, { faceDown });
        fillZone(D.dl, faceDown ? state.dealer.slice(5, 7) : s.low, { faceDown });
      }
      function renderPlayer() {
        const interactive = state.phase === 'arranging' && !state.example;
        fillZone(D.ph, sortCards(highCards()), { interactive });
        const lows = sortCards(lowCards());
        fillZone(D.pl, lows, { interactive });
        if (!lows.length && interactive) D.pl.cards.appendChild(el('div.pg-slot.pg-slot--hint', { text: T.lowEmpty }));
        D.player.classList.toggle('is-arranging', interactive);
      }

      /** 更新確認鈕、Foul 紅字、狀態列 */
      function paintArrange() {
        if (state.phase !== 'arranging' || state.example) return;
        const lo = lowCards(), hi = highCards();
        let valid = false;
        D.status.className = 'pg-status';
        if (lo.length !== 2) {
          D.status.innerHTML = T.tapToLow(lo.length);
        } else {
          const eh = PG.eval5(hi), el2 = PG.eval2(lo);
          valid = PG.isValidSplit(hi, lo);
          if (valid) {
            D.status.classList.add('is-ok');
            D.status.innerHTML = T.ok(describeHigh(eh), describeLow(el2));
          } else {
            D.status.classList.add('is-foul', 'pg-foul');
            D.status.innerHTML = T.foul(describeLow(el2), describeHigh(eh));
          }
        }
        btn('set', { disabled: !valid });
        D.player.classList.toggle('is-foul', lo.length === 2 && !valid);
        const hwMatch = state.hwApplied && lo.length === 2 && sameIds(lo, state.hwApplied.low);
        D.hwNote.textContent = hwMatch ? T.hwNote(state.hwApplied) : '';
        paintHint();
      }
      const sameIds = (a, b) => a.map((c) => c.id).sort().join() === b.map((c) => c.id).sort().join();

      /** 直接改按鈕屬性（actionBar.set 會重設 className，洗掉教學高亮） */
      function btn(id, { disabled, hidden } = {}) {
        const b = D.bar.button(id);
        if (!b) return;
        if (disabled !== undefined) b.disabled = !!disabled;
        if (hidden !== undefined) b.hidden = !!hidden;
      }
      function setArrangeButtons(on) {
        ['houseway', 'reset', 'set'].forEach((id) => btn(id, { hidden: !on }));
        if (!on) btn('set', { disabled: true });
      }

      // ---------------------------------------------------------- 排牌操作
      function toggle(id) {
        if (state.phase !== 'arranging' || state.example) return;
        if (state.low.has(id)) state.low.delete(id); else state.low.add(id);
        renderPlayer();
        paintArrange();
        const again = D.player.querySelector(`[data-card="${id}"]`);
        if (again && again.focus) try { again.focus({ preventScroll: true }); } catch { /* ignore */ }
      }
      function applyHouseWay() {
        if (state.phase !== 'arranging') return;
        live();
        const r = state.hw;
        state.low = new Set(r.low.map((c) => c.id));
        state.hwApplied = r;
        state.hwClicks += 1;
        renderPlayer();
        paintArrange();
      }
      function resetArrange() {
        if (state.phase !== 'arranging') return;
        live();
        state.low = new Set();
        state.hwApplied = null;
        renderPlayer();
        paintArrange();
      }

      // ---------------------------------------------------------- 練習提示
      function paintHint() {
        const show = ctx.hints && !ctx.isReal;
        D.hint.hidden = !show;
        if (!show) return;
        if (state.phase === 'arranging' && state.hw) {
          D.hint.innerHTML = `提示：房規建議 高手 <b>${cardsText(state.hw.high)}</b>｜低手 <b>${cardsText(state.hw.low)}</b><br>（第 ${state.hw.rule} 條：${state.hw.why}）`;
        } else {
          D.hint.innerHTML = `提示：只押主注（優勢 2.84%）。Fortune 旁注 ${FORTUNE_EDGE}，貴很多。排牌不會就按「房規排牌」。`;
        }
      }
      function strategyTable() {
        return ui.table([['條', '房規 House Way（莊家一定照這樣排）']].concat(Object.entries(PG.RULE_TEXT).map(([k, v]) => [k, v])),
          { caption: '房規排牌 9 條（本桌簡化版）' });
      }

      // ---------------------------------------------------------- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        setArrangeButtons(false);
        D.player.classList.remove('is-arranging', 'is-foul');
        if (state.last && !state.example) D.status.innerHTML += '<br><small>上一局的牌留在桌上；下注後開始下一局。</small>';
        paintHint();
        win = ctx.bettingWindow({
          bets, onClose: onNoMoreBets,
          validate: () => bets.get('main') > 0 || T.needMain,
        });
      }

      function onNoMoreBets({ ok, validation }) {
        if (ok && !(bets.get('main') > 0)) { ok = false; validation = { zh: T.needMain }; }
        if (!ok) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(validation.zh, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        deal();
      }

      /** 發牌（同步：教學 setup 需要立即進入排牌） */
      function deal() {
        let p, d;
        if (tutorQueue) { p = parse(tutorQueue.player); d = parse(tutorQueue.dealer); tutorQueue = null; }
        else {
          const deck = LG.rng.shuffle(LG.cards.newDeck({ jokers: 1 }));
          p = deck.slice(0, 7); d = deck.slice(7, 14);
        }
        state.example = false;
        state.player = sortCards(p);
        state.dealer = d;
        state.dealerSplit = PG.houseWay(d);
        state.hw = PG.houseWay(state.player);
        state.low = new Set();
        state.hwApplied = null;
        state.playerSplit = null;
        state.dealt += 1;
        clearMarks();
        D.dealerNote.textContent = '';
        state.phase = 'arranging';
        renderDealer({ faceDown: true });
        renderPlayer();
        D.player.classList.add('is-dealt');
        setArrangeButtons(true);
        ctx.dealer.say('請排牌：高手 5 張、低手 2 張', 'Set your hand');
        paintArrange();
        if (ctx.isReal) {
          arrangeCd = ui.countdown(ARRANGE_SECONDS, { onDone: onArrangeTimeout });
        }
      }

      function onArrangeTimeout() {
        arrangeCd = null;
        if (!ctx.alive() || state.phase !== 'arranging') return;
        applyHouseWay();
        ui.toast(T.timeout, { type: 'warn' });
        confirmSet();
      }

      function confirmSet() {
        if (state.phase !== 'arranging') return;
        live();
        const hi = highCards(), lo = lowCards();
        if (lo.length !== 2) { ui.toast(T.tapToLow(lo.length), { type: 'warn' }); return; }
        if (!PG.isValidSplit(hi, lo)) { ui.toast('Foul：高手必須 ≥ 低手', { type: 'warn' }); return; }
        if (arrangeCd) { arrangeCd.cancel(); arrangeCd = null; }
        state.playerSplit = { high: sortCards(hi), low: sortCards(lo) };
        state.phase = 'revealing';
        setArrangeButtons(false);
        renderPlayer();
        D.status.className = 'pg-status';
        D.status.innerHTML = '已確認。莊家開牌並依房規排…';
        ctx.dealer.say('莊家開牌，依房規排牌', 'Dealer sets the house way');
        reveal();
      }

      async function reveal() {
        renderDealer({ faceDown: true });
        const s = state.dealerSplit;
        const els = [...D.dh.cards.children, ...D.dl.cards.children];
        const cards = s.high.concat(s.low);
        await Promise.all(els.map((e, i) => ui.flip(e, cards[i])));
        if (!ctx.alive()) return;
        D.dealerNote.textContent = T.dealerNote(s);
        await ctx.wait(ctx.isTutorial ? 150 : 450);
        if (!ctx.alive()) return;
        finish();
      }

      function markZone(zn, side) {
        // side: 1 玩家贏、0 copy（歸莊）、-1 莊贏
        zn.z.classList.remove('is-win', 'is-lose', 'is-copy');
        zn.z.classList.add(side > 0 ? 'is-win' : side < 0 ? 'is-lose' : 'is-copy');
      }
      function paintEvals(player, dealer, cmp) {
        const ph = PG.eval5(player.high), pl = PG.eval2(player.low);
        const dh = PG.eval5(dealer.high), dl = PG.eval2(dealer.low);
        D.ph.evalEl.textContent = describeHigh(ph);
        D.pl.evalEl.textContent = describeLow(pl);
        D.dh.evalEl.textContent = describeHigh(dh);
        D.dl.evalEl.textContent = describeLow(dl);
        if (cmp && !cmp.foul) {
          markZone(D.ph, cmp.high); markZone(D.pl, cmp.low);
          markZone(D.dh, -cmp.high || 1); markZone(D.dl, -cmp.low || 1);
          // copy：莊家那邊也算贏
          if (cmp.high === 0) { D.ph.z.classList.replace('is-win', 'is-copy'); }
          if (cmp.low === 0) { D.pl.z.classList.replace('is-win', 'is-copy'); }
        } else if (cmp && cmp.foul) {
          [D.ph, D.pl].forEach((zn) => markZone(zn, -1));
        }
        return { ph, pl, dh, dl };
      }

      function sideText(side, you, dealer) {
        if (side > 0) return `你的「${you}」> 莊的「${dealer}」→ 你贏`;
        if (side < 0) return `你的「${you}」< 莊的「${dealer}」→ 莊贏`;
        return `你和莊都是「${you}」→ 一模一樣（copy）歸莊`;
      }

      function finish() {
        const r = settle({ main: bets.get('main'), fortune: bets.get('fortune') }, state.player, state.playerSplit, state.dealerSplit);
        ctx.bank.credit(r.returned);
        state.staked = 0;
        const ev = paintEvals(state.playerSplit, state.dealerSplit, r.cmp);
        D.pl.z.classList.toggle('is-foul', r.cmp.foul);
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          const line = r.lines.find((l) => l.spot === s.dataset.bet);
          s.classList.toggle('is-win', !!line && line.pay > 0);
          s.classList.toggle('is-lose', !!line && line.pay < 0);
        });
        const res = r.cmp.result;
        const RES = {
          win: ['兩手都贏', 'PLAYER WINS'], push: ['一贏一輸 和局', 'PUSH'], lose: [r.cmp.foul ? 'Foul 犯規 → 輸' : '莊家贏', 'DEALER WINS'],
        }[res];
        ctx.dealer.say(`${RES[0]}，派彩`, res === 'win' ? 'Player wins — paying out' : res === 'push' ? 'Push' : 'Dealer wins');
        D.status.className = `pg-status is-${res}`;
        D.status.innerHTML = `${RES[0]} <i class="en">${RES[1]}</i>　淨 <b>${money.fmtSigned(r.net)}</b>`;

        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });

        const P = state.playerSplit, Dd = state.dealerSplit;
        const hand = `莊 <i class="en">Dealer</i>：高手 <b>${describeHigh(ev.dh)}</b>［${cardsText(Dd.high)}］｜低手 <b>${describeLow(ev.dl)}</b>［${cardsText(Dd.low)}］`
          + `<br>你 <i class="en">You</i>：高手 <b>${describeHigh(ev.ph)}</b>［${cardsText(P.high)}］｜低手 <b>${describeLow(ev.pl)}</b>［${cardsText(P.low)}］`
          + (r.fortune ? `<br>Fortune（7 張最佳）：<b>${describeHigh(r.fortune.best)}</b>` : '');
        const sideRes = (x) => (x > 0 ? '你贏' : x < 0 ? '莊贏' : 'copy 歸莊');
        const result = r.cmp.foul
          ? `Foul 犯規 → 主注輸 <i class="en">LOSE</i>`
          : `高手 ${sideRes(r.cmp.high)}、低手 ${sideRes(r.cmp.low)} → <b>${RES[0]}</b> <i class="en">${RES[1]}</i>`;
        const formula = r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>`;
        let why;
        if (r.cmp.foul) {
          why = `你的低手（${describeLow(ev.pl)}）比高手（${describeHigh(ev.ph)}）大，這叫 Foul，整手直接判輸。`;
        } else {
          why = `高手：${sideText(r.cmp.high, describeHigh(ev.ph), describeHigh(ev.dh))}。低手：${sideText(r.cmp.low, describeLow(ev.pl), describeLow(ev.dl))}。`
            + (res === 'win' ? '兩手都贏才算贏，贏了要付 5% 佣金。' : res === 'push' ? '一贏一輸 = push，本金退回。' : `兩手都沒贏${r.cmp.high === 0 || r.cmp.low === 0 ? '（copy 算莊贏）' : ''} → 輸。`);
        }
        if (!sameIds(P.low, state.hw.low)) why += `<br>房規排法：高手 ${cardsText(state.hw.high)}｜低手 ${cardsText(state.hw.low)}（第 ${state.hw.rule} 條）。`;
        if (r.fortune) why += r.fortune.mult ? `<br>Fortune 看你自己 7 張的最佳牌型（${r.fortune.row.zh}），跟莊家無關。` : '<br>Fortune 要 7 張裡湊到順子以上才賠。';
        ctx.explain({ hand, result, formula, why });

        state.last = { result: res, net: r.net };
        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      // ---------------------------------------------------------- 教學示範
      /** 示範例子（只改畫面，不動狀態） */
      const EXAMPLES = {
        jokerA: { player: ['AS AH XJ 9D 8C', 'KD 2C'], note: '小丑當 A：A-A-小丑 = 三條 A' },
        jokerStraight: { player: ['9S TD JC QH XJ', 'AD 5C'], note: '小丑補順：9-10-J-Q + 小丑 = K 高順子' },
        wheel: { dealer: ['9S TH JD QC KS', '4H 3C'], player: ['AS 2H 3D 4C 5S', 'QD JH'], note: 'A-2-3-4-5 是第二大順：贏 9-K 順，只輸 10-J-Q-K-A' },
        win: { dealer: ['QH QD 6H 5C 3S', 'JS 8C'], player: ['KS KD 7S 4D 2C', 'QC 9H'], note: '兩手都贏：RM 100 × 0.95 = RM 95' },
        push: { dealer: ['AC AD 7D 5C 3H', 'KH JD'], player: ['KS KD 7C 5H 3S', 'AH QD'], note: '高手輸、低手贏 → push' },
        copy: { dealer: ['KH KC 7S 5D 3C', 'AH QC'], player: ['KS KD 7C 5H 3S', 'AD QD'], note: '兩手都一樣（copy）→ 歸莊，你輸' },
        foul: { player: ['QC 9H 7S 4D 2C', 'KS KD'], note: 'Foul：低手一對 K > 高手 Q 高牌' },
        fortune: { player: ['9S 9D 9C AH KS', '5D 2C'], note: 'Fortune：7 張最佳 = 三條 9 → 賠 3 倍' },
      };
      function showExample(key) {
        const ex = EXAMPLES[key];
        state.example = true;
        clearMarks();
        D.player.classList.remove('is-arranging', 'is-foul');
        const split = (pair) => ({ high: parse(pair[0]), low: parse(pair[1]) });
        const p = split(ex.player);
        fillZone(D.ph, p.high); fillZone(D.pl, p.low);
        D.ph.evalEl.textContent = describeHigh(PG.eval5(p.high));
        D.pl.evalEl.textContent = describeLow(PG.eval2(p.low));
        if (ex.dealer) {
          const d = split(ex.dealer);
          fillZone(D.dh, d.high); fillZone(D.dl, d.low);
          const cmp = PG.compare(p, d);
          paintEvals(p, d, cmp);
        } else {
          fillZone(D.dh, [], { slots: 5 }); fillZone(D.dl, [], { slots: 2 });
        }
        D.dealerNote.textContent = '';
        D.hwNote.textContent = '';
        D.status.className = `pg-status is-example${key === 'foul' ? ' is-foul pg-foul' : ''}`;
        D.status.innerHTML = `示範 <i class="en">Example</i>：${ex.note}`;
        D.player.classList.toggle('is-foul', key === 'foul');
      }
      /** 回到真實桌況（離開示範） */
      function live() {
        if (!state.example) return;
        state.example = false;
        clearMarks();
        if (!state.player) { renderEmpty(); return; }
        if (state.phase === 'arranging') {
          renderDealer({ faceDown: true });
          renderPlayer();
          paintArrange();
          return;
        }
        renderEmpty();
      }
      const demo = {
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        example: showExample,
        live,
        ensureBetting() {
          live();
          if (state.phase === 'idle' || state.phase === 'settled') startRound();
        },
        /** 確保在排牌階段：還在下注就自動押 RM 50 主注並發牌 */
        ensureArranging() {
          live();
          if (state.phase !== 'betting' || !win) return;
          if (!bets.get('main')) {
            const amt = Math.min(50, Math.floor(ctx.bank.balance() - bets.total()));
            if (amt < L.min) return;
            bets.set('main', amt);
          }
          win.close();
        },
        /** 擺出 Foul：把對子（沒有就最大兩張）放低手 */
        foul() {
          demo.ensureArranging();
          if (state.phase !== 'arranging') { showExample('foul'); return; }
          const groups = {};
          state.player.forEach((c) => { (groups[eff(c)] = groups[eff(c)] || []).push(c); });
          const pair = Object.entries(groups).filter(([, g]) => g.length >= 2).sort((a, b) => b[0] - a[0])[0];
          const low = pair ? pair[1].slice(0, 2) : state.player.slice(0, 2);
          state.low = new Set(low.map((c) => c.id));
          state.hwApplied = null;
          renderPlayer();
          paintArrange();
        },
      };

      // ---------------------------------------------------------- 教學步驟
      function tutorialSteps() {
        const inArrange = (inst) => { if (inst.state.phase !== 'arranging') inst.demo.ensureArranging(); else inst.demo.live(); };
        return [
          // ===== layout 桌面
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>牌九撲克用 53 張牌（多一張小丑）。上方是莊家，下方是你，最下面是下注格。</p>',
            highlight: ['.pg-table'], setup: (inst) => inst.demo.ensureBetting() },
          { id: 'layout-dealer', section: 'layout', title: `莊家 <i class="en">Dealer</i> 區`,
            body: '<p>莊家也拿 7 張，排成 <b>高手 <i class="en">High</i></b> 5 張 + <b>低手 <i class="en">Low</i></b> 2 張，先蓋著。</p>',
            highlight: ['.pg-dealer'] },
          { id: 'layout-you', section: 'layout', title: '你的 7 張',
            body: '<p>你的 7 張橫排在這裡。發牌後<b>點一張牌</b>就在高手 / 低手之間切換。</p>',
            highlight: ['.pg-player'] },
          { id: 'layout-main', section: 'layout', title: `主注 <i class="en">BET</i>`,
            body: '<p>主注賠 <b>1:1</b>，但贏了要扣 <b>5% 佣金 <i class="en">Commission</i></b>。</p>',
            highlight: ['[data-bet="main"]'] },
          { id: 'layout-fortune', section: 'layout', title: `Fortune 旁注 <i class="en">Side bet</i>`,
            body: '<p>只看你自己 7 張湊出的最佳牌型：順子賠 2、三條 3 … 五條 A 賠 400。可以不押。</p>',
            highlight: ['[data-bet="fortune"]'] },
          // ===== flow 流程
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>請下注 → 停止下注 → 發 7 張 → 你排牌 → 莊家開牌、依房規排 → 比較 → 派彩。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-place', section: 'flow', title: '押主注',
            body: '<p>點選籌碼，再點「主注 BET」放上去。長按或右鍵拿回一枚。</p>',
            highlight: ['[data-bet="main"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「主注 BET」放 RM 50', check: (inst) => inst.bets.get('main') >= 50 || inst.state.dealt > 0 || `目前主注 ${fmt(inst.bets.get('main'))}` } },
          { id: 'flow-deal', section: 'flow', title: `發牌 <i class="en">Deal</i>`,
            body: '<p>按「發牌」。現場 7 手牌由骰子決定從哪一位開始發，每人 7 張。</p>',
            highlight: ['[data-action="deal"]', '.pg-player'],
            setup: (inst) => { if (!inst.state.dealt) inst.demo.ensureBetting(); },
            action: { label: '按「發牌 Deal」', check: (inst) => inst.state.dealt > 0 || '先在主注放籌碼，再按「發牌」' } },
          { id: 'flow-no-more-bets', section: 'flow', title: `停止下注 <i class="en">No more bets</i>`,
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下——加、減、移動籌碼都不行，等派彩完成。</p>',
            highlight: ['.lg-dealer-banner', '.pg-bets'],
            setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          { id: 'flow-split', section: 'flow', title: '排牌：5 張 + 2 張',
            body: '<p>點 2 張牌移到 <b>低手 LOW</b>，其餘 5 張就是 <b>高手 HIGH</b>。再點一次可移回。</p>',
            highlight: ['.pg-player'], setup: inArrange },
          { id: 'flow-foul', section: 'flow', title: `犯規 <i class="en">Foul</i>`,
            body: '<p>高手一定要 <b>≥</b> 低手。現在把對子放進低手，低手反而比高手大 → Foul：紅字警告、「確認」按不下去；真的送出會整手直接輸。</p>',
            highlight: ['.pg-status', '[data-action="set"]'],
            setup: (inst) => inst.demo.foul() },
          { id: 'flow-houseway', section: 'flow', title: `房規排牌 <i class="en">House Way</i>`,
            body: '<p>不會排？按「房規排牌」，照莊家的排法幫你排好，並顯示套用哪一條規則。</p>',
            highlight: ['[data-action="houseway"]', '.pg-hw-note'],
            setup: (inst) => { if (!inst.state.hwClicks) inArrange(inst); },
            action: { label: '按「房規排牌 House Way」', check: (inst) => inst.state.hwClicks > 0 || '按動作列的「房規排牌」' } },
          { id: 'flow-time', section: 'flow', title: '排牌時限',
            body: '<p>真實模式排牌只有 <b>60 秒</b>；時間到會自動依房規排好送出。</p>',
            highlight: ['[data-action="houseway"]'] },
          { id: 'flow-hide', section: 'flow', title: '牌不能給別人看',
            body: '<p>排牌時牌只給自己看，不能亮給其他玩家、也不要跟旁人討論怎麼排。</p>',
            highlight: ['.pg-player'] },
          { id: 'flow-set', section: 'flow', title: `確認 <i class="en">Set</i>`,
            body: '<p>低手剛好 2 張、沒有 Foul，就按「確認」。莊家接著開牌並依房規排。</p>',
            highlight: ['[data-action="set"]'],
            setup: (inst) => { if (!inst.state.rounds) inArrange(inst); },
            action: { label: '按「確認 Set」完成這一局', check: (inst) => inst.state.rounds > 0 || '低手 2 張、不 Foul，再按「確認」' } },
          // ===== payout 輸贏與賠率
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼比、怎麼賠',
            body: '<p>高手比高手、低手比低手，兩邊分開比。牌型大小和一般撲克一樣，低手只看對子和高牌。</p>',
            highlight: ['.pg-zones'], setup: (inst) => inst.demo.example('win') },
          { id: 'payout-joker-a', section: 'payout', title: `小丑 <i class="en">Joker</i>：當 A`,
            body: '<p>小丑可以當 <b>A</b>。A、A、小丑 = 三條 A。在低手裡小丑一律當 A。</p>',
            highlight: ['.pg-player .pg-zone--high'], setup: (inst) => inst.demo.example('jokerA') },
          { id: 'payout-joker-b', section: 'payout', title: '小丑：補順、同花',
            body: '<p>小丑也能補 <b>順子、同花、同花順</b>；但<b>不能補對子</b>：K、K、小丑只是一對 K 帶 A。</p>',
            highlight: ['.pg-player .pg-zone--high'], setup: (inst) => inst.demo.example('jokerStraight') },
          { id: 'payout-wheel', section: 'payout', title: 'A-2-3-4-5：第二大順',
            body: '<p>本桌房規：<b>A-2-3-4-5 是第二大的順子</b>，只輸 10-J-Q-K-A，贏 9-10-J-Q-K。</p>',
            highlight: ['.pg-zone--high'], setup: (inst) => inst.demo.example('wheel') },
          { id: 'payout-win', section: 'payout', title: '兩手都贏：扣 5% 佣',
            body: '<p>主注 RM 100，兩手都贏：<br><b>RM 100 × 0.95 = RM 95</b>（淨贏）<br>拿回 RM 195（含本金）。</p>',
            highlight: ['.pg-zones', '[data-bet="main"]'], setup: (inst) => inst.demo.example('win') },
          { id: 'payout-push', section: 'payout', title: `一贏一輸：和局 <i class="en">Push</i>`,
            body: '<p>高手輸、低手贏 → push：<br><b>RM 100 退回，淨 RM 0</b>。</p>',
            highlight: ['.pg-zones'], setup: (inst) => inst.demo.example('push') },
          { id: 'payout-copy', section: 'payout', title: `一樣大 <i class="en">Copy</i> 歸莊`,
            body: '<p>和莊家一模一樣叫 copy，算<b>莊家贏</b>。這例兩手都 copy → 主注 RM 100 輸 = −RM 100。</p>',
            highlight: ['.pg-zones'], setup: (inst) => inst.demo.example('copy') },
          { id: 'payout-fortune', section: 'payout', title: 'Fortune 怎麼賠',
            body: '<p>Fortune 只看你 7 張最佳牌型。三條 9，押 RM 10：<br><b>RM 10 × 3 = RM 30</b>（淨贏）<br>拿回 RM 40。</p>',
            highlight: ['[data-bet="fortune"]', '.pg-player'], setup: (inst) => inst.demo.example('fortune') },
          // ===== strategy 策略
          { id: 'strategy-intro', section: 'strategy', title: '這段你會學到：怎麼玩最划算',
            body: '<p>莊家優勢、房規要點、為什麼牌九撲克輸得慢、哪個注別押。</p>',
            highlight: null, setup: (inst) => inst.demo.live() },
          { id: 'strategy-edge', section: 'strategy', title: `莊家優勢 <i class="en">House edge</i>`,
            body: `<table class="lg-datatable"><tr><th>注</th><th>優勢</th></tr><tr><td>主注（玩家不做莊）</td><td>2.84%</td></tr><tr><td>Fortune 旁注</td><td>${FORTUNE_EDGE}（模擬）</td></tr></table><p>每押 RM 100，主注長期平均輸 RM 2.84。</p>`,
            highlight: null },
          { id: 'strategy-houseway', section: 'strategy', title: '房規要點',
            body: '<p>無對：最大放高、次兩張放低。一對：對子放高。兩對：多半拆開、小對放低。不確定就按「房規排牌」。</p>',
            highlight: ['.pg-player'] },
          { id: 'strategy-push', section: 'strategy', title: '約 41% 是和局',
            body: '<p>大約 <b>41%</b> 的牌局一贏一輸 → push。錢進出很慢、波動低，很耐玩；但 5% 佣金讓你長期還是輸 2.84%。</p>',
            highlight: ['[data-bet="main"]'] },
          { id: 'strategy-bet', section: 'strategy', title: '該押：主注 + 照房規排',
            body: '<p>只押主注，排牌照房規（或按「房規排牌」），優勢就是最低的 2.84%。</p>',
            highlight: ['[data-bet="main"]'] },
          { id: 'strategy-avoid', section: 'strategy', title: '別押：Fortune 旁注',
            body: `<p>Fortune 看起來賠很多（最高 400 倍），但優勢 ${FORTUNE_EDGE}，大約是主注的 3 倍。</p>`,
            highlight: ['[data-bet="fortune"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。和局多只是輸得慢，不會讓你贏。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ---------------------------------------------------------- instance
      return {
        bets,
        state,
        demo,
        tray: () => tray,
        /** 測試用：目前的分牌與排牌操作（同動作列按鈕） */
        split: () => (state.player ? { high: highCards(), low: lowCards() } : null),
        actions: { toggle, houseWay: applyHouseWay, reset: resetArrange, set: confirmSet },
        mount(el0) {
          root = el0;
          root.classList.add('pg-root');
          buildTable();
          paintHint();
          ctx.on('hints:change', paintHint);
          if (ctx.isPractice) ctx.strategyPanel(strategyTable());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (arrangeCd) { arrangeCd.cancel(); arrangeCd = null; }
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
