// ============================================================================
// 視訊撲克 Jacks or Better 9/6（id: video-poker）— 規格：docs/05-game-rules/video-poker.md
//
// 一手流程：選每枚金額（RM 0.20–5）與枚數（BET ONE / MAX BET，1–5 枚）→ DEAL（扣款 枚數 × 每枚）
//   → 點牌切換 HOLD → DRAW 換掉沒留的牌 → 依賠付表派彩（bank.credit）。
// 不用籌碼盤（def 無 denoms）、真實模式不倒數（玩家自己按 DEAL）。見 docs/change-requests/video-poker.md。
// 純邏輯（賠付表、15 條持牌策略 suggestHold、期望值 evHold）放在 def.logic 供單元測試。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el, term, toast } = ui;
  const { fmt, fmtSigned, round2 } = money;

  // ---------------------------------------------------------------- 常數
  const COIN_VALUES = [0.2, 0.5, 1, 2, 5];   // 每枚金額 RM
  const MAX_COINS = 5;
  const B5 = 1048576;                         // LG.poker score 的類別基數（16^5）

  // 賠付表（每枚倍數；9/6 全額版）。皇家 1–4 枚每枚 250，5 枚每枚 800（= 4000）
  const PAYTABLE = [
    { key: 'royal', cat: 9, zh: '皇家同花順', en: 'Royal Flush', pay: 250, pay5: 800 },
    { key: 'sf', cat: 8, zh: '同花順', en: 'Straight Flush', pay: 50 },
    { key: 'quads', cat: 7, zh: '四條', en: 'Four of a Kind', pay: 25 },
    { key: 'fh', cat: 6, zh: '葫蘆', en: 'Full House', pay: 9 },
    { key: 'flush', cat: 5, zh: '同花', en: 'Flush', pay: 6 },
    { key: 'straight', cat: 4, zh: '順', en: 'Straight', pay: 4 },
    { key: 'trips', cat: 3, zh: '三條', en: 'Three of a Kind', pay: 3 },
    { key: 'twopair', cat: 2, zh: '兩對', en: 'Two Pair', pay: 2 },
    { key: 'jacks', cat: 1, zh: 'J 以上一對', en: 'Jacks or Better', pay: 1 },
  ];
  const PT = Object.fromEntries(PAYTABLE.map((p) => [p.key, p]));
  const KEY_BY_CAT = Object.fromEntries(PAYTABLE.map((p) => [p.cat, p.key]));

  // ---------------------------------------------------------------- 文案
  const T = {
    title: 'JACKS OR BETTER',
    sub: '9/6 全額版 Full Pay',
    hand: { zh: '牌型', en: 'Hand' },
    coins: { zh: '枚', en: 'Coins' },
    credit: { zh: '餘額', en: 'CREDIT' },
    bet: { zh: '押注', en: 'BET' },
    win: { zh: '贏', en: 'WIN' },
    coinValue: { zh: '每枚', en: 'Coin' },
    held: 'HELD',
    btn: {
      betOne: { label: '加一枚', en: 'BET ONE' },
      maxBet: { label: '押滿', en: 'MAX BET' },
      deal: { label: '發牌', en: 'DEAL' },
      draw: { label: '換牌', en: 'DRAW' },
    },
    status: {
      start: '選每枚金額與枚數，按 DEAL 發牌',
      hold: '點牌切換 HOLD（留），再按 DRAW 換掉其餘',
      demo: '教學示範手牌：點牌選 HOLD',
      lose: '沒有中獎 — 按 DEAL 再來一手',
    },
    hintIdle: '提示：永遠押滿 5 枚（MAX BET）；嫌大就把每枚金額調低。',
    noAfford: (x) => `餘額不足：這手要 ${x}。調低每枚金額或枚數。`,
    tutorFree: '（教學模式不扣款）',
  };

  // 15 條持牌策略（規格 §4；由上往下第一條符合即採用）
  const RULE_TEXT = [
    null,
    { zh: '已成牌：皇家同花順／同花順／四條，全留', short: '已成大牌', en: 'Royal / Straight Flush / Quads', why: '已經是大獎牌型，全部留住。' },
    { zh: '四張皇家順聽', short: '四張皇家順聽', en: '4 to a Royal', why: '只差 1 張就是皇家同花順（5 枚賠 4000），就算拆掉同花、順或高對也值得。' },
    { zh: '已成牌：葫蘆／同花／順全留；三條留三張', short: '已成牌', en: 'Full House / Flush / Straight / Trips', why: '已成牌不拆；三條只留三張，換 2 張拚四條或葫蘆。' },
    { zh: '四張同花順聽', short: '四張同花順聽', en: '4 to a Straight Flush', why: '差 1 張成同花順（每枚 50），還可能中同花或順。' },
    { zh: '兩對', short: '兩對', en: 'Two Pair', why: '兩對已經賠 2，換 1 張還有 4/47 的機會變葫蘆。' },
    { zh: '高對（J 以上）', short: '高對', en: 'High Pair', why: 'J 以上一對已經保本，換 3 張拚兩對、三條、葫蘆、四條。' },
    { zh: '三張皇家順聽', short: '三張皇家順聽', en: '3 to a Royal', why: '保留中皇家的機會，也常成同花、順或高對。' },
    { zh: '四張同花聽', short: '四張同花聽', en: '4 to a Flush', why: '差 1 張成同花（每枚 6），有 9/47 的機會。' },
    { zh: '低對（10 以下）', short: '低對', en: 'Low Pair', why: '低對本身不賠，但換 3 張有機會變兩對、三條以上。' },
    { zh: '四張兩頭順聽', short: '四張兩頭順聽', en: '4 to an Open-ended Straight', why: '兩頭都能接：8/47 的機會成順（每枚 4）。' },
    { zh: '兩張同花高牌（J 以上）', short: '兩張同花高牌', en: '2 Suited High Cards', why: '可能配成高對，也保有皇家與同花的機會。' },
    { zh: '三張同花順聽', short: '三張同花順聽', en: '3 to a Straight Flush', why: '保有同花順、同花、順的機會。' },
    { zh: '兩張不同花高牌（三張以上留最低兩張）', short: '兩張高牌', en: '2 Unsuited High Cards', why: '配成 J 以上一對就保本；留最低的兩張，接成順的機會較多。' },
    { zh: '一張高牌', short: '一張高牌', en: '1 High Card', why: '至少保有配成 J 以上一對的機會。' },
    { zh: '全換', short: '全換', en: 'Discard All', why: '沒有值得留的牌，五張全換的期望值最高。' },
  ];

  // ---------------------------------------------------------------- 純邏輯
  const RV = { '2': 2, '3': 3, '4': 4, '5': 5, '6': 6, '7': 7, '8': 8, '9': 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const rv = (c) => RV[c.rank];
  const rankTxt = (c) => (c.rank === 'T' ? '10' : c.rank);
  const cardTxt = (c) => LG.cards.label(c);

  /** 每枚賠率（依枚數；皇家 5 枚 800） */
  function perCoin(key, coins) {
    const p = PT[key];
    if (!p) return 0;
    return key === 'royal' && coins === MAX_COINS ? p.pay5 : p.pay;
  }
  /** 總贏枚數 */
  function coinsWon(key, coins) { return key ? perCoin(key, coins) * coins : 0; }

  /** 牌型 key（未中獎 → null）。接受牌陣列或 LG.poker score 數字 */
  function handKeyFromScore(s) {
    const cat = Math.floor(s / B5);
    if (cat === 1) return ((s % B5) >> 16) >= 11 ? 'jacks' : null;
    return KEY_BY_CAT[cat] || null;
  }
  function handKey(cards) { return handKeyFromScore(LG.poker.score(cards)); }

  /** 5 張牌的結算：{key, name, desc, perCoin, coinsWon} */
  function payout(cards, coins) {
    const ev = LG.poker.eval5(cards);
    const key = handKeyFromScore(ev.score);
    return { key, name: key ? PT[key] : null, desc: LG.poker.describe(ev), perCoin: key ? perCoin(key, coins) : 0, coinsWon: coinsWon(key, coins), eval: ev };
  }

  function combos(arr, k) {
    const out = [];
    const rec = (start, pick) => {
      if (pick.length === k) { out.push(pick.slice()); return; }
      for (let i = start; i < arr.length; i++) { pick.push(arr[i]); rec(i + 1, pick); pick.pop(); }
    };
    rec(0, []);
    return out;
  }
  /** 同花色的牌是否落在 5 張寬的順子窗內（A 可當 1） */
  function fitsWindow(ranks) {
    if (new Set(ranks).size !== ranks.length) return false;
    const span = (rs) => Math.max(...rs) - Math.min(...rs) <= 4;
    if (span(ranks)) return true;
    return ranks.includes(14) && span(ranks.map((r) => (r === 14 ? 1 : r)));
  }

  function analyze(cards) {
    const r = cards.map(rv);
    const ev = LG.poker.eval5(cards);
    const byRank = {}, bySuit = {};
    cards.forEach((c, i) => { (byRank[r[i]] = byRank[r[i]] || []).push(i); (bySuit[c.suit] = bySuit[c.suit] || []).push(i); });
    const all = [0, 1, 2, 3, 4];
    const highs = all.filter((i) => r[i] >= 11);
    const suited = (k, pred) => {
      const out = [];
      Object.values(bySuit).forEach((g) => { if (g.length >= k) combos(g, k).forEach((c) => { if (!pred || pred(c)) out.push(c); }); });
      return out;
    };
    const groups = (n) => Object.keys(byRank).map(Number).filter((k) => byRank[k].length === n);
    return { cards, r, cat: ev.cat, byRank, bySuit, all, highs, suited, groups };
  }

  const hiCount = (a, idx) => idx.filter((i) => a.r[i] >= 11).length;
  const sumR = (a, idx) => idx.reduce((s, i) => s + a.r[i], 0);

  // 每條規則：cands(a) → 所有符合的留法（index 陣列）；pick(cands, a) → 建議的那一個
  const RULES = [
    { n: 1, cands: (a) => (a.cat >= 7 ? [a.all, ...(a.cat === 7 ? [a.byRank[a.groups(4)[0]]] : [])] : []) },
    { n: 2, cands: (a) => a.suited(4, (c) => c.every((i) => a.r[i] >= 10)) },
    { n: 3, cands: (a) => (a.cat >= 4 && a.cat <= 6 ? [a.all] : a.cat === 3 ? [a.byRank[a.groups(3)[0]]] : []) },
    { n: 4, cands: (a) => a.suited(4, (c) => fitsWindow(c.map((i) => a.r[i]))) },
    { n: 5, cands: (a) => (a.groups(2).length === 2 ? [[...a.byRank[a.groups(2)[0]], ...a.byRank[a.groups(2)[1]]].sort()] : []) },
    { n: 6, cands: (a) => a.groups(2).filter((k) => k >= 11).map((k) => a.byRank[k]) },
    { n: 7, cands: (a) => a.suited(3, (c) => c.every((i) => a.r[i] >= 10)) },
    { n: 8, cands: (a) => a.suited(4) },
    { n: 9, cands: (a) => a.groups(2).filter((k) => k <= 10).map((k) => a.byRank[k]) },
    {
      n: 10,
      cands: (a) => combos(a.all, 4).filter((c) => {
        const rs = c.map((i) => a.r[i]).sort((x, y) => x - y);
        return new Set(rs).size === 4 && rs[3] - rs[0] === 3 && rs[0] >= 2 && rs[3] <= 13;
      }),
    },
    {
      n: 11,
      cands: (a) => a.suited(2, (c) => c.every((i) => a.r[i] >= 11)),
      // 多組時留「最高張較低」的一組（例：J♠Q♠ 優先於 A♥K♥），成順機會較多
      pick: (cs, a) => cs.slice().sort((x, y) => Math.max(...x.map((i) => a.r[i])) - Math.max(...y.map((i) => a.r[i])) || sumR(a, x) - sumR(a, y))[0],
    },
    {
      n: 12,
      cands: (a) => a.suited(3, (c) => fitsWindow(c.map((i) => a.r[i]))),
      pick: (cs, a) => cs.slice().sort((x, y) => hiCount(a, y) - hiCount(a, x) || sumR(a, y) - sumR(a, x))[0],
    },
    {
      n: 13,
      cands: (a) => (a.highs.length >= 2 ? combos(a.highs, 2) : []),
      pick: (cs, a) => a.highs.slice().sort((x, y) => a.r[x] - a.r[y]).slice(0, 2).sort(),
    },
    { n: 14, cands: (a) => a.highs.map((i) => [i]) },
    { n: 15, cands: () => [[]] },
  ];

  const ruleInfo = (n) => ({ n, rule: RULE_TEXT[n].zh, short: RULE_TEXT[n].short, en: RULE_TEXT[n].en, why: RULE_TEXT[n].why });

  /**
   * 15 條持牌策略：由上往下第一條符合的規則。
   * @param {Array} cards 5 張牌
   * @returns {{hold:number[], rule:string, n:number, short:string, en:string, why:string}} hold = 要留的 index（遞增）
   */
  function suggestHold(cards) {
    const a = analyze(cards);
    for (const R of RULES) {
      const cs = R.cands(a);
      if (!cs.length) continue;
      const hold = (R.pick ? R.pick(cs, a) : cs[0]).slice().sort((x, y) => x - y);
      return { hold, ...ruleInfo(R.n) };
    }
    return { hold: [], ...ruleInfo(15) };
  }

  /**
   * 把玩家的留法對應到策略表：回傳第一條「候選留法包含這個留法」的規則；不在表上 → null。
   * @returns {{n, rule, short, en, why}|null}
   */
  function classifyHold(cards, hold) {
    const a = analyze(cards);
    const key = hold.slice().sort((x, y) => x - y).join(',');
    for (const R of RULES) {
      if (R.cands(a).some((c) => c.slice().sort((x, y) => x - y).join(',') === key)) return ruleInfo(R.n);
    }
    return null;
  }

  /**
   * 精確期望值：留 hold、其餘從剩下 47 張換，平均每押 1 枚拿回幾枚（依 coins 的賠付表）。
   * 換牌張數 > maxDraw 時回傳 null（5 張全換 153 萬種組合，UI 不算）。
   */
  function evHold(cards, hold, { coins = MAX_COINS, maxDraw = 4 } = {}) {
    const k = 5 - hold.length;
    if (k > maxDraw) return null;
    const dealt = new Set(cards.map((c) => c.id));
    const deck = LG.cards.newDeck().filter((c) => !dealt.has(c.id));
    const hand = hold.map((i) => cards[i]);
    const base = hand.length;
    const pays = {};
    PAYTABLE.forEach((p) => { pays[p.key] = perCoin(p.key, coins); });
    let total = 0, n = 0;
    const rec = (start, d) => {
      if (d === k) {
        const key = handKeyFromScore(LG.poker.score(hand));
        if (key) total += pays[key];
        n++;
        return;
      }
      for (let i = start; i < deck.length; i++) { hand[base + d] = deck[i]; rec(i + 1, d + 1); }
    };
    rec(0, 0);
    return total / n;
  }

  /** 教學／提示用：留法文字「A K Q J」 */
  const holdText = (cards, hold) => (hold.length ? hold.map((i) => rankTxt(cards[i])).join(' ') : '（不留）');
  const holdCardsText = (cards, hold) => (hold.length ? hold.map((i) => cardTxt(cards[i])).join(' ') : '不留任何牌');
  const hintText = (cards) => {
    const s = suggestHold(cards);
    return s.hold.length ? `建議留 ${holdText(cards, s.hold)}（${s.short}）` : `建議全部換掉（${s.short}）`;
  };

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'video-poker',
    category: 'slots',
    order: 5,
    name: { zh: '視訊撲克', en: 'Video Poker (Jacks or Better)' },
    summary: '發 5 張、選 HOLD、換一次。押滿 5 枚照策略打，回報率 99.54%。',
    houseEdge: [
      { bet: { zh: 'Jacks or Better 9/6 最佳策略', en: '9/6 optimal strategy' }, edge: 0.46, best: true },
    ],
    limits: { real: { min: 0.2, max: 25 }, practice: { min: 0.2, max: 25 } },
    countdown: 0,              // 視訊撲克不倒數（玩家自己按 DEAL）：核心進場 modal 顯示「不倒數」
    startHint: '自己按 DEAL 發牌',
    limitsLabel: (l) => `每手 ${LG.money.fmt(l.min, { cents: true })} – ${LG.money.fmt(l.max, { cents: true })}（每枚 RM 0.20–5 × 1–5 枚）`,
    logic: { PAYTABLE, COIN_VALUES, MAX_COINS, perCoin, coinsWon, handKey, handKeyFromScore, payout, suggestHold, classifyHold, evHold, hintText, RULE_TEXT },

    create(ctx) {
      const isT = ctx.isTutorial;
      const state = {
        phase: 'idle',           // idle | dealing | hold | drawing
        coins: MAX_COINS, coinValue: 1,
        cards: [], dealt: [], held: [false, false, false, false, false],
        deck: [], pos: 5, stack: null,
        bet: 0, betCoins: 0, betValue: 0, staked: 0,
        last: null, demoHand: false, busy: false,
        deals: 0, draws: 0, rounds: 0,
        ready: !ctx.isReal,
      };
      let root, machine, ptable, slots = [], statusEl, meters = {}, hintEl, denomBtns = [], bar, resultH = null;

      // ---- DOM
      function buildPaytable() {
        const head = el('tr', [el('th.vp-pt__name', { html: term(T.hand.zh, T.hand.en) }),
          ...[1, 2, 3, 4, 5].map((c) => el('th', { class: ['vp-pt__c', `vp-col-${c}`], dataset: { col: c }, text: String(c) }))]);
        const rows = PAYTABLE.map((p) => el('tr', { dataset: { hand: p.key } }, [
          el('td.vp-pt__name', { html: `<span class="vp-pt__zh">${p.zh}</span><span class="vp-pt__en">${p.en.toUpperCase()}</span>` }),
          ...[1, 2, 3, 4, 5].map((c) => el('td', { class: ['vp-pt__c', `vp-col-${c}`, p.key === 'royal' && c === 5 && 'vp-pt__jackpot'], dataset: { col: c }, text: String(coinsWon(p.key, c)) })),
        ]));
        return el('table.vp-paytable', { 'aria-label': '賠付表 Pay table' }, [
          el('caption', { html: `賠付表 <i class="en">Pay Table</i>（贏幾枚，依押注枚數）` }),
          el('thead', [head]), el('tbody', rows),
        ]);
      }

      function buildTable() {
        ptable = buildPaytable();
        const cardsRow = el('div.vp-cards');
        slots = [0, 1, 2, 3, 4].map((i) => {
          const heldTag = el('span.vp-held', { text: T.held });
          const btn = el('button', { type: 'button', class: 'vp-slot', dataset: { slot: i }, 'aria-pressed': 'false', 'aria-label': `第 ${i + 1} 張牌：點一下切換 HOLD` }, [heldTag, ui.card(null, { faceDown: true })]);
          btn.addEventListener('click', () => toggleHold(i));
          cardsRow.appendChild(btn);
          return btn;
        });
        statusEl = el('div.vp-status', { 'aria-live': 'polite' });
        const meter = (k, lbl) => el('div', { class: ['vp-meter', `vp-meter--${k}`] }, [
          el('span.vp-meter__k', { html: `${lbl.en} <i class="en">${lbl.zh}</i>` }), meters[k] = el('b.vp-meter__v'),
        ]);
        machine = el('div.lg-table.vp-machine', [
          el('div.vp-title', { html: `<b>${T.title}</b> <span>${T.sub}</span>` }),
          ptable, cardsRow, statusEl,
          el('div.vp-meters', [meter('credit', T.credit), meter('bet', T.bet), meter('win', T.win)]),
        ]);
        hintEl = el('div.lg-hint.vp-hint', { hidden: true, 'aria-live': 'polite' });
        const denoms = el('div.vp-denoms', { role: 'group', 'aria-label': '每枚金額 Coin value' }, [
          el('span.vp-denoms__k', { html: term(T.coinValue.zh, T.coinValue.en) }),
          ...(denomBtns = COIN_VALUES.map((v) => {
            const b = el('button', { type: 'button', class: 'vp-coin', dataset: { coin: String(v) }, text: fmt(v, { cents: v < 1 }) });
            b.addEventListener('click', () => setCoinValue(v));
            return b;
          })),
        ]);
        const actions = el('div.vp-actions');
        bar = ui.actionBar(actions, [
          { id: 'bet-one', label: T.btn.betOne.label, en: T.btn.betOne.en, onClick: betOne },
          { id: 'max-bet', label: T.btn.maxBet.label, en: T.btn.maxBet.en, onClick: maxBet },
          { id: 'deal', label: T.btn.deal.label, en: T.btn.deal.en, primary: true, onClick: () => deal() },
          { id: 'draw', label: T.btn.draw.label, en: T.btn.draw.en, primary: true, hidden: true, onClick: () => draw() },
        ]);
        root.append(machine, hintEl, denoms, actions);
      }

      function slotCard(i) { return slots[i].querySelector('.lg-card'); }
      function setSlotCard(i, card, faceDown) {
        const old = slotCard(i);
        const c = ui.card(card, { faceDown, size: 'lg' });
        slots[i].replaceChild(c, old);
        return c;
      }

      // ---- 繪製
      function paint() {
        const idle = state.phase === 'idle';
        const hold = state.phase === 'hold';
        // 賠付表：目前枚數欄高亮、中獎列亮
        const col = hold || state.phase === 'drawing' ? state.betCoins : state.coins;
        ptable.querySelectorAll('[data-col]').forEach((c) => c.classList.toggle('is-col', Number(c.dataset.col) === col));
        const winKey = hold ? (state.cards.length === 5 ? handKey(state.cards) : null) : (idle && state.last ? state.last.key : null);
        ptable.querySelectorAll('tr[data-hand]').forEach((r) => r.classList.toggle('is-win', r.dataset.hand === winKey));
        // 牌與 HOLD
        slots.forEach((s, i) => {
          const on = !!state.held[i] && (hold || state.phase === 'drawing');
          s.classList.toggle('is-held', on);
          s.setAttribute('aria-pressed', on ? 'true' : 'false');
          s.disabled = !hold;
          const c = slotCard(i);
          if (c) c.classList.toggle('is-held', on);
        });
        // 表頭
        const bal = ctx.bank.balance();
        meters.credit.textContent = fmt(bal, { cents: Math.round(bal * 100) % 100 !== 0 });
        const coins = hold || state.phase === 'drawing' ? state.betCoins : state.coins;
        const val = hold || state.phase === 'drawing' ? state.betValue : state.coinValue;
        meters.bet.textContent = `${coins} × ${fmt(val, { cents: val < 1 })}`;
        meters.bet.dataset.coins = String(coins);
        const w = idle && state.last ? state.last.win : 0;
        meters.win.textContent = fmt(w, { cents: Math.round(w * 100) % 100 !== 0 });
        // 狀態列
        if (hold) statusEl.textContent = state.demoHand ? T.status.demo : T.status.hold;
        else if (idle && state.last) statusEl.innerHTML = state.last.key ? `${PT[state.last.key].zh} <i class="en">${PT[state.last.key].en}</i> — WIN ${state.last.coinsWon} 枚` : T.status.lose;
        else if (idle) statusEl.textContent = T.status.start;
        // 按鈕
        const lock = !idle || state.busy;
        bar.set('bet-one', { disabled: lock });
        bar.set('max-bet', { disabled: lock });
        bar.set('deal', { hidden: hold || state.phase === 'drawing', disabled: lock });
        bar.set('draw', { hidden: !(hold || state.phase === 'drawing'), disabled: !hold || state.busy || state.demoHand });
        denomBtns.forEach((b) => {
          b.disabled = lock;
          b.classList.toggle('is-active', Number(b.dataset.coin) === state.coinValue);
          b.setAttribute('aria-pressed', Number(b.dataset.coin) === state.coinValue ? 'true' : 'false');
        });
        paintHints();
      }

      function paintHints() {
        const on = ctx.hints;
        let txt = '';
        let sugg = null;
        if (on && state.phase === 'hold' && state.cards.length === 5) {
          sugg = suggestHold(state.cards);
          txt = '提示：' + hintText(state.cards);
        } else if (on && state.phase === 'idle' && state.coins < MAX_COINS) txt = T.hintIdle;
        hintEl.hidden = !txt;
        hintEl.textContent = txt;
        slots.forEach((s, i) => s.classList.toggle('is-suggest', !!sugg && sugg.hold.includes(i)));
      }

      // ---- 操作
      function setCoinValue(v) {
        if (state.phase !== 'idle' || state.busy) return;
        state.coinValue = v;
        paint();
      }
      function betOne() {
        if (state.phase !== 'idle' || state.busy) return;
        state.coins = state.coins >= MAX_COINS ? 1 : state.coins + 1;
        paint();
      }
      function maxBet() {
        if (state.phase !== 'idle' || state.busy) return;
        state.coins = MAX_COINS;
        paint();
        deal();
      }
      function toggleHold(i) {
        if (state.phase !== 'hold' || state.busy) return;
        state.held[i] = !state.held[i];
        paint();
      }

      function newDeck() {
        const deck = LG.rng.shuffle(LG.cards.newDeck());
        if (!state.stack) return deck;
        const front = LG.cards.parseMany(state.stack);
        state.stack = null;
        const ids = new Set(front.map((c) => c.id));
        return front.concat(deck.filter((c) => !ids.has(c.id)));
      }

      function closeResult() { if (resultH) { resultH.close(); resultH = null; } }

      async function deal() {
        if (state.busy || state.phase !== 'idle' || !ctx.alive()) return;
        if (!state.ready) return;
        const bet = round2(state.coins * state.coinValue);
        if (!isT && !ctx.bank.canAfford(bet)) {
          toast(T.noAfford(fmt(bet, { cents: bet < 1 })), { type: 'warn' });
          ctx.checkBroke();
          return;
        }
        closeResult();
        if (!isT) ctx.bank.debit(bet);            // 按 DEAL = 投注離手
        state.staked = isT ? 0 : bet;
        state.bet = bet; state.betCoins = state.coins; state.betValue = state.coinValue;
        state.deck = newDeck();
        state.cards = state.deck.slice(0, 5);
        state.dealt = state.cards.slice();
        state.pos = 5;
        state.held = [false, false, false, false, false];
        state.last = null; state.demoHand = false;
        state.phase = 'dealing'; state.busy = true;
        ctx.dealer.say('發牌', 'Dealing');
        state.cards.forEach((c, i) => setSlotCard(i, c, true));
        paint();
        for (let i = 0; i < 5; i++) {
          await ctx.wait(70);
          if (!ctx.alive()) return;
          ui.flip(slotCard(i), state.cards[i]);
        }
        await ctx.wait(160);
        if (!ctx.alive()) return;
        state.busy = false; state.phase = 'hold'; state.deals += 1;
        paint();
      }

      async function draw() {
        if (state.busy || state.phase !== 'hold' || state.demoHand || !ctx.alive()) return;
        state.busy = true; state.phase = 'drawing';
        const holdIdx = [0, 1, 2, 3, 4].filter((i) => state.held[i]);
        paint();
        const swaps = [];
        for (let i = 0; i < 5; i++) {
          if (state.held[i]) continue;
          state.cards[i] = state.deck[state.pos++];
          swaps.push(i);
          setSlotCard(i, state.cards[i], true);
        }
        for (const i of swaps) {
          await ctx.wait(70);
          if (!ctx.alive()) return;
          ui.flip(slotCard(i), state.cards[i]);
        }
        await ctx.wait(160);
        if (!ctx.alive()) return;
        settle(holdIdx);
      }

      function settle(holdIdx) {
        const p = payout(state.cards, state.betCoins);
        const win = round2(p.coinsWon * state.betValue);
        if (!isT && win > 0) ctx.bank.credit(win);  // 拿回（押注已在 DEAL 扣掉）
        const net = round2(win - state.bet);
        state.staked = 0;
        state.last = { key: p.key, coinsWon: p.coinsWon, win, net };
        state.draws += 1; state.rounds += 1;
        state.phase = 'idle'; state.busy = false;
        slots.forEach((s, i) => { const c = slotCard(i); if (c) c.classList.toggle('is-win', !!p.key); });
        if (p.key) ctx.dealer.say('派彩', 'Paying out');
        ctx.recordRound({ wagered: state.bet, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' });
        resultH = ctx.explain(explainRound(p, holdIdx, win, net)) || null;
        paint();
        ctx.checkBroke();
      }

      // ---- 練習結果面板：牌型 / 結果 / 賠付計算式 / 為什麼（你留的 vs 建議留的）
      function explainRound(p, holdIdx, win, net) {
        const dealt = state.dealt, coins = state.betCoins, val = state.betValue;
        const v = (x) => fmt(x, { cents: Math.round(x * 100) % 100 !== 0 });
        const hand = `發牌 ${dealt.map(cardTxt).join(' ')}<br>換牌後 <b>${state.cards.map(cardTxt).join(' ')}</b><br>${p.desc}`;
        const result = p.key
          ? `${PT[p.key].zh} <i class="en">${PT[p.key].en}</i> — 贏 ${p.coinsWon} 枚`
          : `未中獎 <i class="en">No win</i>（最低要 J 以上一對）`;
        let formula = `押注 ${coins} 枚 × ${v(val)} = ${v(state.bet)}${isT ? T.tutorFree : ''}<br>`;
        if (p.key) {
          formula += p.key === 'royal' && coins === MAX_COINS
            ? `皇家 5 枚 = 4000 枚 × ${v(val)} = ${v(win)}（拿回）`
            : `每枚 ${p.perCoin} × ${coins} 枚 = ${p.coinsWon} 枚 × ${v(val)} = ${v(win)}（拿回）`;
          formula += `<br>淨 <b>${fmtSigned(net)}</b>${net === 0 ? '（只是回本）' : ''}`;
        } else formula += `未中獎 → 淨 <b>${fmtSigned(net)}</b>`;
        const why = whyText(dealt, holdIdx) + (coins < MAX_COINS ? `<br>另外：只押 ${coins} 枚時皇家每枚只賠 250（5 枚是 800），長期回報率少約 1.3%。` : '');
        return { hand, result, formula, why, net };
      }

      function whyText(dealt, holdIdx) {
        const s = suggestHold(dealt);
        const mine = classifyHold(dealt, holdIdx);
        const same = s.hold.join(',') === holdIdx.join(',');
        const mineTxt = holdCardsText(dealt, holdIdx);
        const sugTxt = holdCardsText(dealt, s.hold);
        if (same) return `你留 ${mineTxt}，和策略表一樣 ✓（第 ${s.n} 條 ${s.rule}）。${s.why}`;
        let out = `你留 ${mineTxt}${mine ? `（第 ${mine.n} 條 ${mine.short}）` : '（不在策略表上的留法）'}；`
          + `建議留 <b>${sugTxt}</b>（第 ${s.n} 條 ${s.rule}）。`;
        if (mine && mine.n === s.n) out += '同一條規則，但策略表指定留這幾張。';
        else if (mine && mine.n > s.n) out += `策略表由上往下，第 ${s.n} 條比第 ${mine.n} 條優先。`;
        out += s.why;
        // 兩種留法都 ≤ 4 張換牌時算精確期望值（每押 1 枚拿回幾枚，5 枚賠付表）
        if (!isT && 5 - holdIdx.length <= 4 && 5 - s.hold.length <= 4) {
          const a = evHold(dealt, holdIdx), b = evHold(dealt, s.hold);
          if (a !== null && b !== null) {
            out += `<br>期望回收（每押 1 枚）：你 ${a.toFixed(3)} 枚 vs 建議 ${b.toFixed(3)} 枚。`;
            if (a > b + 1e-9) out += '這手你的留法其實略好——簡化策略表偶有例外。';
            else if (Math.abs(a - b) <= 1e-9) out += '兩種留法期望值相同。';
          }
        }
        return out;
      }

      // ---- 教學示範
      /** 教學：把牌區捲到畫面中間（底部教學工作表會蓋住下半部） */
      const focusCards = () => { if (isT) ctx.later(() => { try { slots[0].parentNode.scrollIntoView({ block: 'center' }); } catch { /* */ } }, 60); };
      const demo = {
        /** 回到待機：coins/coinValue 可指定；stack = 下一手的牌（5 張發牌 + 換牌依序） */
        idle({ coins, coinValue, stack } = {}) {
          closeResult();
          state.phase = 'idle'; state.busy = false; state.demoHand = false; state.last = null;
          if (coins) state.coins = coins;
          if (coinValue) state.coinValue = coinValue;
          state.stack = stack || null;
          state.cards = []; state.held = [false, false, false, false, false];
          for (let i = 0; i < 5; i++) setSlotCard(i, null, true);
          paint();
        },
        /** 擺出一手示範牌（hold 階段；DRAW 停用）；final=true → 當成結算畫面（點亮中獎列） */
        showHand(ids, { held = [], coins = MAX_COINS, final = false } = {}) {
          closeResult();
          const cards = LG.cards.parseMany(ids);
          state.cards = cards.slice(); state.dealt = cards.slice();
          state.held = [0, 1, 2, 3, 4].map((i) => held.includes(i));
          state.coins = coins; state.betCoins = coins; state.betValue = state.coinValue;
          state.busy = false;
          cards.forEach((c, i) => { const e = setSlotCard(i, c, false); e.classList.toggle('is-win', final && !!handKey(cards)); });
          if (final) {
            const p = payout(cards, coins);
            state.phase = 'idle'; state.demoHand = false;
            state.last = { key: p.key, coinsWon: p.coinsWon, win: round2(p.coinsWon * state.coinValue), net: 0 };
          } else { state.phase = 'hold'; state.demoHand = true; state.last = null; }
          paint();
          focusCards();
        },
        /** 教學流程示範：發一手固定牌（J♥ J♦ 7♣ 4♠ 9♠，換牌 J♣ 2♥ 5♦） */
        dealFixed(holdJacks) {
          this.idle({ coins: MAX_COINS, coinValue: 1, stack: FLOW_HAND });
          state.busy = false;
          // 同步版發牌（不跑動畫）：setup 需要立即就緒
          state.deck = newDeck();
          state.cards = state.deck.slice(0, 5); state.dealt = state.cards.slice(); state.pos = 5;
          state.bet = round2(MAX_COINS * state.coinValue); state.betCoins = MAX_COINS; state.betValue = state.coinValue; state.staked = 0;
          state.held = [0, 1, 2, 3, 4].map((i) => !!holdJacks && i < 2);
          state.cards.forEach((c, i) => setSlotCard(i, c, false));
          state.phase = 'hold'; state.demoHand = false; state.deals += 1;
          paint();
          focusCards();
        },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
      };
      const FLOW_HAND = 'JH JD 7C 4S 9S JC 2H 5D';
      const heldIdx = () => [0, 1, 2, 3, 4].filter((i) => state.held[i]);
      const sameSet = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);
      const quiz = () => (inst) => {
        const want = suggestHold(inst.state.cards).hold;
        const got = heldIdx();
        if (sameSet(got, want)) return true;
        if (!got.length) return '點牌選出你要留的牌（HELD 會亮）';
        return `目前留 ${holdCardsText(inst.state.cards, got)}——再想想：策略表由上往下找第一條符合的。`;
      };

      // ---- 教學步驟（layout 5、flow 5、payout 3、strategy 7；action 8 個）
      function tutorialSteps() {
        const li = (r) => `<li>${r.zh}</li>`;
        const rulesA = RULE_TEXT.slice(1, 8).map(li).join('');     // 1–7：已成牌與強聽牌
        const rulesB = RULE_TEXT.slice(8).map(li).join('');        // 8–15：弱聽牌與高牌
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：機台畫面',
            body: '<p>上面是<b>賠付表 <i class="en">Pay table</i></b>，中間 5 張牌，下面是按鈕。視訊撲克沒有荷官，你只跟賠付表對賭。</p>',
            highlight: ['.vp-machine'], setup: () => demo.idle({ coins: MAX_COINS, coinValue: 1 }) },
          { id: 'layout-paytable', section: 'layout', title: '賠付表怎麼讀',
            body: '<p>左邊是牌型，右邊 1–5 欄是「押幾枚、贏幾枚」。最低中獎是 <b>J 以上一對 <i class="en">Jacks or Better</i></b>。金色欄 = 你目前押的枚數。</p>',
            highlight: ['.vp-paytable'] },
          { id: 'layout-royal', section: 'layout', title: '5 枚欄：皇家 4000',
            body: '<p>皇家同花順 <i class="en">Royal Flush</i>：1–4 枚每枚 250（4 枚 = 1000），<b>第 5 枚直接跳到 4000</b>（每枚 800）。其他牌型都是照比例。</p>',
            highlight: ['.vp-paytable tr[data-hand="royal"]'] },
          { id: 'layout-coins', section: 'layout', title: '枚數與每枚金額',
            body: '<p><b>BET ONE</b> 每按一次加 1 枚（到 5 再按回 1）；<b>MAX BET</b> 押滿 5 枚並直接發牌。每枚金額 RM 0.20–5 在下方選。</p>',
            highlight: ['[data-action="bet-one"]', '.vp-denoms'],
            setup: () => demo.idle({ coins: 1, coinValue: 1 }),
            action: { label: '按 BET ONE 把押注調到 3 枚', check: (inst) => inst.state.coins === 3 || `目前 ${inst.state.coins} 枚` } },
          { id: 'layout-hold', section: 'layout', title: '持牌 HOLD 標籤',
            body: '<p>發牌後<b>點牌</b>就會出現 <b>HELD</b>（留）標籤，再點一次取消。沒留的牌，按 DRAW 會換掉。</p>',
            highlight: ['.vp-cards'],
            setup: () => demo.showHand('AS KS QS JS 2D'),
            action: { label: '點任一張牌，讓 HELD 亮起', check: (inst) => inst.state.held.some(Boolean) || '點一下任一張牌' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一手怎麼玩',
            body: '<p><b>DEAL</b> 發 5 張 → 點牌選 <b>HOLD</b> → <b>DRAW</b> 換掉沒留的 → 依賠付表派彩。每手只能換一次。</p>',
            highlight: ['.vp-actions'], setup: () => demo.idle({ coins: MAX_COINS, coinValue: 1, stack: FLOW_HAND }) },
          { id: 'flow-deal', section: 'flow', title: `發牌 <i class="en">DEAL</i>`,
            body: '<p>按 DEAL 時押注就離手（真實模式會從餘額扣 枚數 × 每枚）。教學模式不扣款。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => { if (inst.state.phase !== 'hold' || inst.state.demoHand) demo.idle({ coins: MAX_COINS, coinValue: 1, stack: FLOW_HAND }); },
            action: { label: '按 DEAL 發牌', check: (inst) => (inst.state.phase === 'hold' && !inst.state.demoHand) || '按下方的「發牌 DEAL」' } },
          { id: 'flow-hold', section: 'flow', title: '選 HOLD',
            body: '<p>你拿到一對 J（J 以上一對，已經保本）。把兩張 J 留下，其他三張換掉。</p>',
            highlight: ['.vp-cards'],
            setup: (inst) => { if (inst.state.phase !== 'hold' || inst.state.demoHand) demo.dealFixed(false); },
            action: { label: '點 J♥ 和 J♦（只留這兩張）', check: (inst) => {
              const c = inst.state.cards, h = heldIdx();
              return (h.length === 2 && h.every((i) => c[i].rank === 'J')) || '只留兩張 J，其他不要 HELD';
            } } },
          { id: 'flow-draw', section: 'flow', title: `換牌 <i class="en">DRAW</i>`,
            body: '<p>按 DRAW，沒留的 3 張會換成新牌，然後依賠付表派彩。</p>',
            highlight: ['[data-action="draw"]'],
            setup: (inst) => { if (inst.state.phase !== 'hold' || inst.state.demoHand) demo.dealFixed(true); inst.state.drawMark = inst.state.draws; },
            action: { label: '按 DRAW 換牌', check: (inst) => inst.state.draws > (inst.state.drawMark ?? 0) || '按下方的「換牌 DRAW」' } },
          { id: 'flow-cashout', section: 'flow', title: '派彩、Double up 與兌現',
            body: '<p>贏的錢直接加到 CREDIT。有些機台會問要不要 <b>Double up</b>（猜大小加倍）——那只增加波動、不增加期望值，本機不做。離開時按 <b>CASH OUT</b> 印票 <i class="en">TITO</i>。</p>',
            highlight: ['.vp-meters'] },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼算錢',
            body: '<p>公式：<b>贏的枚數 × 每枚金額</b>。賠付表上的數字已經是「拿回」的枚數（含押注），不是淨贏。</p>',
            highlight: ['.vp-paytable'] },
          { id: 'payout-jacks', section: 'payout', title: '一對 J：5 枚回 5 枚',
            body: '<p>押 5 枚 × RM 1 = RM 5，拿到一對 J：<br><b>每枚 1 × 5 枚 = 5 枚 × RM 1 = RM 5</b>（拿回）<br>淨贏 RM 0——只是回本。</p>',
            highlight: ['.vp-paytable tr[data-hand="jacks"]', '.vp-cards'],
            setup: () => { demo.idle({ coins: MAX_COINS, coinValue: 1 }); demo.showHand('JS JD 8C 4H 2S', { final: true }); } },
          { id: 'payout-royal', section: 'payout', title: '皇家：4 枚 vs 5 枚',
            body: '<p>每枚 RM 1：4 枚中皇家 = <b>250 × 4 = 1000 枚 = RM 1,000</b>；5 枚中皇家 = <b>4000 枚 = RM 4,000</b>。多押 RM 1，皇家多拿 RM 3,000。</p>',
            highlight: ['.vp-paytable tr[data-hand="royal"]'],
            setup: () => { demo.idle({ coins: MAX_COINS, coinValue: 1 }); demo.showHand('TH JH QH KH AH', { final: true }); } },
          // ===== strategy
          { id: 'strategy-intro', section: 'strategy', title: '這段你會學到：怎麼打才划算',
            body: '<table class="lg-datatable"><tr><th>打法</th><th>回報率 RTP</th><th>莊家優勢</th></tr><tr><td>9/6 最佳策略</td><td>99.54%</td><td>0.46%</td></tr><tr><td>本機 15 條簡化策略</td><td>≈ 99.4%</td><td>≈ 0.6%</td></tr><tr><td>憑感覺亂留</td><td>≈ 95–97%</td><td>3–5%</td></tr></table>',
            highlight: null, setup: () => demo.idle({ coins: MAX_COINS, coinValue: 1 }) },
          { id: 'strategy-max', section: 'strategy', title: '該押：永遠押 5 枚',
            body: '<p>皇家 5 枚每枚 800、少一枚只剩 250。<b>少押 1 枚，長期回報約少 1.3%。</b>預算不夠就把每枚調到 RM 0.20，也要押滿 5 枚。</p>',
            highlight: ['[data-action="max-bet"]', '.vp-paytable .vp-col-5'] },
          { id: 'strategy-96', section: 'strategy', title: '別玩：8/5 以下的機台',
            body: '<p>看<b>葫蘆</b>和<b>同花</b>每枚賠多少：9/6 = 99.54%；8/5 = 97.30%；7/5 = 96.15%；6/5 = 95.00%。坐下前先看這兩列，不是 9/6 就換一台。</p>',
            highlight: ['.vp-paytable tr[data-hand="fh"]', '.vp-paytable tr[data-hand="flush"]'] },
          { id: 'strategy-table', section: 'strategy', title: '持牌策略表 15 條（1–7）',
            body: `<p>由上往下，第一條符合就照做：</p><ol class="vp-rules">${rulesA}</ol>`,
            highlight: null },
          { id: 'strategy-table-2', section: 'strategy', title: '持牌策略表 15 條（8–15）',
            body: `<p>前 7 條都不符合，再往下看：</p><ol class="vp-rules" start="8">${rulesB}</ol>`,
            highlight: null },
          { id: 'strategy-q1', section: 'strategy', title: '互動題 1：拆不拆對子？',
            body: '<p>10♠ J♠ Q♠ K♠ K♦——你有一對 K，也有四張同花色的皇家牌。你會留哪幾張？</p>',
            highlight: ['.vp-cards'], setup: () => demo.showHand('TS JS QS KS KD'),
            action: { label: '點牌選出策略表建議的留法', check: quiz() } },
          { id: 'strategy-q2', section: 'strategy', title: '互動題 2：小對子 vs 高牌',
            body: '<p>8♥ 8♣ K♦ Q♠ 3♥——一對 8（不賠），還有 K、Q 兩張高牌。留什麼？</p>',
            highlight: ['.vp-cards'], setup: () => demo.showHand('8H 8C KD QS 3H'),
            action: { label: '點牌選出策略表建議的留法', check: quiz() } },
          { id: 'strategy-q3', section: 'strategy', title: '互動題 3：同花聽 vs 小對子',
            body: '<p>4♥ 7♥ 9♥ Q♥ 4♣——四張紅心，也有一對 4。留什麼？</p>',
            highlight: ['.vp-cards'], setup: () => demo.showHand('4H 7H 9H QH 4C'),
            action: { label: '點牌選出策略表建議的留法', check: quiz() } },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。每手牌都是新洗的一副牌——機台不會「快出皇家」，也不會「剛出過就不出」。</p>',
            highlight: ['.vp-meter--credit'] },
        ];
      }

      // ---- instance
      return {
        state, demo,
        mount(el0) {
          root = el0;
          buildTable();
          paint();
          ctx.on('hints:change', paintHints);
          ctx.on('bank:change', paint);
          if (ctx.isPractice) {
            const rows = [['#', '持牌策略（由上往下）']].concat(RULE_TEXT.slice(1).map((r, i) => [String(i + 1), `${r.zh} <i class="en">${r.en}</i>`]));
            ctx.strategyPanel(ui.table(rows, { caption: '押滿 5 枚；第一條符合就照做' }));
          }
          if (ctx.isReal) {
            ctx.ready.then(() => { state.ready = true; });
          }
          root.dataset.ready = '1';
        },
        unmount() {
          // 局中離開：依平台約定退回已扣的押注
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          closeResult();
        },
        tutorialSteps,
      };
    },
  });
})();
