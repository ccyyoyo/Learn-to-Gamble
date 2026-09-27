// ============================================================================
// 德州撲克現金桌 Texas Hold'em Cash Game（id: poker-room）
// 規格：docs/05-game-rules/poker-room.md
//
// 檔案分區：
//   §1 規則常數與文案 T
//   §2 牌局引擎 Table（純邏輯、無 DOM；座位、按鈕、盲注、行動順序、最小加注、all-in、邊池、抽水、分池）
//   §3 AI 對手（TAG / LAG / Station：equity + 底池賠率 + 性格偏移 + 10% 隨機）
//   §4 提示與解說（純函式：建議動作、練習結果面板四段）
//   §5 UI（橢圓桌、座位、動作列、買入/離桌、手牌歷程、教學）
//
// 金流（docs/change-requests/poker-room.md）：
//   不用籌碼盤 / betLayer。進桌先「買入 Buy-in」（RM 400–1,000，從餘額扣）；
//   離桌（unmount）把桌上籌碼轉回餘額；局中離桌 = 棄牌，已投入底池的籌碼不退。
//   金額一律整數 RM（盲注 5/10、買入整數）；抽水向下取整到 RM 1。
// ============================================================================
(() => {
  const LG = globalThis.LG;
  const { ui, money } = LG;
  const { el, term } = ui;
  const { fmt, fmtSigned } = money;

  // ==========================================================================
  // §1 規則常數與文案
  // ==========================================================================
  const RULES = {
    sb: 5, bb: 10,
    rakePct: 0.05, rakeCap: 50,
    buyInMin: 400, buyInMax: 1000,
    maxSeats: 6, oppChoices: [3, 4, 5],
    actSeconds: 30,              // 真實模式行動倒數
    aiIters: 300, hintIters: 1000,
    aiDelay: [600, 1800],        // AI 反應時間（ms，乘 LG.speed）
  };

  const T = {
    title: { zh: '德州撲克現金桌', en: "Texas Hold'em Cash Game" },
    you: { zh: '你', en: 'You' },
    pot: { zh: '底池', en: 'Pot' },
    mainPot: { zh: '主池', en: 'Main pot' },
    sidePot: { zh: '邊池', en: 'Side pot' },
    rake: { zh: '抽水', en: 'Rake' },
    board: { zh: '公共牌', en: 'Community cards' },
    fold: { zh: '棄牌', en: 'Fold' },
    check: { zh: '過牌', en: 'Check' },
    call: { zh: '跟注', en: 'Call' },
    bet: { zh: '下注', en: 'Bet' },
    raise: { zh: '加注到', en: 'Raise to' },
    allin: { zh: '全下', en: 'All-in' },
    sbPost: { zh: '小盲', en: 'SB' },
    bbPost: { zh: '大盲', en: 'BB' },
    deal: { zh: '發牌', en: 'Deal' },
    buyIn: { zh: '買入', en: 'Buy-in' },
    rebuy: { zh: '再買入', en: 'Rebuy' },
    leave: { zh: '離桌', en: 'Leave table' },
    history: { zh: '手牌歷程', en: 'Hand history' },
    stack: { zh: '桌上籌碼', en: 'Stack' },
    hands: { zh: '手數', en: 'Hands' },
    waiting: { zh: '等待發牌', en: 'Waiting' },
    yourTurn: { zh: '輪到你', en: 'Your action' },
    quick: { half: '½池', threeq: '¾池', pot: '池', allin: '全下' },
    streets: {
      preflop: { zh: '翻牌前', en: 'Preflop' },
      flop: { zh: '翻牌', en: 'Flop' },
      turn: { zh: '轉牌', en: 'Turn' },
      river: { zh: '河牌', en: 'River' },
      showdown: { zh: '攤牌', en: 'Showdown' },
    },
    names: ['阿傑', '小美', '老王', 'Kenny', 'Aisha', 'Raj', '美玲', 'Hafiz', '志明', 'Mei Ling', 'Arjun', '阿豪'],
    tutorialNames: ['阿傑', '小美', '老王'],
  };

  // ==========================================================================
  // §2 牌局引擎（純邏輯；tests/unit/poker-room.test.mjs）
  // ==========================================================================
  const STREETS = ['preflop', 'flop', 'turn', 'river'];

  /** 抽水：No flop no drop；5% 向下取整到 RM 1；上限 RM 50 */
  function rakeFor(pot, sawFlop, pct = RULES.rakePct, cap = RULES.rakeCap) {
    if (!sawFlop || !(pot > 0)) return 0;
    return Math.min(cap, Math.floor(pot * pct + 1e-9));
  }

  /**
   * 依每個座位本手總投入切出主池/邊池。
   * @param {number[]} contrib 每座本手投入
   * @param {boolean[]} out    每座是否已棄牌/不在手中（不可分池）
   * @returns {{pots:{amount:number, eligible:number[]}[], uncalled:{seat:number, amount:number}|null}}
   *   uncalled = 最高投入者超過次高者、沒人跟的部分（直接退回，不抽水）
   */
  function buildPots(contrib, out) {
    const c = contrib.slice();
    let hi = -1, hiAmt = 0, second = 0;
    c.forEach((v, i) => {
      if (v > hiAmt) { second = hiAmt; hiAmt = v; hi = i; } else if (v > second) second = v;
    });
    let uncalled = null;
    if (hi >= 0 && hiAmt > second) { uncalled = { seat: hi, amount: hiAmt - second }; c[hi] = second; }
    const levels = [...new Set(c.filter((v, i) => v > 0 && !out[i]))].sort((a, b) => a - b);
    const pots = [];
    let prev = 0;
    for (const L of levels) {
      let amount = 0;
      c.forEach((v) => { amount += Math.max(0, Math.min(v, L) - prev); });
      const eligible = [];
      c.forEach((v, i) => { if (!out[i] && v >= L) eligible.push(i); });
      if (amount > 0) pots.push({ amount, eligible });
      prev = L;
    }
    // 保險：若有棄牌者投入高於最高分池層級，併入最後一池
    const total = c.reduce((a, b) => a + b, 0);
    const assigned = pots.reduce((a, p) => a + p.amount, 0);
    if (pots.length && total > assigned) pots[pots.length - 1].amount += total - assigned;
    return { pots, uncalled };
  }

  /** 平分：每人 floor；奇數籌碼（RM 1）依 winners 順序（已按「按鈕左側起」排序）一枚一枚給 */
  function splitAmount(amount, winners) {
    const n = winners.length;
    const each = Math.floor(amount / n);
    let rem = amount - each * n;
    const out = {};
    winners.forEach((w) => { out[w] = each + (rem > 0 ? 1 : 0); if (rem > 0) rem -= 1; });
    return out;
  }

  /**
   * 分池：抽水先從主池扣；每池在 eligible 中比最大牌；平手平分。
   * @param {Array} pots buildPots().pots
   * @param {Object} scores seat → LG.poker score
   * @param {number[]} order 座位順序（按鈕左側第一位起，順時針）
   * @param {number} rake
   */
  function awardPots(pots, scores, order, rake) {
    let r = rake;
    return pots.map((p) => {
      const take = Math.min(r, p.amount);
      r -= take;
      const net = p.amount - take;
      let winners;
      if (p.eligible.length === 1) winners = [...p.eligible];
      else {
        const best = Math.max(...p.eligible.map((i) => scores[i]));
        winners = p.eligible.filter((i) => scores[i] === best);
      }
      winners.sort((a, b) => order.indexOf(a) - order.indexOf(b));
      return { amount: p.amount, eligible: p.eligible, rake: take, net, winners, shares: splitAmount(net, winners) };
    });
  }

  function actionText(type, amount) {
    const m = amount ? ' ' + fmt(amount) : '';
    switch (type) {
      case 'sb': return `${term(T.sbPost.zh, T.sbPost.en)}${m}`;
      case 'bb': return `${term(T.bbPost.zh, T.bbPost.en)}${m}`;
      case 'fold': return term(T.fold.zh, T.fold.en);
      case 'check': return term(T.check.zh, T.check.en);
      case 'call': return `${term(T.call.zh, T.call.en)}${m}`;
      case 'bet': return `${term(T.bet.zh, T.bet.en)}${m}`;
      case 'raise': return `${term(T.raise.zh, T.raise.en)}${m}`;
      case 'allin': return `${term(T.allin.zh, T.allin.en)}${m}`;
      default: return String(type);
    }
  }
  /** 動作按鈕：上行中文 + 金額，下行英文 */
  const btnLabel = (zh, en, amt) => `<span class="pr-btn__zh">${zh}${amt ? ' ' + fmt(amt) : ''}</span><i class="en">${en}</i>`;
  const streetText = (s) => term(T.streets[s].zh, T.streets[s].en);
  const cardsText = (cs) => (cs || []).map((c) => LG.cards.label(c)).join(' ');

  /**
   * 德州撲克牌桌（No Limit）。座位 index 即順時針順序；「左側」= index + 1。
   * players: [{name, stack, isHuman?, persona?}]
   */
  class Table {
    constructor({ players = [], button = 0, sb = RULES.sb, bb = RULES.bb, rakePct = RULES.rakePct, rakeCap = RULES.rakeCap } = {}) {
      Object.assign(this, { sb, bb, rakePct, rakeCap });
      this.seats = players.map((p, i) => this._mkSeat(p, i));
      this.button = button;
      this._firstHand = true;
      this.handNo = 0;
      this.totalRake = 0;
      this.board = [];
      this.street = null;
      this.phase = 'idle';      // idle | play | done
      this.toAct = -1;
      this.log = [];
      this.result = null;
      this.pos = null;
      this.currentBet = 0;
      this.lastRaise = bb;
    }

    _mkSeat(p, i) {
      return {
        idx: i, name: p.name || `Seat ${i + 1}`, stack: p.stack || 0, isHuman: !!p.isHuman, persona: p.persona || null,
        sittingOut: !!p.sittingOut, hole: [], bet: 0, committed: 0, folded: true, allIn: false, acted: false,
        inHand: false, lastAction: null, startStack: p.stack || 0, shown: false,
      };
    }

    /** 兩手之間換人入座（AI 破產換新玩家） */
    setPlayer(i, p) { if (this.phase === 'play') throw Error('HAND_IN_PROGRESS'); this.seats[i] = this._mkSeat(p, i); }

    get n() { return this.seats.length; }

    nextIdx(from, pred) {
      for (let k = 1; k <= this.n; k++) {
        const j = (from + k) % this.n;
        if (pred(this.seats[j], j)) return j;
      }
      return -1;
    }

    canPlay(s) { return s.stack > 0 && !s.sittingOut; }

    _nextButton() {
      const ok = (s) => this.canPlay(s);
      if (this._firstHand) return ok(this.seats[this.button]) ? this.button : this.nextIdx(this.button, ok);
      return this.nextIdx(this.button, ok);
    }

    /** 下一手（或指定按鈕）的按鈕 / 小盲 / 大盲位置；兩人時按鈕 = 小盲 */
    positions(button = this._nextButton()) {
      const ok = (s) => this.canPlay(s);
      const count = this.seats.filter(ok).length;
      if (count < 2 || button < 0) return null;
      const sb = count === 2 ? button : this.nextIdx(button, ok);
      const bb = this.nextIdx(sb, ok);
      return { button, sb, bb, headsUp: count === 2 };
    }

    /** 按鈕左側第一位起、順時針的座位順序（分奇數籌碼用） */
    orderFromButton(button = this.button) {
      const out = [];
      for (let k = 1; k <= this.n; k++) out.push((button + k) % this.n);
      return out;
    }

    potTotal() { return this.seats.reduce((a, s) => a + s.committed, 0); }
    liveSeats() { return this.seats.filter((s) => s.inHand && !s.folded); }

    /** 目前（含本街下注）的主池/邊池切分，顯示用 */
    potsNow() {
      return buildPots(this.seats.map((s) => s.committed), this.seats.map((s) => !s.inHand || s.folded));
    }

    _log(text, extra = {}) { this.log.push({ street: this.street, text, ...extra }); }

    _draw() { return this.deck.pop(); }

    _put(s, amt) {
      amt = Math.max(0, Math.min(amt, s.stack));
      s.stack -= amt; s.bet += amt; s.committed += amt;
      if (s.stack === 0) s.allIn = true;
      return amt;
    }

    _post(i, amt, kind) {
      const s = this.seats[i];
      const a = this._put(s, amt);
      s.lastAction = { type: s.allIn ? 'allin' : kind, amount: a };
      this._log(`${s.name} ${actionText(kind, a)}${s.allIn ? '（' + term(T.allin.zh, T.allin.en) + '）' : ''}`, { seat: i, type: kind, amount: a });
    }

    /**
     * 開始新的一手：移動按鈕 → 下盲注 → 從小盲起每人兩張。
     * @param {{preset?:{holes?:Object<number,Array>, board?:Array, deck?:Array}}} o 教學/測試用：指定手牌與公共牌
     */
    startHand({ preset = {} } = {}) {
      if (this.phase === 'play') throw Error('HAND_IN_PROGRESS');
      const pos = this.positions();
      if (!pos) throw Error('NOT_ENOUGH_PLAYERS');
      this._firstHand = false;
      this.button = pos.button;
      this.pos = pos;
      this.handNo += 1;
      this.board = [];
      this.street = 'preflop';
      this.phase = 'play';
      this.result = null;
      this.log = [];
      this.toAct = -1;
      for (const s of this.seats) {
        const inH = this.canPlay(s);
        Object.assign(s, { hole: [], bet: 0, committed: 0, folded: !inH, allIn: false, acted: false, inHand: inH, lastAction: null, startStack: s.stack, shown: false });
      }
      // 牌：排除指定的牌後洗牌
      const holes = preset.holes || {};
      const fixed = new Set();
      Object.values(holes).forEach((cs) => cs.forEach((c) => fixed.add(c.id)));
      (preset.board || []).forEach((c) => fixed.add(c.id));
      this.deck = preset.deck ? preset.deck.slice() : LG.rng.shuffle(LG.cards.newDeck().filter((c) => !fixed.has(c.id)));
      this.presetBoard = (preset.board || []).slice();

      this._log(`#${this.handNo} 按鈕 <i class="en">Button</i>：${this.seats[pos.button].name}`);
      this._post(pos.sb, this.sb, 'sb');
      this._post(pos.bb, this.bb, 'bb');
      this.currentBet = this.bb;
      this.lastRaise = this.bb;

      const order = [];
      let j = pos.sb;
      do { if (this.seats[j].inHand) order.push(j); j = (j + 1) % this.n; } while (j !== pos.sb);
      for (let r = 0; r < 2; r++) {
        for (const k of order) {
          const pre = holes[k] && holes[k][r];
          this.seats[k].hole.push(pre || this._draw());
        }
      }
      this._advance(pos.bb);
      return this;
    }

    _canActCount() { return this.seats.filter((o) => o.inHand && !o.folded && !o.allIn).length; }

    /** 這個座位本街還需要行動嗎？ */
    _needs(s) {
      if (!s.inHand || s.folded || s.allIn) return false;
      if (s.acted && s.bet >= this.currentBet) return false;
      // 其他人都 all-in / 棄牌，且自己已跟齊 → 沒有對手可以下注
      if (this._canActCount() <= 1 && s.bet >= this.currentBet) return false;
      return true;
    }

    /**
     * 合法動作。
     * @returns {{toCall, owe, canCheck, canRaise, minTo, maxTo, isBet, currentBet, pot}}
     *   minTo：最小「加注到」金額 = 目前最高注 + 前次加注額（翻牌後首注 = 大盲）；籌碼不夠時 = maxTo（全下）
     */
    legal(i) {
      const s = this.seats[i];
      const owe = Math.max(0, this.currentBet - s.bet);
      const toCall = Math.min(owe, s.stack);
      const maxTo = s.bet + s.stack;
      const others = this.seats.some((o) => o !== s && o.inHand && !o.folded && !o.allIn);
      const canRaise = others && !s.acted && maxTo > this.currentBet;
      const minFull = this.currentBet === 0 ? this.bb : this.currentBet + this.lastRaise;
      return {
        toCall, owe, canCheck: owe === 0, canRaise, minTo: Math.min(minFull, maxTo), maxTo,
        isBet: this.currentBet === 0, currentBet: this.currentBet, pot: this.potTotal(),
      };
    }

    /**
     * 執行動作。a = {type:'fold'|'check'|'call'|'bet'|'raise'|'allin', to?}（to = 加注到的總額）
     * 不合法時 throw（CANNOT_CHECK / CANNOT_RAISE / BELOW_MIN_RAISE / ABOVE_STACK / NOT_YOUR_TURN）
     */
    act(i, a) {
      if (this.phase !== 'play') throw Error('NO_HAND');
      if (i !== this.toAct) throw Error('NOT_YOUR_TURN');
      const s = this.seats[i];
      const L = this.legal(i);
      let type = a.type === 'bet' ? 'raise' : a.type;
      let to = a.to;
      if (type === 'allin') {
        if (L.canRaise && L.maxTo > this.currentBet) { type = 'raise'; to = L.maxTo; } else type = L.toCall > 0 ? 'call' : 'check';
      }
      if (type === 'call' && L.toCall === 0) type = 'check';
      let label = type, amount = 0;
      switch (type) {
        case 'fold':
          s.folded = true;
          break;
        case 'check':
          if (L.owe > 0) throw Error('CANNOT_CHECK');
          s.acted = true;
          break;
        case 'call':
          amount = this._put(s, L.toCall);
          s.acted = true;
          if (s.allIn) { label = 'allin'; amount = s.bet; }
          break;
        case 'raise': {
          if (!L.canRaise) throw Error('CANNOT_RAISE');
          to = Math.round(Number(to));
          if (!(to > this.currentBet)) throw Error('BELOW_MIN_RAISE');
          if (to > L.maxTo) throw Error('ABOVE_STACK');
          if (to < L.minTo && to !== L.maxTo) throw Error('BELOW_MIN_RAISE');
          const inc = to - this.currentBet;
          const wasBet = this.currentBet === 0;
          this._put(s, to - s.bet);
          if (inc >= this.lastRaise) {           // 完整加注：重新開放其他人加注
            this.lastRaise = inc;
            this.seats.forEach((o) => { if (o !== s) o.acted = false; });
          }                                      // 不足額 all-in 加注：已行動者只能跟或棄
          this.currentBet = to;
          s.acted = true;
          label = s.allIn ? 'allin' : wasBet ? 'bet' : 'raise';
          amount = to;
          break;
        }
        default: throw Error('BAD_ACTION');
      }
      s.lastAction = { type: label, amount };
      this._log(`${s.name} ${actionText(label, amount)}`, { seat: i, type: label, amount });
      this._advance(i);
      return this;
    }

    _advance(from) {
      if (this.liveSeats().length <= 1) { this._finish(); return; }
      const nx = this.nextIdx(from, (s) => this._needs(s));
      if (nx >= 0) { this.toAct = nx; return; }
      this._nextStreet();
    }

    _nextStreet() {
      this.seats.forEach((s) => { s.bet = 0; s.acted = false; });
      this.currentBet = 0;
      this.lastRaise = this.bb;
      if (this.street === 'river') { this._finish(); return; }
      this.street = STREETS[STREETS.indexOf(this.street) + 1];
      const cnt = this.street === 'flop' ? 3 : 1;
      this._draw(); // 燒牌 Burn
      for (let k = 0; k < cnt; k++) this.board.push(this.presetBoard[this.board.length] || this._draw());
      this._log(`${streetText(this.street)}：${cardsText(this.street === 'flop' ? this.board : this.board.slice(-1))}`, { deal: true });
      this._advance(this.button);
    }

    _finish() {
      this.toAct = -1;
      this.seats.forEach((s) => { s.bet = 0; });
      const live = this.liveSeats();
      const contrib = this.seats.map((s) => s.committed);
      const out = this.seats.map((s) => !s.inHand || s.folded);
      const { pots, uncalled } = buildPots(contrib, out);
      if (uncalled) {
        this.seats[uncalled.seat].stack += uncalled.amount;
        this._log(`退回未被跟注的 ${fmt(uncalled.amount)} 給 ${this.seats[uncalled.seat].name}`);
      }
      const showdown = live.length > 1;
      const scores = {}, hands = {};
      if (showdown) {
        this.street = 'showdown';
        for (const s of live) {
          const r = LG.poker.best(s.hole.concat(this.board));
          scores[s.idx] = r.score; hands[s.idx] = r; s.shown = true;
          this._log(`${s.name} 亮牌 ${cardsText(s.hole)} → ${LG.poker.describe(r)}`, { seat: s.idx });
        }
      }
      const potTotal = pots.reduce((a, p) => a + p.amount, 0);
      const sawFlop = this.board.length >= 3;
      const rake = rakeFor(potTotal, sawFlop, this.rakePct, this.rakeCap);
      const order = this.orderFromButton();
      const awarded = awardPots(pots, scores, order, rake);
      const won = {};
      awarded.forEach((p, k) => {
        Object.entries(p.shares).forEach(([seat, amt]) => {
          this.seats[seat].stack += amt;
          won[seat] = (won[seat] || 0) + amt;
        });
        const nm = awarded.length > 1 ? (k === 0 ? T.mainPot.zh : `${T.sidePot.zh} ${k}`) : T.pot.zh;
        this._log(`${nm} ${fmt(p.amount)}${p.rake ? ` − ${T.rake.zh} ${fmt(p.rake)}` : ''} → ${p.winners.map((w) => `${this.seats[w].name} ${fmt(p.shares[w])}`).join('、')}`, { result: true });
      });
      if (!sawFlop) this._log('翻牌前結束：<i class="en">No flop, no drop</i>，不抽水', { result: true });
      else this._log(`${T.rake.zh} <i class="en">Rake</i>：${fmt(rake)}`, { result: true });
      this.totalRake += rake;
      this.result = {
        handNo: this.handNo, pots: awarded, uncalled, rake, potTotal, sawFlop, showdown, hands, won,
        board: this.board.slice(), button: this.button,
        net: this.seats.map((s) => (s.inHand ? s.stack - s.startStack : 0)),
      };
      this.phase = 'done';
    }
  }

  // ==========================================================================
  // §3 AI 對手
  // ==========================================================================
  const RV = { 2: 2, 3: 3, 4: 4, 5: 5, 6: 6, 7: 7, 8: 8, 9: 9, T: 10, J: 11, Q: 12, K: 13, A: 14 };
  const RCH = '23456789TJQKA';

  /** Chen 公式（起手牌分數） */
  function chen(hi, lo, suited) {
    const base = (r) => (r === 14 ? 10 : r === 13 ? 8 : r === 12 ? 7 : r === 11 ? 6 : r / 2);
    let sc = base(hi);
    if (hi === lo) return Math.max(5, sc * 2);
    if (suited) sc += 2;
    const gap = hi - lo - 1;
    sc -= gap === 0 ? 0 : gap === 1 ? 1 : gap === 2 ? 2 : gap === 3 ? 4 : 5;
    if (gap <= 1 && hi < 12) sc += 1;
    return Math.ceil(sc);
  }

  /** 169 種起手牌依 Chen 分數排序 → 百分位（0 = 最強，AA） */
  const HAND_PCT = (() => {
    const list = [];
    for (let a = 14; a >= 2; a--) {
      for (let b = a; b >= 2; b--) {
        const ka = RCH[a - 2], kb = RCH[b - 2];
        if (a === b) list.push({ key: ka + kb, score: chen(a, b, false), combos: 6, kind: 2, a, b });
        else {
          list.push({ key: ka + kb + 's', score: chen(a, b, true), combos: 4, kind: 1, a, b });
          list.push({ key: ka + kb + 'o', score: chen(a, b, false), combos: 12, kind: 0, a, b });
        }
      }
    }
    list.sort((x, y) => (y.score - x.score) || (y.kind - x.kind) || (y.a - x.a) || (y.b - x.b));
    const out = {};
    let cum = 0;
    for (const h of list) { out[h.key] = cum / 1326; cum += h.combos; }
    return out;
  })();

  function handKey(hole) {
    const [x, y] = hole;
    let a = RV[x.rank], b = RV[y.rank];
    if (b > a) [a, b] = [b, a];
    const k = RCH[a - 2] + RCH[b - 2];
    return a === b ? k : k + (x.suit === y.suit ? 's' : 'o');
  }
  /** 起手牌百分位 0–1（0 = 最強） */
  const handPct = (hole) => HAND_PCT[handKey(hole)];

  const PERSONAS = {
    TAG: { id: 'TAG', zh: '緊兇', en: 'TAG', range: 0.20, threeBet: 0.05, open: 3, bias: 0, margin: 0.04, betFrac: 0.6, drawFrac: 0.5, bluff: 0.04, raiseT: 0.1, callRange: 0.5 },
    LAG: { id: 'LAG', zh: '鬆兇', en: 'LAG', range: 0.40, threeBet: 0.15, open: 3, bias: 0.03, margin: 0, betFrac: 0.85, drawFrac: 0.75, bluff: 0.25, raiseT: 0.05, callRange: 0.8 },
    STATION: { id: 'STATION', zh: '跟注站', en: 'Station', range: 0.50, threeBet: 0.02, open: 2.5, bias: 0.06, margin: -0.1, betFrac: 0.45, drawFrac: 0, bluff: 0.02, raiseT: 0.2, callRange: 1 },
  };
  const PERSONA_IDS = Object.keys(PERSONAS);

  /** 門檻：勝率相對於「人人平均」的倍數 */
  function thresholds(nOpp) {
    const fair = 1 / (nOpp + 1);
    return { fair, strong: Math.min(0.85, fair * 1.7), good: Math.min(0.7, fair * 1.2) };
  }

  /** 把目標「加注到」金額修正為合法值；剩很少就全下 */
  function sizeTo(L, target) {
    if (!L.canRaise) return L.toCall > 0 ? { type: 'call' } : { type: 'check' };
    let to = Math.round(target);
    if (to < L.minTo) to = L.minTo;
    if (to >= L.maxTo * 0.85) to = L.maxTo;
    return { type: 'raise', to };
  }

  /**
   * AI 決策：LG.poker.equity(hole, board, nOpp, 300) + 底池賠率 + 性格偏移 + 10% 隨機。
   * @returns {{type, to?, reason:string, eq:number}}
   */
  function aiDecide(t, i, { iters = RULES.aiIters, rnd = () => LG.rng.random() } = {}) {
    const s = t.seats[i];
    const L = t.legal(i);
    const P = PERSONAS[s.persona] || PERSONAS.TAG;
    const nOpp = Math.max(1, t.liveSeats().length - 1);
    const pot = L.pot;
    const odds = L.toCall > 0 ? L.toCall / (pot + L.toCall) : 0;
    let eq = LG.poker.equity(s.hole, t.board, nOpp, iters) + P.bias;
    const noisy = rnd() < 0.10;                         // 10% 隨機性
    if (noisy) eq += (rnd() - 0.5) * 0.3;
    const { strong, good } = thresholds(nOpp);
    const passive = () => (L.canCheck ? { type: 'check' } : { type: 'fold' });
    let d;
    if (t.street === 'preflop') {
      const pct = handPct(s.hole);
      const facingRaise = t.currentBet > t.bb;
      if (!facingRaise) {
        const limpers = t.seats.filter((o) => o.inHand && !o.folded && o.idx !== t.pos.bb && o.idx !== t.pos.sb && o.bet === t.bb).length;
        if (pct <= P.range && !(P.id === 'STATION' && pct > 0.08)) d = { ...sizeTo(L, (P.open + limpers) * t.bb), reason: 'open' };
        else if (pct <= P.range) d = { type: L.canCheck ? 'check' : 'call', reason: 'limp' };
        else if (noisy && L.toCall <= t.bb) d = { type: L.canCheck ? 'check' : 'call', reason: 'random' };
        else d = { ...passive(), reason: 'range' };
      } else if (pct <= P.threeBet && L.canRaise) d = { ...sizeTo(L, t.currentBet * 3), reason: '3bet' };
      else if (pct <= P.range * P.callRange && eq >= odds - 0.05) d = { type: 'call', reason: 'call-range' };
      else if (P.id === 'STATION' && pct <= P.range && L.toCall <= s.stack * 0.3) d = { type: 'call', reason: 'station' };
      else if (eq >= odds + 0.1) d = { type: 'call', reason: 'odds' };
      else d = { ...passive(), reason: 'fold' };
    } else if (L.toCall === 0) {
      if (eq >= strong || (eq >= good && P.id !== 'STATION')) d = { ...sizeTo(L, P.betFrac * pot), reason: 'value' };
      else if (P.drawFrac && t.street !== 'river' && LG.poker.outs(s.hole, t.board) >= 8) d = { ...sizeTo(L, P.drawFrac * pot), reason: 'draw' };
      else if (rnd() < P.bluff) d = { ...sizeTo(L, 0.75 * pot), reason: 'bluff' };
      else d = { type: 'check', reason: 'check' };
    } else if (eq >= strong + P.raiseT && L.canRaise) d = { ...sizeTo(L, t.currentBet + 0.8 * (pot + L.toCall)), reason: 'raise' };
    else if (eq >= odds + P.margin) d = { type: 'call', reason: 'odds' };
    else if (P.id === 'STATION' && t.street !== 'river' && eq >= 0.1) d = { type: 'call', reason: 'station' };
    else if (P.id === 'LAG' && L.canRaise && rnd() < 0.08) d = { ...sizeTo(L, t.currentBet + (pot + L.toCall)), reason: 'bluff-raise' };
    else d = { type: 'fold', reason: 'fold' };
    // 正規化成合法動作
    if (d.type === 'check' && !L.canCheck) d.type = 'fold';
    if (d.type === 'call' && L.toCall === 0) d.type = 'check';
    if (d.type === 'fold' && L.canCheck) d.type = 'check';
    d.eq = eq;
    return d;
  }

  // ==========================================================================
  // §4 提示與解說（純函式）
  // ==========================================================================
  const pctStr = (x) => `${Math.round(Math.max(0, Math.min(1, x)) * 100)}%`;

  /** 底池賠率文字：底池 60、跟 20 → '3:1'、需要 25% */
  function potOdds(pot, toCall) {
    if (!(toCall > 0)) return { ratio: null, need: 0, text: '免費看牌（不用跟注）' };
    const ratio = pot / toCall;
    const need = toCall / (pot + toCall);
    const r = Number.isInteger(Math.round(ratio * 10) / 10) ? String(Math.round(ratio)) : ratio.toFixed(1);
    return { ratio, need, text: `${r}:1（需要 ${pctStr(need)} 勝率）` };
  }

  /**
   * 練習提示：建議動作 + 一句理由。
   * @returns {{eq, need, oddsText, action:'fold'|'check'|'call'|'bet'|'raise', label, reason}}
   */
  function advise(t, i, eq) {
    const s = t.seats[i];
    const L = t.legal(i);
    const nOpp = Math.max(1, t.liveSeats().length - 1);
    const { fair, strong, good } = thresholds(nOpp);
    const po = potOdds(L.pot, L.toCall);
    const pre = t.street === 'preflop' ? `起手牌約在前 ${Math.max(1, Math.round(handPct(s.hole) * 100))}%。` : '';
    let action, reason;
    if (L.toCall === 0) {
      if (eq >= good && L.canRaise) {
        action = L.isBet ? 'bet' : 'raise';
        reason = `${pre}勝率 ${pctStr(eq)} 高於 ${nOpp + 1} 人平均 ${pctStr(fair)}，下注讓較差的牌付錢。`;
      } else { action = 'check'; reason = `${pre}勝率 ${pctStr(eq)} 不突出，過牌免費看下一張。`; }
    } else if (eq >= strong && L.canRaise) {
      action = 'raise'; reason = `${pre}勝率 ${pctStr(eq)} 遠高於需要的 ${pctStr(po.need)}，加注拿更多價值。`;
    } else if (eq >= po.need) {
      action = 'call'; reason = `${pre}勝率 ${pctStr(eq)} ≥ 底池賠率需要的 ${pctStr(po.need)}，長期跟注有利。`;
    } else {
      action = 'fold'; reason = `${pre}勝率 ${pctStr(eq)} < 需要的 ${pctStr(po.need)}，跟注長期虧。`;
    }
    const label = { fold: '棄牌 Fold', check: '過牌 Check', call: '跟注 Call', bet: '下注 Bet', raise: '加注 Raise' }[action];
    return { eq, need: po.need, oddsText: po.text, action, label, reason };
  }

  /** 練習/教學結果面板四段（hand / result / formula / why） */
  function explainHand(t, humanIdx, { showPersona = true } = {}) {
    const r = t.result;
    const h = t.seats[humanIdx];
    const name = (i) => (i === humanIdx ? '你' : t.seats[i].name);
    const personaTag = (s) => (showPersona && s.persona ? `（${PERSONAS[s.persona].zh} <i class="en">${PERSONAS[s.persona].en}</i>）` : '');
    const hand = [];
    hand.push(`你 <i class="en">You</i>：<b>${cardsText(h.hole)}</b>${r.hands[humanIdx] ? ' → ' + LG.poker.describe(r.hands[humanIdx]) : h.folded ? '（已棄牌）' : ''}`);
    hand.push(`公共牌 <i class="en">Board</i>：${r.board.length ? `<b>${cardsText(r.board)}</b>` : '（沒發）'}`);
    t.seats.forEach((s) => {
      if (s.idx === humanIdx || !s.shown) return;
      hand.push(`${s.name}${personaTag(s)}：<b>${cardsText(s.hole)}</b> → ${LG.poker.describe(r.hands[s.idx])}`);
    });

    const potName = (k) => (r.pots.length > 1 ? (k === 0 ? `主池 <i class="en">Main pot</i>` : `邊池 ${k} <i class="en">Side pot</i>`) : `底池 <i class="en">Pot</i>`);
    const got = (r.won[humanIdx] || 0) + (r.uncalled && r.uncalled.seat === humanIdx ? r.uncalled.amount : 0);
    const wagered = h.committed - (r.uncalled && r.uncalled.seat === humanIdx ? r.uncalled.amount : 0);
    const net = h.stack - h.startStack;

    const res = r.pots.map((p, k) => `${potName(k)}：${p.winners.map(name).join('、')}${p.winners.length > 1 ? ' 平分' : ' 贏'}`);
    const head = h.folded ? '你棄牌 <i class="en">Fold</i>。' : net > 0 ? '你贏了！' : net < 0 ? '你輸了這手。' : '打平。';
    const result = head + '<br>' + res.join('<br>');

    const f = [];
    const rawRake = Math.round(r.potTotal * RULES.rakePct * 100) / 100;
    if (r.uncalled) f.push(`未被跟注的 ${fmt(r.uncalled.amount)} 退回給 ${name(r.uncalled.seat)}（不算進底池）`);
    if (r.sawFlop) {
      f.push(`抽水 <i class="en">Rake</i>：${fmt(r.potTotal)} × 5% = ${fmt(rawRake, { cents: rawRake % 1 !== 0 })}`
        + (rawRake > RULES.rakeCap ? ` → 上限 ${fmt(RULES.rakeCap)}` : rawRake % 1 ? ` → 取整 ${fmt(r.rake)}` : ''));
    } else f.push(`翻牌前結束：<i class="en">No flop, no drop</i>，抽水 RM 0`);
    r.pots.forEach((p, k) => {
      f.push(`${potName(k)} ${fmt(p.amount)}${p.rake ? ` − 抽水 ${fmt(p.rake)} = ${fmt(p.net)}` : ''} → ${p.winners.map((w) => `${name(w)} ${fmt(p.shares[w])}`).join('、')}`);
    });
    f.push(`你投入 ${fmt(wagered)}，拿回 ${fmt(got)} → 淨 <b>${fmtSigned(net)}</b>`);

    const why = [];
    if (r.showdown) {
      const main = r.pots[0];
      const w = main.winners;
      const wh = r.hands[w[0]];
      const losers = main.eligible.filter((x) => !w.includes(x));
      if (w.length > 1) {
        why.push(`${w.map(name).join('、')} 都是 ${LG.poker.describe(wh)}，平分底池。`);
        const odd = main.net % w.length;
        if (odd) why.push(`除不盡的 ${fmt(odd)} 奇數籌碼給按鈕左側第一位（${name(w[0])}）。`);
      } else if (losers.length) {
        why.push(`${name(w[0])}的 ${LG.poker.describe(wh)} 大過 ${losers.map((x) => `${name(x)}的 ${LG.poker.describe(r.hands[x])}`).join('、')}。`);
      }
      if (r.pots.length > 1) why.push('有人全下 <i class="en">All-in</i> 金額較小：他只能贏他跟得起的主池，多出的錢另成邊池。');
    } else {
      const w = r.pots[0].winners[0];
      why.push(`${name(w)}下注後其他人都棄牌，不用亮牌就贏。`);
    }
    if (h.folded && h.committed > 0) why.push(`你棄牌後，已放進底池的 ${fmt(h.committed)} 就拿不回來。`);
    if (!r.sawFlop) why.push('這手沒看到翻牌，賭場不抽水。');
    return { hand: hand.join('<br>'), result, formula: f.join('<br>'), why: why.join(''), net, wagered };
  }

  /** 13×13 起手牌表（對角 = 對子；右上 = 同花 s；左下 = 不同花 o） */
  function handChartHtml() {
    const R = 'AKQJT98765432';
    let h = '<table class="lg-datatable pr-chart"><tbody>';
    for (let r = 0; r < 13; r++) {
      h += '<tr>';
      for (let c = 0; c < 13; c++) {
        const a = R[Math.min(r, c)], b = R[Math.max(r, c)];
        const key = r === c ? a + b : a + b + (c > r ? 's' : 'o');
        const p = HAND_PCT[key];
        const tier = p < 0.2 ? 't1' : p < 0.4 ? 't2' : p < 0.5 ? 't3' : 't4';
        h += `<td class="pr-chart__${tier}">${key.replace(/[so]$/, (m) => `<small>${m}</small>`)}</td>`;
      }
      h += '</tr>';
    }
    h += '</tbody></table>';
    h += '<p class="pr-chart__key"><span class="pr-chart__t1">前 20% 緊兇 TAG</span> <span class="pr-chart__t2">前 40% 鬆兇 LAG</span> <span class="pr-chart__t3">前 50%</span></p>';
    return h;
  }

  const logic = {
    RULES, Table, rakeFor, buildPots, splitAmount, awardPots, aiDecide, advise, potOdds, explainHand,
    handPct, handKey, chen, PERSONAS, thresholds,
  };

  // ==========================================================================
  // §5 UI
  // ==========================================================================
  // 座位位置（百分比：left, top），依總人數
  const SLOTS = {
    2: [[50, 86], [50, 12]],
    3: [[50, 86], [14, 30], [86, 30]],
    4: [[50, 86], [13, 48], [50, 12], [87, 48]],
    5: [[50, 86], [13, 58], [27, 12], [73, 12], [87, 58]],
    6: [[50, 86], [13, 64], [13, 30], [50, 11], [87, 30], [87, 64]],
  };
  const sideOf = ([x, y]) => (y > 75 ? 'bottom' : y < 20 ? 'top' : x < 50 ? 'left' : 'right');

  LG.registerGame({
    id: 'poker-room',
    category: 'poker-room',
    order: 1,
    name: { zh: '德州撲克現金桌', en: "Texas Hold'em Cash Game" },
    summary: '6 人 No Limit 德州撲克，跟 AI 玩家對打；賭場只抽水。',
    houseEdge: [
      { bet: { zh: '無莊家優勢（抽水 5%，上限 RM 50）', en: 'No house edge — 5% rake, cap RM 50' }, edge: 0, best: true, rake: true },
    ],
    // 撲克室沒有「限注」：min/max 用買入範圍（checkBroke 以 RM 400 判斷能不能再買入）
    limits: { real: { min: RULES.buyInMin, max: RULES.buyInMax }, practice: { min: RULES.buyInMin, max: RULES.buyInMax } },
    countdown: RULES.actSeconds,
    logic,

    create(ctx) {
      const S = {
        table: null, humanIdx: 0, phase: 'setup',   // setup | idle | hand
        handsStarted: 0, handsPlayed: 0, humanActions: 0, lastQuick: null,
        boughtIn: 0, history: [], resolveHuman: null, timer: null, modal: null,
        nOpp: 5, usedNames: new Set(), hint: null, shownBoard: 0, historyOpened: false, timeouts: 0, resultPanel: null,
      };
      const isTut = ctx.isTutorial;
      let root, tableEl, ovalEl, seatsEl, potEl, sidePotsEl, boardEl, statusEl, dbtnEl;
      let actionsEl, dealBtn, foldBtn, callBtn, raiseBtn, raiseRow, slider, amtEl, hintEl, barEl, historyEl, historyBody;
      let seatEls = [];

      // ------------------------------------------------------------ 座位 / 玩家
      function pickName() {
        const pool = T.names.filter((n) => !S.usedNames.has(n));
        const nm = pool.length ? LG.rng.pick(pool) : `AI ${S.usedNames.size + 1}`;
        S.usedNames.add(nm);
        return nm;
      }
      function newAI(k) {
        return { name: pickName(), stack: LG.rng.int(8, 20) * 50, persona: LG.rng.pick(PERSONA_IDS), idx: k };
      }
      function createTable(nOpp, humanStack) {
        const players = [{ name: '你', stack: humanStack, isHuman: true }];
        if (isTut) {
          ['TAG', 'LAG', 'STATION'].forEach((p, k) => { S.usedNames.add(T.tutorialNames[k]); players.push({ name: T.tutorialNames[k], stack: 1000, persona: p }); });
        } else for (let k = 0; k < nOpp; k++) players.push(newAI(k + 1));
        S.table = new Table({ players, button: isTut ? 0 : LG.rng.int(0, players.length - 1) });
        buildSeats();
      }

      // ------------------------------------------------------------ 桌面 DOM（一次建好）
      function buildTable() {
        potEl = el('div.pr-pot', { html: `${term(T.pot.zh, T.pot.en.toUpperCase())} <b>${fmt(0)}</b>` });
        sidePotsEl = el('div.pr-sidepots');
        boardEl = el('div.pr-board', { 'aria-label': '公共牌 Community cards' },
          [0, 1, 2, 3, 4].map((k) => el('div.pr-board__slot', { dataset: { slot: k } })));
        statusEl = el('div.pr-status', { 'aria-live': 'polite' });
        seatsEl = el('div.pr-seats');
        dbtnEl = el('span.pr-dbtn', { title: '按鈕 Dealer button', text: 'D' });
        ovalEl = el('div.pr-oval', [
          el('div.pr-rail'),
          el('div.pr-center', [potEl, boardEl, sidePotsEl]),
          seatsEl,
        ]);
        tableEl = el('div.lg-table.pr-table', [ovalEl]);

        foldBtn = el('button', { type: 'button', class: 'lg-btn pr-btn pr-btn--fold', dataset: { action: 'fold' }, html: btnLabel(T.fold.zh, T.fold.en), on: { click: () => submit({ type: 'fold' }) } });
        callBtn = el('button', { type: 'button', class: 'lg-btn pr-btn pr-btn--call', dataset: { action: 'call' }, on: { click: onCall } });
        raiseBtn = el('button', { type: 'button', class: 'lg-btn lg-btn--primary pr-btn pr-btn--raise', dataset: { action: 'raise' }, on: { click: onRaise } });
        dealBtn = el('button', { type: 'button', class: 'lg-btn lg-btn--primary lg-deal pr-deal', dataset: { action: 'deal' }, html: term(T.deal.zh, T.deal.en), hidden: true, on: { click: onDeal } });
        actionsEl = el('div.lg-actions.pr-actions', [dealBtn, foldBtn, callBtn, raiseBtn]);

        slider = el('input', { type: 'range', class: 'pr-raise__slider', min: 0, max: 0, step: 1, 'aria-label': '加注金額 Raise amount' });
        slider.addEventListener('input', () => { S.lastQuick = null; paintRaise(); });
        amtEl = el('output.pr-raise__amt');
        const quick = (id, label) => el('button', { type: 'button', class: 'lg-btn lg-btn--sm pr-quick', dataset: { size: id }, text: label, on: { click: () => onQuick(id) } });
        raiseRow = el('div.pr-raise', [
          el('div.pr-raise__top', [el('span.pr-raise__k', { html: term('金額', 'Amount') }), amtEl]),
          slider,
          el('div.pr-raise__quick', [quick('half', T.quick.half), quick('threeq', T.quick.threeq), quick('pot', T.quick.pot), quick('allin', T.quick.allin)]),
        ]);
        hintEl = el('div.lg-hint.pr-hint', { hidden: true, 'aria-live': 'polite' });
        barEl = el('div.pr-bar');
        historyBody = el('div.pr-history__body');
        historyEl = el('details.pr-history', [el('summary', { html: term(T.history.zh, T.history.en) }), historyBody]);
        historyEl.addEventListener('toggle', () => { if (historyEl.open) S.historyOpened = true; });

        root.append(statusEl, tableEl, actionsEl, raiseRow, hintEl, barEl, historyEl);
        setActionsEnabled(false);
      }

      function buildSeats() {
        const t = S.table;
        seatsEl.innerHTML = '';
        const slots = SLOTS[t.n] || SLOTS[6];
        seatEls = t.seats.map((s, i) => {
          const [x, y] = slots[i];
          const e = el('div', {
            class: ['pr-seat', s.isHuman && 'pr-seat--you'], dataset: { seat: i, side: sideOf(slots[i]) },
            style: { left: x + '%', top: y + '%' },
          }, [
            el('div.pr-seat__cards'),
            el('div.pr-seat__box', [
              el('div.pr-seat__name'),
              el('div.pr-seat__stack'),
              el('div.pr-seat__tag', { hidden: true }),
              el('span.pr-pos', { hidden: true }),
            ]),
            el('div.pr-seat__act'),
            el('div.pr-seat__bet'),
          ]);
          seatsEl.appendChild(e);
          return e;
        });
        paintAll();
      }

      // ------------------------------------------------------------ 繪製
      function paintAll() {
        if (!S.table) return;
        S.table.seats.forEach((s, i) => paintSeat(i));
        paintCenter();
        paintStatus();
        paintBar();
        paintHistory();
      }

      function seatCardsKey(s, faceUp) { return s.inHand && !s.folded ? s.hole.map((c) => c.id).join('') + (faceUp ? '+' : '-') : s.folded && s.inHand ? 'folded' : 'none'; }

      function paintSeat(i) {
        const t = S.table, s = t.seats[i], e = seatEls[i];
        if (!e) return;
        const showPersona = !ctx.isReal && s.persona && s.shown;
        e.querySelector('.pr-seat__name').innerHTML = `${ui.esc(s.name)}${s.isHuman ? ' <i class="en">You</i>' : ''}`;
        const tagEl = e.querySelector('.pr-seat__tag');
        tagEl.innerHTML = showPersona ? `<span class="pr-tag pr-tag--${s.persona.toLowerCase()}">${PERSONAS[s.persona].zh} <i class="en">${PERSONAS[s.persona].en}</i></span>` : '';
        tagEl.hidden = !showPersona;
        e.querySelector('.pr-seat__stack').textContent = fmt(s.stack);
        const playing = t.phase !== 'idle';
        e.classList.toggle('is-turn', t.phase === 'play' && t.toAct === i);
        e.classList.toggle('is-folded', playing && s.inHand && s.folded);
        e.classList.toggle('is-out', playing && !s.inHand);
        e.classList.toggle('is-allin', s.allIn && t.phase === 'play');
        const won = t.phase === 'done' && t.result && t.result.won[i] > 0;
        e.classList.toggle('is-winner', !!won);

        // 暗牌
        const faceUp = s.isHuman || s.shown;
        const key = seatCardsKey(s, faceUp);
        const cardsEl = e.querySelector('.pr-seat__cards');
        if (cardsEl.dataset.key !== key) {
          cardsEl.dataset.key = key;
          cardsEl.innerHTML = '';
          if (s.inHand && s.hole.length && (!s.folded || s.isHuman)) {
            s.hole.forEach((c) => cardsEl.appendChild(ui.card(faceUp ? c : null, { faceDown: !faceUp, size: s.isHuman ? 'md' : 'sm', dim: s.folded })));
          }
        }
        // 下注籌碼
        const betEl = e.querySelector('.pr-seat__bet');
        const betAmt = t.phase === 'play' ? s.bet : 0;
        if (Number(betEl.dataset.amount || 0) !== betAmt) {
          betEl.dataset.amount = String(betAmt);
          betEl.innerHTML = '';
          if (betAmt > 0) betEl.appendChild(ui.chipStack(betAmt));
        }
        // 動作文字
        const actEl = e.querySelector('.pr-seat__act');
        let act = '';
        if (won) act = `贏 +${fmt(t.result.won[i])}`;
        else if (t.phase === 'done' && s.shown && t.result.hands[i] && !ctx.isReal) act = t.result.hands[i].name.zh;
        else if (playing && s.lastAction) act = actionText(s.lastAction.type, s.lastAction.type === 'fold' || s.lastAction.type === 'check' ? 0 : s.lastAction.amount);
        actEl.innerHTML = act;
        actEl.hidden = !act;
        // 位置：D / SB / BB
        const pos = t.phase === 'idle' ? t.positions() : t.pos;
        const posEl = e.querySelector('.pr-pos');
        const tag = pos ? (pos.sb === i ? 'SB' : pos.bb === i ? 'BB' : '') : '';
        posEl.textContent = tag;
        posEl.hidden = !tag;
        posEl.title = tag === 'BB' ? '大盲 Big blind RM 10' : tag ? '小盲 Small blind RM 5' : '';
        if (pos && pos.button === i && dbtnEl.parentNode !== e) e.appendChild(dbtnEl);
      }

      function paintCenter() {
        const t = S.table;
        const pot = t.phase === 'play' ? t.potTotal() : t.phase === 'done' ? t.result.potTotal : 0;
        potEl.innerHTML = `${term(T.pot.zh, T.pot.en.toUpperCase())} <b>${fmt(pot)}</b>`
          + (t.phase === 'done' && t.result.sawFlop ? `<span class="pr-pot__rake">${term(T.rake.zh, T.rake.en)} ${fmt(t.result.rake)}</span>` : '')
          + (t.phase === 'done' && !t.result.sawFlop ? '<span class="pr-pot__rake">No flop no drop</span>' : '');
        potEl.dataset.pot = String(pot);
        // 邊池
        let side = '';
        if (t.phase === 'play' && t.seats.some((s) => s.allIn && s.inHand && !s.folded)) {
          const { pots } = t.potsNow();
          if (pots.length > 1) side = pots.map((p, k) => `${k ? `${T.sidePot.zh} ${k}` : T.mainPot.zh} ${fmt(p.amount)}`).join(' · ');
        } else if (t.phase === 'done' && t.result.pots.length > 1) {
          side = t.result.pots.map((p, k) => `${k ? `${T.sidePot.zh} ${k}` : T.mainPot.zh} ${fmt(p.amount)}`).join(' · ');
        }
        sidePotsEl.textContent = side;
        sidePotsEl.hidden = !side;
        // 公共牌（依 S.shownBoard 逐街揭露）
        const slots = boardEl.children;
        for (let k = 0; k < 5; k++) {
          const c = k < S.shownBoard ? t.board[k] : null;
          const slot = slots[k];
          const id = c ? c.id : '';
          if (slot.dataset.id === id) continue;
          slot.dataset.id = id;
          slot.innerHTML = '';
          if (c) {
            const ce = ui.card(c, { faceDown: true, size: 'sm' });
            slot.appendChild(ce);
            ui.flip(ce, c);
          }
        }
      }

      function paintStatus() {
        const t = S.table;
        let txt;
        if (!t) txt = '買入後入座 <i class="en">Buy in to sit</i>';
        else if (t.phase === 'play') {
          const who = t.seats[t.toAct];
          txt = `#${t.handNo} ${streetText(t.street)} · ${who ? (who.isHuman ? `<b>${term(T.yourTurn.zh, T.yourTurn.en)}</b>` : `輪到 ${ui.esc(who.name)}`) : ''}`;
        } else if (t.phase === 'done') txt = `#${t.handNo} 結束 <i class="en">Hand over</i>`;
        else txt = term(T.waiting.zh, T.waiting.en);
        statusEl.innerHTML = txt;
      }

      function paintBar() {
        const t = S.table;
        const h = t ? t.seats[S.humanIdx] : null;
        const stack = h ? h.stack + (t.phase === 'play' ? h.committed : 0) : 0;
        const sessionNet = h ? stack - S.boughtIn : 0;
        barEl.innerHTML = '';
        barEl.append(
          el('div.pr-bar__kv', { html: `${term(T.stack.zh, T.stack.en)} <b>${fmt(h ? h.stack : 0)}</b>` }),
          el('div.pr-bar__kv', { html: `${term(T.hands.zh, T.hands.en)} <b>${S.handsPlayed}</b>` }),
          isTut ? el('div.pr-bar__kv', { html: '教學示範籌碼 <i class="en">Demo chips</i>' })
            : el('div.pr-bar__kv', { html: `盈虧 <i class="en">Net</i> <b class="${sessionNet > 0 ? 'lg-win' : sessionNet < 0 ? 'lg-lose' : ''}">${fmtSigned(sessionNet)}</b>` }),
          isTut ? null : el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-btn--ghost pr-leave', dataset: { action: 'leave-table' }, html: term(T.leave.zh, T.leave.en), on: { click: onLeave } }),
        );
      }

      function paintHistory() {
        const t = S.table;
        const cur = t && t.phase !== 'idle' ? handHistoryHtml(t.handNo, t.log, t.phase === 'done' ? null : '進行中') : '';
        const past = S.history.slice().reverse().filter((x) => !(t && t.phase !== 'idle' && x.handNo === t.handNo));
        historyBody.innerHTML = (cur || '') + past.map((x) => x.html).join('') || '<p class="lg-muted">還沒有手牌。</p>';
      }
      function handHistoryHtml(no, log, tag) {
        const byStreet = [];
        let cur = null;
        log.forEach((l) => {
          const st = l.result ? 'result' : l.street || 'preflop';
          if (!cur || cur.st !== st) { cur = { st, lines: [] }; byStreet.push(cur); }
          cur.lines.push(l.text);
        });
        return `<div class="pr-hh" data-hand="${no}"><div class="pr-hh__head">第 ${no} 手 <i class="en">Hand #${no}</i>${tag ? ` · ${tag}` : ''}</div>`
          + byStreet.map((b) => `<div class="pr-hh__st"><b>${b.st === 'result' ? '結果 <i class="en">Result</i>' : streetText(b.st)}</b> ${b.lines.join('；')}</div>`).join('')
          + '</div>';
      }

      // ------------------------------------------------------------ 動作列
      function setActionsEnabled(on) {
        [foldBtn, callBtn, raiseBtn].forEach((b) => { b.disabled = !on; });
        raiseRow.querySelectorAll('button, input').forEach((b) => { b.disabled = !on; });
        raiseRow.classList.toggle('is-disabled', !on);
        actionsEl.classList.toggle('is-waiting', !on);
      }

      function paintActions() {
        const t = S.table;
        const myTurn = t && t.phase === 'play' && t.toAct === S.humanIdx && !!S.resolveHuman;
        const showDeal = !ctx.isReal && !!t && S.phase === 'idle';
        dealBtn.hidden = !showDeal;
        [foldBtn, callBtn, raiseBtn].forEach((b) => { b.hidden = showDeal; });
        if (!myTurn) {
          setActionsEnabled(false);
          callBtn.innerHTML = btnLabel(`${T.check.zh}/${T.call.zh}`, 'Check / Call');
          raiseBtn.innerHTML = btnLabel(`${T.bet.zh}/加注`, 'Bet / Raise');
          amtEl.textContent = '—';
          return;
        }
        setActionsEnabled(true);
        const L = t.legal(S.humanIdx);
        callBtn.innerHTML = L.toCall === 0 ? btnLabel(T.check.zh, T.check.en)
          : btnLabel(T.call.zh, L.toCall >= t.seats[S.humanIdx].stack ? 'Call · All-in' : T.call.en, L.toCall);
        if (!L.canRaise) {
          raiseBtn.disabled = true;
          raiseRow.querySelectorAll('button, input').forEach((b) => { b.disabled = true; });
          raiseRow.classList.add('is-disabled');
        }
        slider.min = String(L.minTo);
        slider.max = String(L.maxTo);
        if (!(Number(slider.value) >= L.minTo && Number(slider.value) <= L.maxTo) || S.sliderHand !== `${t.handNo}-${t.street}-${t.currentBet}`) {
          slider.value = String(L.minTo);
          S.sliderHand = `${t.handNo}-${t.street}-${t.currentBet}`;
        }
        paintRaise();
      }

      function raiseTarget() {
        const t = S.table;
        const L = t.legal(S.humanIdx);
        let v = Math.round(Number(slider.value) || L.minTo);
        v = Math.max(L.minTo, Math.min(L.maxTo, v));
        return { L, to: v };
      }
      function paintRaise() {
        const t = S.table;
        if (!t || t.phase !== 'play') return;
        const { L, to } = raiseTarget();
        const allIn = to >= L.maxTo;
        amtEl.textContent = fmt(to);
        raiseBtn.innerHTML = allIn ? btnLabel(T.allin.zh, T.allin.en, to)
          : L.isBet ? btnLabel(T.bet.zh, T.bet.en, to) : btnLabel(T.raise.zh, T.raise.en, to);
        raiseRow.querySelectorAll('[data-size]').forEach((b) => b.classList.toggle('is-on', b.dataset.size === S.lastQuick));
      }

      /** ½池 / ¾池 / 池 / 全下：加注到 = 目前最高注 + 比例 ×（底池 + 跟注額） */
      function quickTo(id) {
        const t = S.table;
        const L = t.legal(S.humanIdx);
        if (id === 'allin') return L.maxTo;
        const frac = id === 'half' ? 0.5 : id === 'threeq' ? 0.75 : 1;
        const target = L.currentBet + frac * (L.pot + L.toCall);
        return Math.max(L.minTo, Math.min(L.maxTo, Math.round(target)));
      }
      function onQuick(id) {
        if (!S.resolveHuman) return;
        S.lastQuick = id;
        slider.value = String(quickTo(id));
        paintRaise();
      }
      function onCall() {
        const L = S.table.legal(S.humanIdx);
        submit({ type: L.toCall === 0 ? 'check' : 'call' });
      }
      function onRaise() {
        const { L, to } = raiseTarget();
        if (!L.canRaise) return;
        submit({ type: 'raise', to });
      }

      function humanTurn() {
        return new Promise((resolve) => {
          S.resolveHuman = resolve;
          paintActions();
          paintStatus();
          paintHint();
          if (ctx.isReal) {
            ctx.dealer.say('輪到你', 'Your action');
            S.timer = ui.countdown(RULES.actSeconds, {
              onDone: () => { S.timer = null; S.timeouts += 1; const L = S.table.legal(S.humanIdx); ui.toast('時間到：自動' + (L.canCheck ? '過牌 Check' : '棄牌 Fold')); submit({ type: L.canCheck ? 'check' : 'fold' }, true); },
            });
          }
        });
      }
      function submit(a, auto) {
        if (!S.resolveHuman) return;
        const r = S.resolveHuman;
        S.resolveHuman = null;
        if (S.timer) { S.timer.cancel(); S.timer = null; }
        if (!auto) S.humanActions += 1;
        setActionsEnabled(false);
        hintEl.hidden = true;
        r(a);
      }

      // ------------------------------------------------------------ 練習提示
      function paintHint() {
        const t = S.table;
        const myTurn = t && t.phase === 'play' && t.toAct === S.humanIdx && S.resolveHuman;
        if (!ctx.hints || !myTurn) { hintEl.hidden = true; return; }
        const key = `${t.handNo}-${t.street}-${t.currentBet}-${t.board.length}`;
        if (!S.hint || S.hint.key !== key) {
          const h = t.seats[S.humanIdx];
          const nOpp = Math.max(1, t.liveSeats().length - 1);
          const eq = LG.poker.equity(h.hole, t.board, nOpp, RULES.hintIters);
          S.hint = { key, ...advise(t, S.humanIdx, eq) };
        }
        const a = S.hint;
        hintEl.hidden = false;
        hintEl.innerHTML = `<b>提示</b>：勝率 <b>${pctStr(a.eq)}</b>（模擬 1,000 次）· 底池賠率 ${a.oddsText} → 建議 <b>${a.label}</b><br><span class="pr-hint__why">${a.reason}</span>`;
      }

      // ------------------------------------------------------------ 一手流程
      function onDeal() {
        if (S.phase !== 'idle' || !S.table) return;
        runHand();
      }

      function tutorialPreset() {
        if (!isTut || S.handsStarted > 0) return {};
        const P = LG.cards.parseMany;
        return { holes: { 0: P('AS KS') }, board: P('KH 7D 2C 9S 4H') };
      }

      async function runHand() {
        const t = S.table;
        if (!t.positions()) { ui.toast('人數不足，無法開始'); return; }
        if (S.resultPanel) { S.resultPanel.close(); S.resultPanel = null; }
        S.phase = 'hand';
        S.shownBoard = 0;
        S.hint = null;
        t.startHand({ preset: tutorialPreset() });
        S.handsStarted += 1;
        ctx.dealer.say('發牌', 'Dealing');
        paintActions();
        paintAll();
        while (t.phase === 'play') {
          const i = t.toAct;
          paintAll();
          let a;
          if (t.seats[i].isHuman) {
            a = await humanTurn();
          } else {
            await ctx.wait(RULES.aiDelay[0] + LG.rng.random() * (RULES.aiDelay[1] - RULES.aiDelay[0]));
            if (!ctx.alive()) return;
            a = aiDecide(t, i);
          }
          if (!ctx.alive()) return;
          try { t.act(i, a); } catch (e) {
            LG.debug('illegal action → fallback', e.message);
            const L = t.legal(i);
            t.act(i, { type: L.canCheck ? 'check' : 'fold' });
          }
          paintActions();
          paintAll();
          await revealStreets();
          if (!ctx.alive()) return;
        }
        await revealStreets();
        if (!ctx.alive()) return;
        await endHand();
      }

      /** 公共牌逐街翻開（全下時一次跑完也會分段顯示） */
      async function revealStreets() {
        const t = S.table;
        while (S.shownBoard < t.board.length) {
          const next = S.shownBoard < 3 ? 3 : S.shownBoard + 1;
          const st = next === 3 ? 'flop' : next === 4 ? 'turn' : 'river';
          await ctx.wait(350);
          S.shownBoard = next;
          ctx.dealer.say(T.streets[st].zh, T.streets[st].en);
          paintCenter();
          await ctx.wait(450);
        }
      }

      async function endHand() {
        const t = S.table, r = t.result, h = t.seats[S.humanIdx];
        S.handsPlayed += 1;
        const ex = explainHand(t, S.humanIdx, { showPersona: !ctx.isReal });
        // 先記帳（等待動畫時離桌也不會漏記）
        if (h.inHand) ctx.recordRound({ wagered: ex.wagered, net: ex.net, outcome: ex.net > 0 ? 'win' : ex.net < 0 ? 'lose' : 'push' });
        if (r.showdown) ctx.dealer.say('攤牌', 'Showdown');
        paintAll();
        await ctx.wait(r.showdown ? 700 : 300);
        if (!ctx.alive()) return;
        ctx.dealer.say('派彩', 'Paying out');
        S.history.push({ handNo: t.handNo, html: handHistoryHtml(t.handNo, t.log) });
        if (S.history.length > 20) S.history.shift();
        if (h.inHand) {
          S.resultPanel = ctx.explain({
            title: `第 ${t.handNo} 手結果 <i class="en">Hand #${t.handNo}</i>`,
            hand: ex.hand, result: ex.result, formula: ex.formula, why: ex.why, net: ex.net,
            actions: ctx.isReal ? undefined : [
              { id: 'result-close', label: '收起 <i class="en">Close</i>' },
              { id: 'result-next', label: '下一手 <i class="en">Next hand</i>', primary: true, onClick: () => { if (S.phase === 'idle') setTimeout(onDeal, 0); } },
            ],
          });
        }
        S.phase = 'idle';
        replaceBustedAIs();
        paintAll();
        paintActions();
        if (h.stack <= 0) {
          if (isTut) { h.stack = 1000; ui.toast('教學示範籌碼已補滿 RM 1,000'); paintAll(); ctx.nextRound(afterHand); return; }
          ctx.nextRound(() => openBuyIn({ rebuy: true }));
          return;
        }
        ctx.nextRound(afterHand);
      }

      function afterHand() {
        if (!ctx.alive() || S.phase !== 'idle') return;
        if (ctx.isReal) runHand();
        else { paintActions(); }
      }

      function replaceBustedAIs() {
        const t = S.table;
        t.seats.forEach((s, i) => {
          if (s.isHuman || s.stack > 0) return;
          const p = isTut ? { name: s.name, stack: 1000, persona: s.persona } : newAI(i);
          if (p.name !== s.name) S.usedNames.delete(s.name);
          t.setPlayer(i, p);
          t._log(`${s.name} 離桌，${p.name} 入座（買入 ${fmt(p.stack)}）`);
          if (!isTut) ui.toast(`${ui.esc(s.name)} 籌碼輸光離桌，${ui.esc(p.name)} 入座`);
        });
      }

      // ------------------------------------------------------------ 買入 / 離桌
      function openBuyIn({ rebuy = false } = {}) {
        if (!ctx.alive()) return;
        if (S.modal) { S.modal.close(); S.modal = null; }
        const bal = Math.floor(ctx.bank.balance());
        if (bal < RULES.buyInMin) {
          if (ctx.isReal) { ctx.checkBroke(); ctx.nextRound(() => openBuyIn({ rebuy })); return; }
          S.modal = ui.modal({
            title: '餘額不足 <i class="en">Not enough balance</i>',
            body: `<p>${rebuy ? '桌上籌碼輸光了。' : ''}餘額 ${fmt(bal)}，不夠最低買入 ${fmt(RULES.buyInMin)}。練習模式可以重置籌碼，或離桌。</p>`,
            dismissable: false,
            actions: [
              { id: 'leave-table', label: term('回首頁', 'Home'), onClick: () => { S.modal = null; LG.router.go('#/'); } },
              { id: 'reset-bank', label: '重置籌碼 RM 1,000', primary: true, onClick: () => { S.modal = null; ctx.bank.reset(); setTimeout(() => openBuyIn({ rebuy }), 0); } },
            ],
          });
          return;
        }
        const max = Math.min(RULES.buyInMax, bal);
        let amount = max;
        let nOpp = S.nOpp;
        const out = el('output.pr-buyin__amt', { text: fmt(amount) });
        const range = el('input', { type: 'range', class: 'pr-buyin__range', min: RULES.buyInMin, max, step: 10, 'aria-label': '買入金額 Buy-in amount' });
        range.value = String(amount);
        const presets = el('div.pr-buyin__presets', [400, 600, 800, 1000].map((v) => el('button', {
          type: 'button', class: 'lg-btn lg-btn--sm', dataset: { buyin: v }, text: fmt(v), disabled: v > max,
          on: { click: () => { amount = v; range.value = String(v); out.textContent = fmt(v); } },
        })));
        range.addEventListener('input', () => { amount = Math.round(Number(range.value)); out.textContent = fmt(amount); });
        const oppBtns = RULES.oppChoices.map((k) => el('button', {
          type: 'button', class: ['lg-btn', 'lg-btn--sm', k === nOpp && 'is-on'], dataset: { opp: k }, text: `${k} 個 AI`,
          on: { click: (ev) => { nOpp = k; oppBtns.forEach((b) => b.classList.toggle('is-on', b === ev.currentTarget)); } },
        }));
        const body = el('div.pr-buyin', [
          el('p', { html: rebuy
            ? `你的桌上籌碼輸光了。要<b>再買入 <i class="en">Rebuy</i></b> 繼續，還是離桌？`
            : `撲克室不是跟賭場對賭：你拿籌碼上桌，跟其他玩家比。<br>從餘額（${fmt(bal)}）轉入 ${fmt(RULES.buyInMin)} – ${fmt(RULES.buyInMax).replace('RM ', '')}；離桌時桌上籌碼轉回餘額。` }),
          el('div.pr-buyin__row', [el('span', { html: term('買入金額', 'Buy-in') }), out]),
          range, presets,
          S.table ? null : el('div.pr-buyin__row', [el('span', { html: term('對手人數', 'Opponents') }), el('div.pr-buyin__opp', oppBtns)]),
          el('p.lg-muted', { html: `盲注 RM 5 / RM 10 · 抽水 5%（上限 RM 50）· <i class="en">No flop no drop</i>${ctx.isReal ? ' · 每次行動 30 秒' : ''}` }),
        ]);
        S.modal = ui.modal({
          title: rebuy ? `${term(T.rebuy.zh, T.rebuy.en)}` : `${term(T.buyIn.zh, T.buyIn.en)}`,
          body, dismissable: false, className: 'pr-buyin-modal',
          actions: [
            { id: 'leave-table', label: term(T.leave.zh, T.leave.en), onClick: () => { S.modal = null; LG.router.go('#/'); } },
            { id: 'buyin', label: `${term(T.buyIn.zh, T.buyIn.en)}`, primary: true, onClick: () => { S.modal = null; doBuyIn(Math.max(RULES.buyInMin, Math.min(max, amount)), nOpp); } },
          ],
        });
      }

      function doBuyIn(amount, nOpp) {
        if (!ctx.alive()) return;
        try { ctx.bank.debit(amount); } catch { ui.toast('籌碼不足 <i class="en">Insufficient chips</i>'); openBuyIn(); return; }
        S.boughtIn += amount;
        if (!S.table) { S.nOpp = nOpp; createTable(nOpp, amount); }
        else { const h = S.table.seats[S.humanIdx]; h.stack += amount; h.sittingOut = false; }
        ui.toast(`買入 ${fmt(amount)}，祝好運！`);
        S.phase = 'idle';
        paintAll();
        paintActions();
        if (ctx.isReal) ctx.later(() => { if (S.phase === 'idle') runHand(); }, 600);
      }

      function onLeave() {
        const t = S.table;
        const h = t && t.seats[S.humanIdx];
        if (t && t.phase === 'play' && h.inHand && !h.folded) {
          ui.confirm('這手還沒結束：離桌等於棄牌，已放進底池的籌碼拿不回來。確定離桌？', { okLabel: '離桌 <i class="en">Leave</i>' })
            .then((ok) => { if (ok) LG.router.go('#/'); });
        } else LG.router.go('#/');
      }

      /** 離桌結算：桌上籌碼轉回餘額；局中離桌 = 棄牌（已投入的不退，照記一手輸） */
      function cashOut() {
        if (S.modal) { S.modal.close(); S.modal = null; }
        if (S.timer) { S.timer.cancel(); S.timer = null; }
        if (isTut || !S.table) return;
        const t = S.table, h = t.seats[S.humanIdx];
        if (t.phase === 'play' && h.inHand) {
          const r = { wagered: h.committed, net: -h.committed, outcome: h.committed > 0 ? 'lose' : 'push' };
          LG.stats.record(ctx.gameId, r);
          if (ctx.isReal) LG.stats.session.record(r);
        }
        if (h.stack > 0) {
          const back = h.stack;
          h.stack = 0;
          ctx.bank.credit(back);
          ui.toast(`離桌：桌上籌碼 ${fmt(back)} 已轉回餘額`);
        }
      }

      // ------------------------------------------------------------ 教學
      const demo = {
        ensureSeated() { if (!S.table) { createTable(3, 1000); S.boughtIn = 1000; S.phase = 'idle'; paintAll(); paintActions(); } },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        openHistory() { historyEl.open = true; },
        /** 教學工作表蓋住畫面下半部：把要操作的區塊捲到畫面中間 */
        scrollTo(sel) {
          const x = root && root.querySelector(sel);
          try { if (x && x.scrollIntoView) x.scrollIntoView({ block: 'center', behavior: LG.speed < 1 ? 'auto' : 'smooth' }); } catch { /* 無 DOM */ }
        },
      };

      function tutorialSteps() {
        const seated = (inst) => inst.demo.ensureSeated();
        return [
          // ===== layout 桌面（6 步）
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：撲克室桌面',
            body: '<p>撲克室是玩家互相比牌，賭場只發牌、抽水。先認識橢圓桌上的東西。</p><p class="lg-muted">教學用示範籌碼，不影響你的餘額。</p>',
            highlight: ['.pr-oval'], setup: seated },
          { id: 'layout-seats', section: 'layout', title: '座位 <i class="en">Seats</i>',
            body: '<p>最多 6 人，你坐在最下方。每個座位顯示名字和籌碼；發牌後有兩張暗牌。</p>',
            highlight: ['.pr-seat'], setup: seated },
          { id: 'layout-button', section: 'layout', title: '按鈕 <i class="en">Dealer button</i>',
            body: '<p>白色 <b>D</b> 是按鈕位，每手順時針移一位。按鈕翻牌後最後行動，是最好的位置。</p>',
            highlight: ['.pr-dbtn'], setup: seated },
          { id: 'layout-blinds', section: 'layout', title: '盲注 <i class="en">Blinds</i>',
            body: '<p>按鈕左邊是<b>小盲 SB</b>（RM 5），再左邊是<b>大盲 BB</b>（RM 10）。發牌前就要放，強迫有底池。</p>',
            highlight: ['.pr-pos'], setup: seated },
          { id: 'layout-pot', section: 'layout', title: '底池與公共牌 <i class="en">Pot / Community cards</i>',
            body: '<p>中間上方是<b>底池</b>金額，下方五個位置放<b>公共牌</b>——大家共用。</p>',
            highlight: ['.pr-pot', '.pr-board'], setup: seated },
          { id: 'layout-stack', section: 'layout', title: '籌碼堆 <i class="en">Stack</i>',
            body: '<p>座位上的金額是桌上籌碼。只能用桌上的籌碼下注，不能手伸進口袋加錢（<i class="en">Table stakes</i>）。</p>',
            highlight: ['.pr-seat__stack', '.pr-bar'], setup: seated },
          // ===== flow 流程（10 步）
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一手怎麼進行',
            body: '<p>盲注 → 發兩張暗牌 → 翻牌前 → 翻牌 3 張 → 轉牌 1 張 → 河牌 1 張 → 攤牌。每條街都有一輪下注。</p>',
            highlight: ['.pr-board'], setup: seated },
          { id: 'flow-deal', section: 'flow', title: '發牌 <i class="en">Deal</i>',
            body: '<p>按「發牌」開始一手：盲注自動放進去，每人發兩張。</p>',
            highlight: ['[data-action="deal"]', '.pr-actions'], setup: (inst) => { seated(inst); inst.demo.scrollTo('.pr-actions'); },
            action: { label: '按「發牌 Deal」開始一手', check: (inst) => inst.state.handsStarted > 0 || '按下方的「發牌 Deal」' } },
          { id: 'flow-order', section: 'flow', title: '誰先動 <i class="en">Action order</i>',
            body: '<p><b>翻牌前</b>：大盲左邊第一位先動。<b>翻牌後</b>：按鈕左邊第一位還在牌局的人先動。金框是目前輪到的人。</p>',
            highlight: ['.pr-seat.is-turn', '.pr-status'] },
          { id: 'flow-act', section: 'flow', title: '你的動作 <i class="en">Fold / Check / Call / Raise</i>',
            body: '<p>輪到你時：<b>棄牌</b>放棄；沒人下注可<b>過牌</b>；有人下注要<b>跟注</b>；或<b>下注/加注</b>。</p>',
            highlight: ['.pr-actions', '.pr-raise'], setup: (inst) => inst.demo.scrollTo('.pr-actions'),
            action: { label: '輪到你時，選一個動作', check: (inst) => inst.state.humanActions > 0 || (inst.state.handsStarted ? '等金框移到你的座位，再按一個動作' : '先按「發牌」') } },
          { id: 'flow-streets', section: 'flow', title: '四條街 <i class="en">Flop / Turn / River</i>',
            body: '<p>翻牌 3 張、轉牌 1 張、河牌 1 張。用你 2 張 + 公共 5 張，挑最好的 5 張。</p>',
            highlight: ['.pr-board'] },
          { id: 'flow-minraise', section: 'flow', title: '最小加注 <i class="en">Minimum raise</i>',
            body: '<p>加注至少要加「前一次加注的金額」。大盲 10，有人加到 30（加了 20）→ 下一個人至少加到 <b>RM 30 + RM 20 = RM 50</b>。</p>',
            highlight: ['.pr-raise'], setup: (inst) => inst.demo.scrollTo('.pr-raise') },
          { id: 'flow-allin', section: 'flow', title: '全下與邊池 <i class="en">All-in / Side pot</i>',
            body: '<p>籌碼不夠跟可以全下。你只能贏「每人跟你一樣多」的主池，多出來的錢另成<b>邊池</b>，你沒份。</p>',
            highlight: ['.pr-pot'] },
          { id: 'flow-rake', section: 'flow', title: '抽水 <i class="en">Rake</i>',
            body: '<p>賭場從每個底池抽 <b>5%</b>，最多 <b>RM 50</b>。沒發翻牌就結束 → 不抽（<i class="en">No flop, no drop</i>）。</p>',
            highlight: ['.pr-pot'] },
          { id: 'flow-no-touch', section: 'flow', title: '不能碰籌碼的時候',
            body: '<p>沒輪到你，手離開籌碼。下注要<b>一次推出</b>或先說金額；分兩次推叫 <b>string bet</b>，只算第一次。</p>',
            highlight: ['.pr-seat--you'] },
          { id: 'flow-etiquette', section: 'flow', title: '禮儀 <i class="en">Etiquette</i>',
            body: '<p><b>口頭宣告優先</b>：說「Raise 50」就照說的算。<b>牌不離桌</b>：暗牌留在桌面。棄牌時把牌推向荷官。</p>',
            highlight: ['.pr-seat--you .pr-seat__cards', '.pr-seat--you'] },
          { id: 'flow-history', section: 'flow', title: '手牌歷程 <i class="en">Hand history</i>',
            body: '<p>每手的每條街誰做了什麼、底池和抽水，都記在這裡。</p>',
            highlight: ['.pr-history'], setup: (inst) => inst.demo.scrollTo('.pr-history'),
            action: { label: '點「手牌歷程」展開', check: (inst) => inst.state.historyOpened || '點下方「手牌歷程 Hand history」' } },
          // ===== payout 輸贏（4 步）
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：底池怎麼分',
            body: '<p>攤牌 <i class="en">Showdown</i> 牌最大的人拿走底池，減去抽水。例：底池 RM 200。</p><p><b>RM 200 × 5% = RM 10</b>（抽水）<br>贏家拿回 <b>RM 190</b>。</p>',
            highlight: ['.pr-pot'] },
          { id: 'payout-cap', section: 'payout', title: '抽水上限',
            body: '<p>底池 RM 2,000：<br><b>RM 2,000 × 5% = RM 100 → 上限 RM 50</b><br>贏家拿回 <b>RM 1,950</b>。</p>',
            highlight: ['.pr-pot'] },
          { id: 'payout-split', section: 'payout', title: '平分與奇數籌碼',
            body: '<p>兩人同樣大：平分。底池 RM 205 − 抽水 RM 10 = RM 195 → 各 RM 97，多的 <b>RM 1</b> 給按鈕左側第一位。</p>',
            highlight: ['.pr-dbtn', '.pr-pot'] },
          { id: 'payout-side', section: 'payout', title: '邊池實例',
            body: '<p>A 全下 100，B、C 各 300。<br>主池 = RM 100 × 3 = <b>RM 300</b>（A、B、C 爭）<br>邊池 = RM 200 × 2 = <b>RM 400</b>（只有 B、C 爭）</p>',
            highlight: ['.pr-pot'] },
          // ===== strategy 策略（6 步）
          { id: 'strategy-edge', section: 'strategy', title: '莊家優勢？ <i class="en">House edge</i>',
            body: '<table class="lg-datatable"><tr><th>項目</th><th>數字</th></tr><tr><td>莊家優勢</td><td>無（跟玩家比）</td></tr><tr><td>抽水</td><td>5%，上限 RM 50</td></tr><tr><td>沒翻牌</td><td>不抽</td></tr></table><p>贏錢要靠比對手打得好。</p>',
            highlight: null },
          { id: 'strategy-hands', section: 'strategy', title: '起手牌表 <i class="en">Starting hands</i>',
            body: `<p>該玩：深色的前 20% 牌加注入池。</p>${handChartHtml()}`,
            highlight: null },
          { id: 'strategy-position', section: 'strategy', title: '位置 <i class="en">Position</i>',
            body: '<p>越晚行動越有利：先看別人怎麼做再決定。按鈕位可以多玩一些牌；大盲左邊（最早）只玩最強的牌。</p>',
            highlight: ['.pr-dbtn'] },
          { id: 'strategy-odds', section: 'strategy', title: '底池賠率 <i class="en">Pot odds</i>',
            body: '<p>底池 RM 60，要跟 RM 20：<br><b>RM 20 ÷ (RM 60 + RM 20) = 25%</b><br>勝率高於 25% 才值得跟。</p>',
            highlight: ['.pr-pot'] },
          { id: 'strategy-dont', section: 'strategy', title: '別玩太多手',
            body: '<p>別押：弱牌「看看翻牌」、沒有賠率還跟注。新手最常見的漏洞就是玩太多手、跟太多注。</p>',
            highlight: null },
          { id: 'strategy-budget', section: 'strategy', title: '買入與停損 <i class="en">Bankroll</i>',
            body: '<p>今晚只帶 RM 500，買入一次，輸完就走，不要馬上再買入追回。贏了也設個點收手。</p>',
            highlight: ['.lg-topbar .lg-balance', '.pr-bar'] },
        ];
      }

      // ------------------------------------------------------------ instance
      return {
        state: S,
        demo,
        logic,
        table: () => S.table,
        mount(el0) {
          root = el0;
          root.classList.add('pr-root');
          buildTable();
          paintActions();
          paintStatus();
          paintBar();
          paintHistory();
          ctx.on('hints:change', () => { paintHint(); });
          if (ctx.isPractice) {
            ctx.strategyPanel(`<p><b>起手牌表</b>（Chen 分數排序）</p>${handChartHtml()}`
              + '<p>底池賠率：需要勝率 = 跟注額 ÷（底池 + 跟注額）。</p><p>抽水 5%，上限 RM 50；翻牌前結束不抽。</p>');
          }
          root.dataset.ready = '1';
          if (isTut) { demo.ensureSeated(); return; }
          ctx.ready.then(() => { if (ctx.alive()) openBuyIn(); });
        },
        unmount() { cashOut(); },
        tutorialSteps,
      };
    },
  });
})();
