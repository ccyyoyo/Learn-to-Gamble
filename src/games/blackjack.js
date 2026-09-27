// ============================================================================
// 21 點 Blackjack（id: blackjack）— 規格 docs/05-game-rules/blackjack.md
//
// 規則：6 副牌靴（剩約 1 副重洗）、莊家軟 17 停（S17）、莊明牌 A/10 先偷看暗牌（peek）、
//       BJ 賠 3:2、任兩張可加倍、分牌後可加倍（DAS）、最多分成 4 手、分 A 每手只拿一張、
//       保險（莊明牌 A）押主注一半賠 2:1、無投降。
//
// 結構：
//   1. 文案 T、規則常數
//   2. 純邏輯（Node 可測）：Round 引擎、advise() 建議/查表文字、settle 算式、simulate() Monte Carlo
//   3. registerGame + create(ctx)：桌面（半圓桌 5 座位）、一局流程、練習提示、真實模式計時、教學 32 步
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;
  const BJ = LG.blackjack;

  // ---------------------------------------------------------------- 規則常數
  const DECKS = 6;
  const CUT_CARD = 52;            // 剩約 1 副時重洗
  const MAX_HANDS = 4;            // 最多分 3 次（4 手）
  const BJ_PAYS = 1.5;            // 3:2
  const INS_PAYS = 2;             // 2:1
  const ACTION_SECONDS = 20;      // 真實模式：每手 20 秒無操作 = 停牌
  const INSURANCE_SECONDS = 5;    // 真實模式：保險詢問 5 秒
  const DEAL_MS = 320;
  const SPOT = (i) => (i === 0 ? 'main' : `main-${i + 1}`);
  const DEALER_LABEL = ['2', '3', '4', '5', '6', '7', '8', '9', '10', 'A'];

  // ---------------------------------------------------------------- 文案
  const T = {
    print1: 'BLACKJACK PAYS 3 TO 2',
    print2: 'DEALER STANDS ON SOFT 17',
    printZh: '21 點賠 3:2 · 莊家軟 17 停牌',
    insArc: 'INSURANCE PAYS 2 TO 1',
    main: { zh: '主注', en: 'Bet', odds: '1:1 · BJ 3:2' },
    insurance: { zh: '保險', en: 'Insurance', odds: '2:1' },
    dealer: { zh: '莊家', en: 'Dealer' },
    shoe: { zh: '牌靴', en: 'Shoe' },
    discard: { zh: '棄牌', en: 'Discard' },
    you: '座位 3 · 你 <i class="en">YOU</i>',
    seatBase: { 1: '第一壘', 5: '第三壘' },
    act: {
      H: { id: 'hit', zh: '加牌', en: 'Hit', gesture: '指尖敲桌' },
      S: { id: 'stand', zh: '停牌', en: 'Stand', gesture: '手掌橫掃' },
      D: { id: 'double', zh: '加倍', en: 'Double', gesture: '加籌碼在旁，比 1' },
      P: { id: 'split', zh: '分牌', en: 'Split', gesture: '加籌碼在旁，比 2' },
      I: { id: 'insure', zh: '買保險', en: 'Insurance', gesture: '半注放保險線' },
      N: { id: 'no-insure', zh: '不保', en: 'No insurance', gesture: '不動籌碼' },
    },
    table: { hard: '硬牌', soft: '軟牌', pairs: '對子' },
    tableEn: { hard: 'Hard', soft: 'Soft', pairs: 'Pairs' },
    legend: 'H 加牌 · S 停牌 · D 加倍（不能則加牌）· Ds 加倍（不能則停牌）· P 分牌',
    rules: '6 副牌、莊家軟 17 停（S17）、分牌後可加倍（DAS）、無投降',
    adviceIns: '建議：不保 No insurance（保險莊家優勢約 7.4%，基本策略永遠不買）',
    insEdge: '保險的莊家優勢約 7.4%（莊暗牌是 10 點牌只有約 31%）',
    shuffle: '洗牌 <i class="en">Shuffling</i>：切牌出現，6 副牌重新洗好',
    onlyMain: '只能押主注圈；保險要等莊家明牌是 A 時按「買保險」',
    splitSpot: '分牌後才會用到這一格；請押在主注圈',
    demoLock: '教學示範中：按「下一步」繼續',
  };

  // ---------------------------------------------------------------- 純邏輯
  const cv = (c) => BJ.cardValue(c);
  const isTen = (c) => cv(c) === 10;
  const cardText = (c) => LG.cards.label(c);
  const cardsText = (cards) => cards.map(cardText).join(' ');
  const mkHand = (cards, bet, fromSplit) => ({ cards, bet, fromSplit, splitAces: false, doubled: false, done: false });

  /**
   * 一局的狀態機（不碰金流與 DOM）。draw() 由呼叫端提供（牌靴或教學指定牌）。
   * 流程：deal() →（UI 問保險 takeInsurance()）→ start() → hit/stand/double/split … → playDealer() → settle()
   */
  class Round {
    constructor({ bet, draw, maxHands = MAX_HANDS }) {
      this.bet = bet;
      this.draw = draw;
      this.maxHands = maxHands;
      this.hands = [];
      this.dealer = [];
      this.insurance = 0;
      this.phase = 'new';   // new → play → dealer → done
      this.cur = 0;
    }
    /** 發牌順序：玩家、莊明牌、玩家、莊暗牌 */
    deal() {
      const p1 = this.draw(), up = this.draw(), p2 = this.draw(), hole = this.draw();
      this.hands = [mkHand([p1, p2], this.bet, false)];
      this.dealer = [up, hole];
      return this;
    }
    get up() { return this.dealer[0]; }
    /** 莊明牌 A → 詢問保險 */
    get offerInsurance() { return this.up.rank === 'A'; }
    /** 莊明牌 A 或 10 點牌 → 先偷看暗牌 */
    get peeks() { return this.up.rank === 'A' || isTen(this.up); }
    get dealerBJ() { return this.dealer.length === 2 && BJ.value(this.dealer).blackjack; }
    playerBJ() {
      const h = this.hands[0];
      return this.hands.length === 1 && !h.fromSplit && BJ.value(h.cards).blackjack;
    }
    takeInsurance() { this.insurance = round2(this.bet / 2); return this.insurance; }
    /** 發牌（與保險）後判定 → 'dealer-bj' | 'player-bj' | 'play' */
    start() {
      if (this.peeks && this.dealerBJ) { this._finish(); return 'dealer-bj'; }
      if (this.playerBJ()) { this._finish(); return 'player-bj'; }
      this.phase = 'play';
      this.cur = 0;
      this._advance();
      return 'play';
    }
    _finish() { this.hands.forEach((h) => { h.done = true; }); this.phase = 'done'; }
    /** 找下一個要行動的手；分牌後的手在輪到時才補第二張；21 點自動停 */
    _advance() {
      while (this.cur < this.hands.length) {
        const h = this.hands[this.cur];
        if (h.cards.length < 2) h.cards.push(this.draw());
        if (BJ.value(h.cards).total >= 21) h.done = true;
        if (!h.done) return;
        this.cur += 1;
      }
      this.phase = 'dealer';
    }
    get hand() { return this.hands[this.cur]; }
    canAct() { return this.phase === 'play' && !!this.hand && !this.hand.done; }
    canDouble() { const h = this.hand; return this.canAct() && h.cards.length === 2 && !h.splitAces; }
    canSplit() {
      const h = this.hand;
      return this.canAct() && h.cards.length === 2 && cv(h.cards[0]) === cv(h.cards[1]) && this.hands.length < this.maxHands;
    }
    hit() {
      if (!this.canAct()) return false;
      const h = this.hand;
      h.cards.push(this.draw());
      if (BJ.value(h.cards).total >= 21) { h.done = true; this._advance(); }
      return true;
    }
    stand() {
      if (!this.canAct()) return false;
      this.hand.done = true;
      this._advance();
      return true;
    }
    /** 加倍：注金 ×2、只拿一張 */
    double() {
      if (!this.canDouble()) return false;
      const h = this.hand;
      h.bet = round2(h.bet * 2);
      h.doubled = true;
      h.cards.push(this.draw());
      h.done = true;
      this._advance();
      return true;
    }
    /** 分牌：拆成兩手（同額注金）；分 A 兩手各拿一張就結束 */
    split() {
      if (!this.canSplit()) return false;
      const h = this.hand;
      const [a, b] = h.cards;
      const nh = mkHand([b], h.bet, true);
      h.cards = [a];
      h.fromSplit = true;
      this.hands.splice(this.cur + 1, 0, nh);
      if (a.rank === 'A') {
        h.cards.push(this.draw());
        nh.cards.push(this.draw());
        h.splitAces = nh.splitAces = true;
        h.done = nh.done = true;
      } else {
        h.cards.push(this.draw());
      }
      this._advance();
      return true;
    }
    /** 莊家需要補牌嗎？（全部爆牌或玩家 BJ 已結算時不用） */
    needsDealer() {
      if (this.phase === 'done' && (this.dealerBJ || this.playerBJ())) return false;
      return this.hands.some((h) => !BJ.value(h.cards).bust);
    }
    /** 莊家按 S17 補牌 → 回傳新補的牌 */
    playDealer() {
      const before = this.dealer.length;
      if (this.needsDealer()) this.dealer = BJ.dealerPlay(this.dealer, { draw: () => this.draw() }, { s17: true });
      this.phase = 'done';
      return this.dealer.slice(before);
    }
    /**
     * 結算（純數字）。每手 {hand, spot, cards, total, bust, bj, stake, result:'blackjack'|'win'|'push'|'lose', pay(淨), returned(含本金)}
     * @returns {{lines, insurance, dealer:{total,bust,bj}, dealerBJ, wagered, returned, net}}
     */
    settle() {
      const dv = BJ.value(this.dealer);
      const dealerBJ = this.dealerBJ;
      const single = this.hands.length === 1;
      let wagered = 0, returned = 0;
      const lines = this.hands.map((h, i) => {
        const v = BJ.value(h.cards, { fromSplit: h.fromSplit });
        const bj = single && v.blackjack;
        let result;
        if (dealerBJ) result = bj ? 'push' : 'lose';
        else if (bj) result = 'blackjack';
        else if (v.bust) result = 'lose';
        else if (dv.bust) result = 'win';
        else result = v.total > dv.total ? 'win' : v.total < dv.total ? 'lose' : 'push';
        const stake = h.bet;
        const pay = result === 'blackjack' ? round2(stake * BJ_PAYS) : result === 'win' ? stake : result === 'push' ? 0 : -stake;
        const ret = result === 'lose' ? 0 : round2(stake + pay);
        wagered += stake; returned += ret;
        return { hand: i, spot: SPOT(i), cards: h.cards.slice(), total: v.total, soft: v.soft, bust: v.bust, bj, fromSplit: h.fromSplit,
          splitAces: h.splitAces, doubled: h.doubled, stake, result, pay, returned: ret };
      });
      let insurance = null;
      if (this.insurance > 0) {
        const s = this.insurance;
        const win = dealerBJ;
        insurance = { stake: s, result: win ? 'win' : 'lose', pay: win ? round2(s * INS_PAYS) : -s, returned: win ? round2(s * (INS_PAYS + 1)) : 0 };
        wagered += s; returned += insurance.returned;
      }
      wagered = round2(wagered); returned = round2(returned);
      return { lines, insurance, dealer: { total: dv.total, bust: dv.bust, bj: dealerBJ }, dealerBJ, wagered, returned, net: round2(returned - wagered) };
    }
  }

  /** 策略表的列標籤（給「表：硬牌 16 vs 6」） */
  function rowLabel(lk, cards) {
    if (lk.table === 'pairs') return lk.key === 'TT' ? '10,10' : `${lk.key[0]},${lk.key[1]}`;
    if (lk.table === 'soft') return lk.key === 'A1' ? '軟 12' : `A,${lk.key.slice(1)}`;
    return String(BJ.value(cards).total);
  }
  /** 表格渲染用的列鍵（硬 17+ → 17、13–14 → 13、5–8 → 8；軟 A2–A3 → A2、A4–A5 → A4） */
  function rowKey(lk, cards) {
    if (lk.table === 'pairs') return lk.key;
    if (lk.table === 'soft') return lk.key === 'A1' ? null : ({ A3: 'A2', A5: 'A4' })[lk.key] || lk.key;
    const t = BJ.value(cards).total;
    return t >= 17 ? 17 : t >= 13 && t <= 14 ? 13 : t <= 8 ? 8 : t;
  }

  /**
   * 基本策略建議 + 查表出處。opts：{canDouble, canSplit}（已含規則與餘額限制）
   * @returns {{code:'H'|'S'|'D'|'P', raw, lk, ref:'硬牌 16 vs 6', text:'建議：停牌 Stand（表：硬牌 16 vs 6）', note}}
   */
  function advise(cards, up, { canDouble = cards.length === 2, canSplit } = {}) {
    const lk = BJ.lookup(cards, up, { canSplit });
    const code = BJ.basicStrategy(cards, up, { canDouble, canSplit });
    const ref = `${T.table[lk.table]} ${rowLabel(lk, cards)} vs ${DEALER_LABEL[lk.col]}`;
    const a = T.act[code];
    let note = '';
    if ((lk.code === 'D' || lk.code === 'Ds') && code !== 'D') note = `表上是加倍，但現在不能加倍，所以${a.zh}。`;
    return { code, raw: lk.code, lk, ref, row: rowKey(lk, cards), text: `建議：${a.zh} ${a.en}（表：${ref}）`, note };
  }

  /** 單手賠付算式 */
  function formulaOf(l, multi) {
    const name = multi ? `第 ${l.hand + 1} 手 ` : '';
    const stake = l.doubled ? `${fmt(l.stake)}（${fmt(l.stake / 2)} + 加倍 ${fmt(l.stake / 2)}）` : fmt(l.stake);
    if (l.result === 'blackjack') return `${name}${stake} × 1.5 = +${fmt(l.pay)}（拿回 ${fmt(l.returned)}）`;
    if (l.result === 'win') return `${name}${stake} × 1 = +${fmt(l.pay)}（拿回 ${fmt(l.returned)}）`;
    if (l.result === 'push') return `${name}${stake} 平手退回 = RM 0（拿回 ${fmt(l.returned)}）`;
    return `${name}${stake} 輸 = −${fmt(l.stake)}`;
  }
  function insFormula(ins) {
    return ins.result === 'win'
      ? `保險 ${fmt(ins.stake)} × 2 = +${fmt(ins.pay)}（拿回 ${fmt(ins.returned)}）`
      : `保險 ${fmt(ins.stake)} 輸 = −${fmt(ins.stake)}`;
  }

  /** 手牌點數顯示：BJ / 22 爆 / 軟牌未完成 7/17 */
  function totalText(cards, { fromSplit = false, final = false } = {}) {
    if (!cards.length) return '';
    const v = BJ.value(cards, { fromSplit });
    if (v.blackjack) return 'BJ';
    if (v.bust) return `${v.total} 爆`;
    if (v.soft && v.total < 21 && !final) return `${v.total - 10}/${v.total}`;
    return String(v.total);
  }

  /**
   * Monte Carlo：全部照基本策略（不買保險），6 副牌靴、切牌剩 52 張重洗。
   * @returns {{hands, edge, net, wagered, sd, se}} edge 與 se 單位為 %
   */
  function simulate(n = 200000, { decks = DECKS, cutCard = CUT_CARD } = {}) {
    const shoe = LG.cards.newShoe(decks, { cutCard });
    const draw = () => shoe.draw();
    let net = 0, sq = 0, wagered = 0;
    for (let k = 0; k < n; k++) {
      if (shoe.needsShuffle()) shoe.shuffle();
      const r = new Round({ bet: 1, draw }).deal();
      if (r.start() === 'play') {
        while (r.phase === 'play') {
          const code = BJ.basicStrategy(r.hand.cards, r.up, { canDouble: r.canDouble(), canSplit: r.canSplit() });
          if (code === 'P') r.split(); else if (code === 'D') r.double(); else if (code === 'H') r.hit(); else r.stand();
        }
        r.playDealer();
      }
      const s = r.settle();
      net += s.net; sq += s.net * s.net; wagered += s.wagered;
    }
    const mean = net / n;
    const sd = Math.sqrt(Math.max(0, sq / n - mean * mean));
    return { hands: n, edge: -mean * 100, net, wagered, sd, se: (sd / Math.sqrt(n)) * 100 };
  }

  /** 策略表 HTML（教學用 LG.ui.table 渲染；練習提示面板同一份） */
  function strategyTableHtml(kind) {
    const S = BJ.STRATEGY_TABLE;
    const head = `<tr><th>${kind === 'pairs' ? '對子' : '你'} \\ 莊</th>${S.dealer.map((d) => `<th>${d === 'T' ? '10' : d}</th>`).join('')}</tr>`;
    const body = S.rows[kind].map(({ label, key }) => `<tr><th>${label}</th>${S[kind][key]
      .map((c, ci) => `<td class="bj-c bj-c--${c}" data-r="${key}" data-c="${ci}">${c}</td>`).join('')}</tr>`).join('');
    return `<table><caption>${term(T.table[kind], T.tableEn[kind])}</caption><thead>${head}</thead><tbody>${body}</tbody></table>`;
  }
  function strategyTableEl(kind) { return ui.table(strategyTableHtml(kind), { className: 'bj-strategy' }); }
  function strategyTableOuter(kind) {
    const e = strategyTableEl(kind);
    return (e && typeof e.outerHTML === 'string' && e.outerHTML) || `<div class="lg-tablewrap bj-strategy">${strategyTableHtml(kind)}</div>`;
  }

  // 教學練習題（答案由 basicStrategy 算，不寫死）
  const QUIZ = [
    { id: 'q1', player: 'TS 6H', up: '6D', hint: '12–16 對莊 2–6：停牌，讓莊家自己去爆。' },
    { id: 'q2', player: 'TS 6H', up: 'KC', hint: '12–16 對莊 7–A：加牌到 17 以上。' },
    { id: 'q3', player: '6S 5H', up: '5D', hint: '11 點：加倍（莊明牌 A 才只加牌）。' },
    { id: 'q4', player: '8S 8H', up: 'TC', hint: 'A,A 和 8,8：一定分。' },
    { id: 'q5', player: 'TS KH', up: '6C', hint: '10,10 不分：20 點已經很強。' },
  ];
  const quizAnswer = (q) => BJ.basicStrategy(LG.cards.parseMany(q.player), LG.cards.parse(q.up));

  const RIG_DOUBLE = '5S 6D 6C KH 9S TD';   // 你 5+6=11 vs 莊 6（暗 K）→ 加倍拿 9 = 20；莊 16 補 10 爆

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'blackjack',
    category: 'table',
    order: 2,
    name: { zh: '21 點', en: 'Blackjack' },
    summary: '比莊家接近 21 點又不爆牌。照基本策略打，莊家優勢只有 0.41%。',
    houseEdge: [
      { bet: { zh: '基本策略（6 副、S17、DAS、無投降）', en: 'Basic strategy' }, edge: 0.41, best: true },
    ],
    limits: { real: { min: 50, max: 3000 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: { Round, advise, formulaOf, insFormula, totalText, simulate, strategyTableHtml, rowLabel, QUIZ, quizAnswer, T, SPOT, MAX_HANDS, RIG_DOUBLE },

    create(ctx) {
      const state = {
        phase: 'idle', token: 0, staked: 0, rounds: 0, dealt: 0,
        rig: [], allow: null, round: null, decisions: [], insDecision: null, holeShown: false,
        last: null, quiz: {}, shown: { d: 0, h: [] }, win: null, actCd: null, insCd: null, insResolve: null,
      };
      const bets = new LG.Bets({
        min: ctx.limits.min, max: ctx.limits.max,
        labels: { main: '主注 Bet', insurance: '保險 Insurance' },
      });
      const shoe = LG.cards.newShoe(DECKS, { cutCard: CUT_CARD });
      const draw = () => (state.rig.length ? state.rig.shift() : shoe.draw());
      let discards = 0, onTable = 0;
      let root, tableEl, feltEl, dealerCardsEl, dealerTotalEl, handsEl, shoeN, discardN, adviceEl, noteEl, bar, tray, layer, betbar;
      let stratTabs = null;
      const stratTables = {};

      // ================================================================ 桌面
      function spotEl(id, t, cls = '') {
        return el(`div.lg-spot${cls}`, { dataset: { bet: id } }, [
          el('span.lg-spot__zh', { text: t.zh }),
          el('span.lg-spot__en', { text: t.en }),
          el('span.lg-spot__odds', { text: t.odds }),
        ]);
      }
      function box(cls, t, nRef) {
        const n = el('span.bj-box__n');
        nRef(n);
        return el(`div.${cls}`, [el('span.bj-box__zh', { text: t.zh }), el('span.bj-box__en', { text: t.en.toUpperCase() }), n]);
      }
      function emptySeat(n) {
        const base = T.seatBase[n];
        return el(`div.bj-seat.bj-seat--empty.bj-seat--${n}`, { dataset: { seat: n } }, [
          el('div.bj-seat__ring', { 'aria-hidden': 'true' }),
          el('div.bj-seat__label', { html: `座位 ${n}${base ? `<small>${base}</small>` : ''}` }),
        ]);
      }
      function buildTable() {
        dealerTotalEl = el('span.lg-hand__total.bj-total', { hidden: true });
        dealerCardsEl = el('div.lg-hand.bj-dcards');
        handsEl = el('div.bj-hands');
        feltEl = el('div.bj-felt', [
          el('div.bj-top', [
            box('bj-discard', T.discard, (n) => { discardN = n; }),
            el('div.bj-dealer', [
              el('div.lg-hand__label', { html: `${T.dealer.zh} <i class="en">DEALER</i> ` }, [dealerTotalEl]),
              dealerCardsEl,
            ]),
            box('bj-shoe', T.shoe, (n) => { shoeN = n; }),
          ]),
          el('div.bj-print', { html: `<b>${T.print1}</b><span>${T.print2}</span><small>${T.printZh}</small>` }),
          el('div.bj-insline', [
            el('div.bj-arcwrap', { 'aria-label': T.insArc, html: `<svg class="bj-arc" viewBox="0 0 340 58" aria-hidden="true">`
              + '<path id="bj-arc-path" d="M 20 10 Q 170 66 320 10" fill="none"/>'
              + '<path class="bj-arc-line" d="M 8 22 Q 170 84 332 22"/>'
              + `<text><textPath href="#bj-arc-path" startOffset="50%" text-anchor="middle">${T.insArc}</textPath></text></svg>` }),
            spotEl('insurance', T.insurance, '.bj-ins-spot'),
          ]),
          el('div.bj-seats', [
            emptySeat(5), emptySeat(4),
            el('div.bj-seat.bj-seat--you', { dataset: { seat: 3 } }, [handsEl, el('div.bj-seat__label', { html: T.you })]),
            emptySeat(2), emptySeat(1),
          ]),
        ]);
        tableEl = el('div.lg-table.bj-table', [feltEl]);
        adviceEl = el('div.lg-hint.bj-advice', { hidden: true, role: 'status' });
        noteEl = el('div.bj-note', { hidden: true, role: 'status' });
        const actions = el('div.lg-actions.bj-actions', { class: ctx.isReal ? 'is-real' : '', dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, adviceEl, noteEl, actions, chips, barEl);

        bar = ui.actionBar(actions, ['H', 'S', 'D', 'P', 'I', 'N'].map((code) => {
          const a = T.act[code];
          const item = { id: a.id, hidden: true, onClick: () => onButton(code) };
          if (ctx.isReal) item.label = `${a.zh} <i class="en">${a.en}</i><small class="bj-gesture">${a.gesture}</small>`;
          else { item.label = a.zh; item.en = a.en; }
          return item;
        }));
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 50 : 10 });
        layer = ui.betLayer(tableEl, {
          bets, chipTray: tray, gameId: ctx.gameId,
          canPlace: (spot) => {
            if (state.phase === 'demo') return T.demoLock;
            if (spot === 'insurance') return T.onlyMain;
            if (spot !== 'main') return T.splitSpot;
            return true;
          },
        });
        betbar = ui.betBar(barEl, { bets, layer });
        renderHandsOnly([{ cards: [], bet: 0 }]);
        paintShoe();
      }

      function paintShoe() {
        if (shoeN) shoeN.textContent = `${shoe.remaining()} 張`;
        if (discardN) discardN.textContent = `${discards} 張`;
      }

      // ---- 繪製（view model）
      function handBlock(h, i, prevCount, res, multi, small) {
        const cardsEl = el('div.bj-hcards');
        h.cards.forEach((c, k) => {
          const e = ui.card(c, { size: small ? 'sm' : 'md' });
          if (k >= prevCount) e.classList.add('bj-in');
          cardsEl.appendChild(e);
        });
        const tot = h.cards.length ? el('span.lg-hand__total', { text: totalText(h.cards, { fromSplit: h.fromSplit, final: h.done }) }) : null;
        let tag = null;
        if (res) {
          tag = el('span', { class: ['bj-tag', `is-${res.result}`], text: res.result === 'blackjack' ? `BJ ${money.fmtSigned(res.pay)}` : res.pay === 0 ? 'Push' : money.fmtSigned(res.pay) });
        } else if (h.doubled) tag = el('span.bj-tag.is-note', { text: '加倍' });
        const spot = spotEl(SPOT(i), i === 0 ? T.main : { zh: `第 ${i + 1} 手`, en: `Hand ${i + 1}`, odds: '1:1' }, '.bj-spot');
        return el('div', { class: ['bj-hand', h.active && 'is-active', res && `is-${res.result}`], dataset: { hand: i } }, [
          cardsEl,
          el('div.bj-hand__meta', [tot, tag]),
          spot,
        ]);
      }
      function renderHandsOnly(hands, results) {
        const prev = state.shown.h;
        const multi = hands.length > 1;
        const small = hands.length > 1;
        handsEl.classList.toggle('is-many', multi);
        feltEl.classList.toggle('is-split', hands.length > 2);
        handsEl.replaceChildren(...hands.map((h, i) => handBlock(h, i, prev[i] || 0, results && results[i], multi, small)));
        state.shown.h = hands.map((h) => h.cards.length);
        handsEl.classList.remove('bj-old');
        if (layer) layer.refresh();
      }
      function renderDealer(cards, holeHidden) {
        const prev = state.shown.d;
        dealerCardsEl.replaceChildren(...cards.map((c, k) => {
          const hidden = k === 1 && holeHidden;
          const e = ui.card(hidden ? null : c, { faceDown: hidden });
          if (k >= prev) e.classList.add('bj-in');
          return e;
        }));
        state.shown.d = cards.length;
        dealerCardsEl.classList.remove('bj-old');
        const vis = holeHidden ? cards.slice(0, 1) : cards;
        dealerTotalEl.hidden = !vis.length;
        dealerTotalEl.textContent = vis.length ? totalText(vis, { final: !holeHidden }) : '';
      }
      /** 依目前 Round 繪製；pCount/dCount 為發牌動畫中的可見張數 */
      function renderLive({ pCount = Infinity, dCount = Infinity, results = null } = {}) {
        const r = state.round;
        if (!r) return;
        const active = state.phase === 'player' && r.phase === 'play';
        renderDealer(r.dealer.slice(0, dCount), !state.holeShown);
        renderHandsOnly(r.hands.map((h, i) => ({
          cards: i === 0 ? h.cards.slice(0, pCount) : h.cards, bet: h.bet, doubled: h.doubled, fromSplit: h.fromSplit,
          done: h.done || !active, active: active && i === r.cur,
        })), results);
        onTable = r.dealer.length + r.hands.reduce((s, h) => s + h.cards.length, 0);
        paintShoe();
      }
      function markOld() {
        handsEl.classList.add('bj-old');
        dealerCardsEl.classList.add('bj-old');
      }
      async function revealHole(tok) {
        const r = state.round;
        const e = dealerCardsEl.querySelector('.lg-card.is-facedown');
        if (e && r) await ui.flip(e, r.dealer[1]);
        if (tok !== state.token || !ctx.alive()) return false;
        state.holeShown = true;
        renderLive();
        return true;
      }

      // ================================================================ 按鈕 / 提示
      const affordable = (amt) => ctx.bank.canAfford(amt);
      /** 目前這手可用的選項（規則 + 餘額） */
      function allowedOpts() {
        const r = state.round;
        if (!r || !r.canAct()) return { canDouble: false, canSplit: false, afford: true };
        const afford = affordable(r.hand.bet);
        return { canDouble: r.canDouble() && afford, canSplit: r.canSplit() && afford, afford, ruleDouble: r.canDouble(), ruleSplit: r.canSplit() };
      }
      function setButtons() {
        const r = state.round;
        const hide = (code) => bar.set(T.act[code].id, { hidden: true });
        let note = '';
        if (state.phase === 'player' && r && r.canAct()) {
          const o = allowedOpts();
          bar.set('hit', { hidden: false, disabled: false });
          bar.set('stand', { hidden: false, disabled: false });
          bar.set('double', { hidden: false, disabled: !o.canDouble });
          bar.set('split', { hidden: false, disabled: !o.canSplit });
          hide('I'); hide('N');
          if (!o.afford && (o.ruleDouble || o.ruleSplit)) {
            const what = o.ruleDouble && o.ruleSplit ? '加倍或分牌' : o.ruleDouble ? '加倍' : '分牌';
            note = `餘額 ${fmt(ctx.bank.balance())} 不足：${what}要再放 ${fmt(r.hand.bet)}，所以按鈕停用。`;
          }
        } else if (state.phase === 'insurance' && r) {
          ['H', 'S', 'D', 'P'].forEach(hide);
          const cost = round2(r.bet / 2);
          const ok = affordable(cost);
          bar.set('insure', { hidden: false, disabled: !ok });
          bar.set('no-insure', { hidden: false, disabled: false });
          if (!ok) note = `餘額 ${fmt(ctx.bank.balance())} 不足：保險要 ${fmt(cost)}（主注的一半）。`;
        } else {
          ['H', 'S', 'D', 'P', 'I', 'N'].forEach(hide);
        }
        noteEl.hidden = !note;
        noteEl.textContent = note;
      }
      function highlightCell(a) {
        Object.values(stratTables).forEach((t) => t.querySelectorAll('td.is-hl').forEach((x) => x.classList.remove('is-hl')));
        if (!a || !stratTabs || a.row === null) return;
        if (stratTabs.current() !== a.lk.table) stratTabs.select(a.lk.table);
        const t = stratTables[a.lk.table];
        const td = t && t.querySelector(`td[data-r="${a.row}"][data-c="${a.lk.col}"]`);
        if (td) td.classList.add('is-hl');
      }
      function paintAdvice() {
        let html = '';
        let adv = null;
        const r = state.round;
        if (ctx.hints && r) {
          if (state.phase === 'player' && r.canAct()) {
            adv = advise(r.hand.cards, r.up, allowedOpts());
            html = `${state.round.hands.length > 1 ? `第 ${r.cur + 1} 手 · ` : ''}${adv.text}${adv.note ? `<br><small>${adv.note}</small>` : ''}`;
          } else if (state.phase === 'insurance') html = T.adviceIns;
        }
        adviceEl.hidden = !html;
        adviceEl.innerHTML = html;
        highlightCell(adv);
      }
      function paintControls() { setButtons(); paintAdvice(); }

      function onButton(code) {
        if (code === 'I' || code === 'N') { resolveInsurance(code === 'I'); return; }
        act(code);
      }

      // ================================================================ 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        state.round = null;
        paintControls();
        markOld();
        if (shoe.needsShuffle()) {
          shoe.shuffle();
          discards = 0; onTable = 0;
          ui.toast(T.shuffle);
        }
        paintShoe();
        state.win = ctx.bettingWindow({ bets, onClose: onNoMoreBets });
      }

      async function onNoMoreBets({ ok, validation }) {
        state.win = null;
        if (!ok) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(validation.zh, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        const tok = ++state.token;
        const alive = () => ctx.alive() && tok === state.token;
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.dealt += 1;
        discards += onTable; onTable = 0;
        const r = state.round = new Round({ bet: bets.get('main'), draw });
        r.tutor = !!state.allow;
        state.decisions = [];
        state.insDecision = null;
        state.holeShown = false;
        state.shown = { d: 0, h: [] };
        r.deal();
        state.phase = 'dealing';
        paintControls();
        ctx.dealer.say('發牌', 'Dealing');
        for (const [pc, dc] of [[1, 0], [1, 1], [2, 1], [2, 2]]) {
          renderLive({ pCount: pc, dCount: dc });
          await ctx.wait(DEAL_MS);
          if (!alive()) return;
        }

        if (r.offerInsurance) {
          state.phase = 'insurance';
          ctx.dealer.say('要買保險嗎？', 'Insurance?');
          paintControls();
          const take = await askInsurance(tok);
          if (!alive()) return;
          if (take) {
            const amt = round2(r.bet / 2);
            ctx.bank.debit(amt);
            state.staked = round2(state.staked + amt);
            r.takeInsurance();
            bets.set('insurance', amt);
          }
          state.insDecision = take;
          state.phase = 'dealing';
          paintControls();
        }

        const s = r.start();
        if (r.peeks) {
          ctx.dealer.say('莊家查看暗牌', 'Checking for blackjack');
          await ctx.wait(500);
          if (!alive()) return;
        }
        if (s === 'dealer-bj') {
          if (!(await revealHole(tok))) return;
          ctx.dealer.say('莊家 Blackjack', 'Dealer has blackjack');
          await ctx.wait(400);
          if (!alive()) return;
          settle(tok);
          return;
        }
        if (s === 'player-bj') {
          ctx.dealer.say('Blackjack！賠 3:2', 'Blackjack');
          await ctx.wait(400);
          if (!alive()) return;
          if (!(await revealHole(tok))) return;
          settle(tok);
          return;
        }
        state.phase = 'player';
        promptTurn();
      }

      function askInsurance(tok) {
        return new Promise((resolve) => {
          state.insResolve = (v) => { state.insResolve = null; if (state.insCd) { state.insCd.cancel(); state.insCd = null; } if (tok === state.token) resolve(v); };
          if (ctx.isReal) state.insCd = ui.countdown(INSURANCE_SECONDS, { onDone: () => { state.insCd = null; if (state.insResolve) state.insResolve(false); } });
        });
      }
      function resolveInsurance(take) {
        if (state.phase !== 'insurance' || !state.insResolve) return;
        if (take && !affordable(round2(state.round.bet / 2))) return;
        state.insResolve(take);
      }

      function promptTurn() {
        const r = state.round;
        if (!r || !ctx.alive()) return;
        if (r.phase !== 'play') { dealerTurn(state.token); return; }
        renderLive();
        paintControls();
        const h = r.hand;
        const who = r.hands.length > 1 ? `第 ${r.cur + 1} 手` : '輪到你';
        ctx.dealer.say(`${who}：${totalText(h.cards, { fromSplit: h.fromSplit })} 點，請決定`, 'Hit or stand?');
        if (ctx.isReal) {
          if (state.actCd) state.actCd.cancel();
          const tok = state.token;
          state.actCd = ui.countdown(ACTION_SECONDS, {
            onDone: () => {
              state.actCd = null;
              if (tok !== state.token || state.phase !== 'player') return;
              ui.toast(`${ACTION_SECONDS} 秒沒動作 = 停牌 <i class="en">Stand</i>`);
              act('S', { auto: true });
            },
          });
        }
      }

      function act(code, { auto = false } = {}) {
        const r = state.round;
        if (state.phase !== 'player' || !r || !r.canAct()) return;
        const o = allowedOpts();
        if (state.allow && !auto && !state.allow.includes(code)) {
          const need = T.act[state.allow[0]];
          const blocked = state.allow.includes('D') && !o.canDouble;   // 餘額不夠加倍 → 不強制
          if (!blocked) { ui.toast(`這一步請按「${need.zh} <i class="en">${need.en}</i>」`, { type: 'warn' }); return; }
        }
        if (code === 'D' && !o.canDouble) return;
        if (code === 'P' && !o.canSplit) return;
        const i = r.cur, h = r.hand;
        state.decisions.push({ hand: i, cards: h.cards.slice(), action: code, adv: advise(h.cards, r.up, o), auto });
        if (state.actCd) { state.actCd.cancel(); state.actCd = null; }
        if (code === 'D') {
          const add = h.bet;
          ctx.bank.debit(add);
          state.staked = round2(state.staked + add);
          r.double();
          bets.set(SPOT(i), h.bet);
        } else if (code === 'P') {
          const add = h.bet;
          ctx.bank.debit(add);
          state.staked = round2(state.staked + add);
          r.split();
          r.hands.forEach((x, k) => bets.set(SPOT(k), x.bet));
        } else if (code === 'H') r.hit();
        else r.stand();
        if (BJ.value(h.cards).bust) ctx.dealer.say(`${BJ.value(h.cards).total} 點爆牌`, 'Bust');
        promptTurn();
      }

      async function dealerTurn(tok) {
        const alive = () => ctx.alive() && tok === state.token;
        const r = state.round;
        state.phase = 'dealer';
        if (state.actCd) { state.actCd.cancel(); state.actCd = null; }
        renderLive();
        paintControls();
        await ctx.wait(250);
        if (!alive()) return;
        if (!(await revealHole(tok))) return;
        const before = r.dealer.length;
        r.playDealer();
        for (let k = before + 1; k <= r.dealer.length; k++) {
          await ctx.wait(DEAL_MS);
          if (!alive()) return;
          renderLive({ dCount: k });
        }
        await ctx.wait(200);
        if (!alive()) return;
        settle(tok);
      }

      function settle(tok) {
        if (tok !== state.token || !ctx.alive()) return;
        const r = state.round;
        r.phase = 'done';
        const res = r.settle();
        ctx.bank.credit(res.returned);
        state.staked = 0;
        state.phase = 'settled';
        state.holeShown = true;
        renderLive({ results: res.lines });
        const d = res.dealer;
        const allPush = res.lines.every((l) => l.result === 'push');
        if (res.dealerBJ) ctx.dealer.say('莊家 Blackjack', 'Dealer has blackjack');
        else if (res.lines.length === 1 && res.lines[0].result === 'blackjack') ctx.dealer.say('Blackjack！賠 3:2', 'Blackjack pays 3 to 2');
        else if (res.lines.every((l) => l.bust)) ctx.dealer.say('爆牌，莊家收注', 'Bust');
        else if (d.bust) ctx.dealer.say(`莊家 ${d.total} 點爆牌`, 'Dealer busts');
        else if (allPush) ctx.dealer.say(`莊家 ${d.total} 點，平手`, 'Push');
        else ctx.dealer.say(`莊家 ${d.total} 點`, `Dealer has ${d.total}`);

        ctx.recordRound({ wagered: res.wagered, net: res.net, outcome: res.net > 0 ? 'win' : res.net < 0 ? 'lose' : 'push' });
        ctx.explain({ ...explainRound(r, res), net: res.net });
        state.last = { doubled: r.hands.some((h) => h.doubled), split: r.hands.length > 1, insurance: r.insurance > 0, net: res.net };
        state.rounds += 1;
        state.allow = null;
        bets.unlock();
        bets.clear();
        paintControls();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      /** 練習/教學的四段說明 */
      function explainRound(r, res) {
        const multi = res.lines.length > 1;
        const dealerStr = `莊家 ${cardsText(r.dealer)} = <b>${res.dealerBJ ? 'Blackjack' : res.dealer.bust ? `${res.dealer.total} 爆` : res.dealer.total}</b>`;
        const hand = res.lines.map((l) => `${multi ? `第 ${l.hand + 1} 手` : '你'} ${cardsText(l.cards)} = <b>${l.bj ? 'Blackjack' : l.bust ? `${l.total} 爆` : l.total}</b>${l.doubled ? '（加倍）' : ''}`)
          .concat(dealerStr).join('<br>');
        const RZ = { blackjack: ['Blackjack！', 'BLACKJACK'], win: ['贏', 'WIN'], push: ['平手', 'PUSH'], lose: ['輸', 'LOSE'] };
        let result = multi
          ? res.lines.map((l) => `第 ${l.hand + 1} 手 ${RZ[l.result][0]} <i class="en">${RZ[l.result][1]}</i>`).join('、')
          : ({ blackjack: 'Blackjack 你贏 <i class="en">BLACKJACK</i>', win: '你贏 <i class="en">YOU WIN</i>', push: '平手 <i class="en">PUSH</i>', lose: '莊家贏 <i class="en">DEALER WINS</i>' })[res.lines[0].result];
        if (res.insurance) result += `；保險${res.insurance.result === 'win' ? '中' : '輸'}`;
        const formula = res.lines.map((l) => formulaOf(l, multi))
          .concat(res.insurance ? [insFormula(res.insurance)] : [])
          .join('<br>') + `<br>淨 <b>${money.fmtSigned(res.net)}</b>`;

        const why = [];
        res.lines.forEach((l) => {
          const p = multi ? `第 ${l.hand + 1} 手：` : '';
          if (res.dealerBJ) why.push(`${p}莊家明牌 ${cardText(r.dealer[0])}、暗牌湊成 Blackjack，${l.bj ? '你也是 BJ → 平手退注' : '直接收注（還沒輪到你行動，只輸原注）'}。`);
          else if (l.result === 'blackjack') why.push(`${p}A + 10 點牌兩張 = Blackjack，賠 3:2。`);
          else if (l.bust) why.push(`${p}${l.total} 點超過 21 爆牌 <i class="en">Bust</i>，不管莊家怎樣都輸。`);
          else if (l.fromSplit && l.total === 21 && l.cards.length === 2 && l.cards.some((c) => c.rank === 'A')) why.push(`${p}分牌後 A + 10 算 21 點，不算 Blackjack，只賠 1:1。`);
          else if (res.dealer.bust) why.push(`${p}莊家補到 ${res.dealer.total} 點爆牌，你沒爆就贏。`);
          else if (l.result === 'push') why.push(`${p}${l.total} = ${res.dealer.total}，同點平手 <i class="en">Push</i>，退回本金。`);
          else why.push(`${p}${l.total} ${l.result === 'win' ? '>' : '<'} 莊家 ${res.dealer.total}。`);
          if (l.splitAces) why.push(`${p}分 A 每手只拿一張。`);
        });
        if (res.insurance) why.push(res.insurance.result === 'win' ? '保險：莊家有 BJ，保險賠 2:1，剛好抵掉主注。' : `保險：莊家沒有 BJ，保險輸。${T.insEdge}。`);
        else if (state.insDecision === false) why.push('不買保險是對的：基本策略永遠不買保險。');
        const devs = state.decisions.filter((d) => !d.auto && d.action !== d.adv.code);
        if (state.insDecision === true) devs.push({ ins: true });
        if (devs.length) {
          why.push('<b>你偏離了基本策略：</b>' + devs.map((d) => (d.ins ? '買了保險（表：永遠不買）'
            : `${multi ? `第 ${d.hand + 1} 手 ` : ''}${cardsText(d.cards)}：你選${T.act[d.action].zh}，表（${d.adv.ref}）建議<b>${T.act[d.adv.code].zh} ${T.act[d.adv.code].en}</b>`)).join('；') + '。');
        } else if (state.decisions.length) {
          why.push('你每一步都照基本策略表。照表打也會輸，但長期輸最少（優勢 0.41%）。');
        }
        const autos = state.decisions.filter((d) => d.auto);
        if (autos.length) why.push(`有 ${autos.length} 手 20 秒沒動作，自動停牌。`);
        return { hand, result, formula, why: why.join('<br>') };
      }

      // ================================================================ 教學 / 示範
      function abortRound() {
        state.token += 1;
        if (state.actCd) { state.actCd.cancel(); state.actCd = null; }
        if (state.insCd) { state.insCd.cancel(); state.insCd = null; }
        state.insResolve = null;
        if (state.win) { state.win.cancel(); state.win = null; }
        if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
        state.round = null;
        state.allow = null;
        bets.unlock();
        bets.clear();
      }
      const parseCards = (s) => String(s).trim().split(/\s+/).filter(Boolean).map((x) => (x === '?' ? null : LG.cards.parse(x)));
      const demo = {
        /** 指定接下來依序發出的牌（教學/e2e 用）；allow 限制下一局可按的動作 */
        rig(cards, allow = null) { state.rig = LG.cards.parseMany(cards); state.allow = allow; },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        ensureBetting() { if (state.phase !== 'betting') { abortRound(); startRound(); } },
        /** 用指定牌直接開一局（主注沒下就放 RM 50） */
        dealRigged(cards, allow) {
          demo.ensureBetting();
          if (!bets.get('main')) {
            if (!ctx.bank.canAfford(50)) { ui.toast('籌碼不足 RM 50，請先重置籌碼'); return; }
            bets.set('main', 50);
          }
          demo.rig(cards, allow);
          if (state.win) state.win.close();
        },
        /** 靜態擺牌：dealer 'AS ?'（? = 暗牌）；hands [{cards:'8S 3D', bet:50, doubled}]；ins 保險金額 */
        showStatic({ dealer = '', hands = [], ins = 0, banner } = {}) {
          abortRound();
          state.phase = 'demo';
          paintControls();
          const d = parseCards(dealer);
          state.shown = { d: 0, h: [] };
          renderDealer(d, d.length > 1 && d[1] === null);
          const hs = hands.map((h) => ({ cards: parseCards(h.cards).filter(Boolean), bet: h.bet || 0, doubled: !!h.doubled, fromSplit: hands.length > 1, done: true }));
          bets.lock();                      // 空的時候鎖：示範籌碼不能動，也不會變成「重複上注」的內容
          hs.forEach((h, i) => { if (h.bet) bets.set(SPOT(i), h.bet); });
          if (ins) bets.set('insurance', ins);
          renderHandsOnly(hs.length ? hs : [{ cards: [], bet: 0 }]);
          if (banner) ctx.dealer.say(banner[0], banner[1]);
        },
      };

      const quizBody = (q) => {
        const p = LG.cards.parseMany(q.player);
        const up = LG.cards.parse(q.up);
        const btns = ['H', 'S', 'D', 'P'].map((c) => `<button type="button" class="lg-btn lg-btn--sm" data-bj-quiz="${q.id}" data-code="${c}">${term(T.act[c].zh, T.act[c].en)}</button>`).join('');
        return `<p>你 <b>${cardsText(p)}</b>（${BJ.value(p).total} 點）vs 莊明牌 <b>${cardText(up)}</b>。照表該怎麼做？</p><div class="bj-quiz">${btns}</div>`;
      };
      const onQuizClick = (ev) => {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-bj-quiz]') : null;
        if (!b) return;
        state.quiz[b.dataset.bjQuiz] = b.dataset.code;
        b.parentElement.querySelectorAll('button').forEach((x) => x.classList.toggle('is-picked', x === b));
      };

      function tutorialSteps() {
        const quizSteps = QUIZ.map((q, n) => {
          const ans = quizAnswer(q);
          const p = LG.cards.parseMany(q.player);
          const upL = DEALER_LABEL[BJ.lookup(p, LG.cards.parse(q.up)).col];
          return {
            id: `strategy-quiz-${n + 1}`, section: 'strategy',
            title: `練習題 ${n + 1}/5：${BJ.value(p).total} 對莊 ${upL}`,
            body: quizBody(q),
            highlight: ['.bj-dealer', '.bj-hands'],
            setup: (inst) => inst.demo.showStatic({ dealer: `${q.up} ?`, hands: [{ cards: q.player, bet: 50 }] }),
            action: {
              label: '點選基本策略的答案',
              check: (inst) => {
                const c = inst.state.quiz[q.id];
                if (!c) return '點上面四個按鈕之一';
                return c === ans || `✗ ${T.act[c].zh}不對。提示：${q.hint}`;
              },
            },
          };
        });
        return [
          // ===== layout 桌面
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：21 點桌面',
            body: '<p>21 點是半圓桌：荷官站直邊，最多 5 位玩家坐弧邊。你坐中間的<b>座位 3</b>，其他空位照現場畫出來。</p>',
            highlight: ['.bj-table'] },
          { id: 'layout-print', section: 'layout', title: '桌面印字',
            body: `<p><b>${T.print1}</b>：Blackjack 賠 3:2。<br><b>${T.print2}</b>：莊家軟 17 停牌 <i class="en">S17</i>。</p><p>坐下前先看這行；只賠 6:5 的桌別坐。</p>`,
            highlight: ['.bj-print'] },
          { id: 'layout-insurance', section: 'layout', title: '保險線 <i class="en">Insurance</i>',
            body: `<p>弧形的 <b>${T.insArc}</b> 是保險線。只有莊家明牌是 A 時，才能在這裡押主注的一半。</p>`,
            highlight: ['.bj-insline'] },
          { id: 'layout-main', section: 'layout', title: '主注圈 <i class="en">Betting circle</i>',
            body: '<p>座位前的圓圈是<b>主注</b>。籌碼只放自己的圈；分牌後旁邊會多出第 2–4 手的圈。</p>',
            highlight: ['[data-bet="main"]'] },
          { id: 'layout-shoe', section: 'layout', title: '牌靴與棄牌盒',
            body: '<p>右上是<b>牌靴 <i class="en">Shoe</i></b>（6 副牌），左上是<b>棄牌盒 <i class="en">Discard</i></b>。<b>切牌 <i class="en">Cut card</i></b>出來就洗牌。</p>',
            highlight: ['.bj-shoe', '.bj-discard'] },
          { id: 'layout-seats', section: 'layout', title: '座位與第三壘 <i class="en">Third base</i>',
            body: '<p>荷官從他左手邊（畫面右）的<b>第一壘 <i class="en">First base</i></b>發起，最後是畫面最左的<b>第三壘</b>。別人怎麼打，長期不會改變你的輸贏。</p>',
            highlight: ['.bj-seat--1', '.bj-seat--5'] },
          // ===== flow 流程
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>下注 → 發牌 →（保險）→ 你行動 → 莊家補牌 → 派彩。荷官先說 <b>請下注 <i class="en">Place your bets</i></b>。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-bet', section: 'flow', title: '下注',
            body: '<p>先點籌碼選面額，再點主注圈放一枚；長按或右鍵拿回一枚。</p>',
            highlight: ['[data-bet="main"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '選 RM 50 籌碼，在主注圈放 RM 50', check: (inst) => inst.bets.get('main') >= 50 || inst.state.dealt > 0 || `主注目前 ${fmt(inst.bets.get('main'))}` } },
          { id: 'flow-deal', section: 'flow', title: '發牌順序',
            body: '<p>發牌順序：<b>你 → 莊明牌 → 你 → 莊暗牌</b>。你的兩張都正面朝上。</p>',
            highlight: ['[data-action="deal"]', '.bj-hands', '.bj-dealer'],
            setup: (inst) => {
              if (inst.state.phase === 'betting') { inst.demo.ensureBetting(); inst.demo.rig(RIG_DOUBLE, ['D']); }
            },
            action: { label: '按「發牌 Deal」', check: (inst) => inst.state.dealt > 0 || '主注有籌碼後按「發牌 Deal」' } },
          { id: 'flow-hole', section: 'flow', title: '暗牌 <i class="en">Hole card</i>',
            body: '<p>莊家第二張蓋著，叫<b>暗牌</b>。你只能看<b>明牌</b>做決定——查策略表用的就是這張。</p>',
            highlight: ['.bj-dealer'] },
          { id: 'flow-signals', section: 'flow', title: '輪到你：用手勢',
            body: '<p>現場用手勢：<b>加牌</b>＝指尖敲桌；<b>停牌</b>＝手掌橫掃；<b>加倍/分牌</b>＝旁邊放同額籌碼，比 1 或 2。</p><p>你 11 點對莊 6 → 加倍！</p>',
            highlight: ['[data-action="double"]', '.bj-hands'],
            setup: (inst) => {
              const s = inst.state;
              const live = s.round && s.round.tutor && ['dealing', 'player', 'dealer'].includes(s.phase);
              if (!live && !(s.last && s.last.doubled)) inst.demo.dealRigged(RIG_DOUBLE, ['D']);
            },
            action: { label: '按「加倍 Double」，看莊家補牌',
              check: (inst) => {
                const s = inst.state;
                if (s.last && s.last.doubled && s.phase !== 'dealer') return true;
                return s.phase === 'dealer' ? '莊家補牌中…' : '按「加倍 Double」（在桌面下方）';
              } } },
          { id: 'flow-no-touch', section: 'flow', title: '手放桌下，別碰牌',
            body: '<p><b>No more bets</b> 之後籌碼不能再碰——加、減、移動都不行。牌也不能用手碰，等荷官派彩完。</p>',
            highlight: ['[data-bet="main"]', '.bj-hands'],
            setup: (inst) => inst.demo.showStatic({ dealer: '7C ?', hands: [{ cards: 'TS 5H', bet: 50 }], banner: ['停止下注', 'No more bets'] }) },
          { id: 'flow-insurance', section: 'flow', title: '保險詢問 <i class="en">Insurance?</i>',
            body: '<p>莊明牌是 <b>A</b> 時荷官會問 <b>Insurance?</b>。買＝在保險線放主注一半；不買就不動。接著莊家偷看暗牌。</p>',
            highlight: ['[data-bet="insurance"]', '.bj-dealer'],
            setup: (inst) => inst.demo.showStatic({ dealer: 'AS ?', hands: [{ cards: '9H 7C', bet: 50 }], banner: ['要買保險嗎？', 'Insurance?'] }) },
          { id: 'flow-s17', section: 'flow', title: '莊家軟 17 停牌 <i class="en">S17</i>',
            body: '<p>莊家沒有選擇：16 以下一定補，17 以上一定停。<b>A + 6 = 軟 17</b> 也停。</p>',
            highlight: ['.bj-dealer', '.bj-print'],
            setup: (inst) => inst.demo.showStatic({ dealer: 'AH 6S', hands: [{ cards: 'TS 8D', bet: 50 }], banner: ['莊家 17 點', 'Dealer has 17'] }) },
          // ===== payout 賠率
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼賠',
            body: '<p>贏賠 <b>1:1</b>、Blackjack 賠 <b>3:2</b>、保險賠 <b>2:1</b>；同點 <b>平手 <i class="en">Push</i></b> 退回本金。</p>',
            highlight: ['[data-bet="main"] .lg-spot__odds', '[data-bet="insurance"] .lg-spot__odds'],
            setup: (inst) => inst.demo.showStatic({ dealer: '', hands: [] }) },
          { id: 'payout-bj', section: 'payout', title: 'Blackjack 3:2',
            body: '<p>A + 10 點牌兩張＝Blackjack。押 RM 50：<br><b>RM 50 × 1.5 = RM 75</b>（淨贏）<br>拿回 RM 125（含本金）。</p>',
            highlight: ['.bj-hands'],
            setup: (inst) => inst.demo.showStatic({ dealer: '9C ?', hands: [{ cards: 'AS KH', bet: 50 }], banner: ['Blackjack！', 'Blackjack'] }) },
          { id: 'payout-double', section: 'payout', title: '加倍要加多少',
            body: '<p>加倍＝再放<b>同額</b>，只再拿一張。RM 50 加倍後共 RM 100，贏了：<br><b>RM 100 × 1 = RM 100</b>（淨贏）<br>拿回 RM 200。</p>',
            highlight: ['[data-bet="main"]'],
            setup: (inst) => inst.demo.showStatic({ dealer: '6D ?', hands: [{ cards: '5S 6C 9S', bet: 100, doubled: true }] }) },
          { id: 'payout-split', section: 'payout', title: '分牌要加多少',
            body: '<p>分牌＝拆成兩手，第二手再放<b>同額</b>：RM 50 分牌後共 RM 100，每手各自和莊比。最多 4 手；分 A 每手只拿一張。</p>',
            highlight: ['[data-bet="main"]', '[data-bet="main-2"]'],
            setup: (inst) => inst.demo.showStatic({ dealer: '6D ?', hands: [{ cards: '8S 3D', bet: 50 }, { cards: '8C', bet: 50 }] }) },
          { id: 'payout-insurance', section: 'payout', title: '保險為什麼不划算',
            body: '<p>暗牌是 10 點牌只有約 <b>31%</b>。保險 RM 25：<br>中：RM 25 × 2 = RM 50（約 31%）<br>不中：−RM 25（約 69%）<br>平均每次約 <b>−RM 1.85</b>（優勢 ≈ 7.4%）。</p>',
            highlight: ['[data-bet="insurance"]'],
            setup: (inst) => inst.demo.showStatic({ dealer: 'AS ?', hands: [{ cards: 'TS 9C', bet: 50 }], ins: 25, banner: ['要買保險嗎？', 'Insurance?'] }) },
          // ===== strategy 策略
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢',
            body: '<table class="lg-datatable"><tr><th>注 / 打法</th><th>莊家優勢</th></tr><tr><td>主注＋基本策略</td><td>0.41%</td></tr><tr><td>保險</td><td>≈ 7.4%</td></tr></table><p>0.41% 是全場最低之一，但前提是<b>每手都照表</b>。</p>',
            highlight: null,
            setup: (inst) => inst.demo.showStatic({ dealer: '', hands: [] }) },
          { id: 'strategy-hard', section: 'strategy', title: '策略表 1：硬牌 <i class="en">Hard</i>',
            body: `<p>沒有 A（或 A 只能算 1）的手。左欄你的點數，上排莊明牌。</p>${strategyTableOuter('hard')}<p class="lg-muted">${T.legend}</p>`,
            highlight: null },
          { id: 'strategy-soft', section: 'strategy', title: '策略表 2：軟牌 <i class="en">Soft</i>',
            body: `<p>A 算 11 還不會爆的手，例如 A,7 = 軟 18。</p>${strategyTableOuter('soft')}`,
            highlight: null },
          { id: 'strategy-pairs', section: 'strategy', title: '策略表 3：對子 <i class="en">Pairs</i>',
            body: `<p>兩張同點數時先查這張，P = 分牌。</p>${strategyTableOuter('pairs')}`,
            highlight: null },
          { id: 'strategy-five', section: 'strategy', title: '背 5 條就夠用',
            body: '<ol class="lg-list"><li>12–16 對莊 2–6：<b>停</b></li><li>12–16 對莊 7–A：<b>加牌到 17</b></li><li>11：<b>加倍</b></li><li>A,A、8,8：<b>一定分</b></li><li>10,10、5,5：<b>不分</b></li></ol><p class="lg-muted">例外：12 對 2、3 加牌；11 對 A 加牌。</p>',
            highlight: null },
          ...quizSteps,
          { id: 'strategy-do', section: 'strategy', title: '該押：主注＋照表打',
            body: '<p>21 點最好的注就是<b>主注</b>，每手照基本策略，莊家優勢只有 <b>0.41%</b>。</p>',
            highlight: ['[data-bet="main"]'],
            setup: (inst) => inst.demo.showStatic({ dealer: '', hands: [] }) },
          { id: 'strategy-dont', section: 'strategy', title: '別押：保險；別跟感覺',
            body: '<p><b>別買保險</b>（≈ 7.4%）。別因為「感覺要來了」或上一手輸贏改打法。「這桌很熱」只是紀錄，不能預測。</p>',
            highlight: ['[data-bet="insurance"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走；別加注追輸。</p><p>完成！去練習模式試 10 局，打開「提示」對照表。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ================================================================ instance
      return {
        bets,
        state,
        demo,
        tray: () => tray,
        mount(el0) {
          root = el0;
          buildTable();
          paintControls();
          ctx.on('hints:change', paintControls);
          ctx.on('bank:change', () => { if (state.phase === 'player' || state.phase === 'insurance') setButtons(); });
          if (ctx.isPractice) {
            const boxEl = el('div.bj-strat');
            const tabsEl = el('div');
            ['hard', 'soft', 'pairs'].forEach((k) => { stratTables[k] = strategyTableEl(k); });
            boxEl.append(el('p.lg-muted', { html: `${T.rules}。${T.legend}` }), tabsEl);
            stratTabs = ui.tabs(tabsEl, ['hard', 'soft', 'pairs'].map((k) => ({ id: k, label: term(T.table[k], T.tableEn[k]), render: () => stratTables[k] })));
            ctx.strategyPanel(boxEl);
          }
          if (ctx.isTutorial) document.addEventListener('click', onQuizClick);
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          abortRound();
          document.removeEventListener('click', onQuizClick);
          if (layer) layer.destroy();
          if (betbar) betbar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
