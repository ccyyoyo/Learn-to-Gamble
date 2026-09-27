// ============================================================================
// Ultimate Texas Hold'em（id: ultimate-holdem）— 規格：docs/05-game-rules/ultimate-holdem.md
//
// 規則摘要：1 副牌。開局押 Ante 與 Blind（同額、必押；放 Ante 時 Blind 自動同步），可加 Trips 旁注。
//   玩家 2 張、莊 2 張暗、公共牌分三階段翻（翻牌 3 張 → 轉牌 + 河牌一起）。
//   決策（整局只能加注一次，加注後直接看到底）：
//     翻牌前 Check / Raise 3× / 4× Ante；翻牌後 Check / Raise 2×；河牌後 Raise 1× / Fold。
//   莊家合格：一對以上。不合格 → Ante 退回；Blind / Play 仍比牌。
//   玩家勝：Play 1:1、Ante 1:1（莊合格時）、Blind 照表（順子以上才賠，否則退回）。莊勝：全輸。平手退注。
//   Trips：只看玩家 7 張，三條以上照表賠（與莊家無關、棄牌也算）。
//
// 金流：No more bets 後扣 Ante + Blind + Trips；加注時再扣 Play；結算 credit（含本金）。
// ============================================================================
(() => {
  const { ui, money, poker } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;
  const CAT = poker.CATEGORY;
  const RV = LG.cards.RANK_VALUE;
  const B5 = 1048576;

  // ---------------------------------------------------------------- 文案集中
  const T = {
    dealer: { zh: '莊家', en: 'Dealer' },
    board: { zh: '公共牌', en: 'Community' },
    you: { zh: '你', en: 'You' },
    spots: {
      trips: { zh: '三條旁注', en: 'Trips', odds: '3:1–50:1' },
      blind: { zh: '盲注', en: 'Blind', odds: '順以上 1:1–500:1' },
      ante: { zh: '底注', en: 'Ante', odds: '1:1' },
      play: { zh: '加注', en: 'Play', odds: '1:1' },
    },
    slotLabels: ['F', 'F', 'F', 'T', 'R'],
    rule: '莊家一對以上合格 · 不合格 Ante 退回 <i class="en">Dealer qualifies with a pair</i>',
    blindDisabled: 'Blind 自動跟 Ante 同額——點「底注 ANTE」就好',
    playDisabled: 'Play 不用自己放：用下面的加注按鈕（3× / 4× / 2× / 1×）',
    needAnte: '先押底注 Ante（Blind 會自動同額；Trips 不能單獨押）',
    reserve: '籌碼要預留：Ante + Blind 之外，至少還要 1× Ante 給河牌加注',
    softReserve: '提醒：餘額不夠加注，這局河牌只能棄牌',
    stageSay: {
      preflop: ['翻牌前：過牌或加注 3× / 4×', 'Check or raise?'],
      flop: ['翻牌後：過牌或加注 2×', 'Check or raise?'],
      river: ['河牌後：加注 1× 或棄牌', 'Raise or fold?'],
    },
    actions: {
      check: { zh: '過牌', en: 'Check' },
      raise4: { zh: '加注 4×', en: 'Raise' },
      raise3: { zh: '加注 3×', en: 'Raise' },
      raise2: { zh: '加注 2×', en: 'Raise' },
      raise1: { zh: '加注 1×', en: 'Raise' },
      fold: { zh: '棄牌', en: 'Fold' },
    },
    paytable: '賠付表 <i class="en">Pay table</i>',
  };

  // ---------------------------------------------------------------- 規則常數
  const BLIND_PAY = { [CAT.ROYAL]: 500, [CAT.STRAIGHT_FLUSH]: 50, [CAT.QUADS]: 10, [CAT.FULL_HOUSE]: 3, [CAT.FLUSH]: 1.5, [CAT.STRAIGHT]: 1 };
  const BLIND_ODDS = { 1.5: '3:2' };
  const TRIPS_PAY = { [CAT.ROYAL]: 50, [CAT.STRAIGHT_FLUSH]: 40, [CAT.QUADS]: 30, [CAT.FULL_HOUSE]: 8, [CAT.FLUSH]: 7, [CAT.STRAIGHT]: 4, [CAT.TRIPS]: 3 };
  const TRIPS_LIMITS_REAL = { min: 10, max: 100 };
  const STAGE_SECONDS = 30;
  const ALLOWED = { preflop: ['check', 'raise3', 'raise4'], flop: ['check', 'raise2'], river: ['fold', 'raise1'] };
  /** 逾時預設動作（真實模式） */
  const TIMEOUT_ACTION = { preflop: 'check', flop: 'check', river: 'fold' };

  // ---------------------------------------------------------------- 純邏輯（可在 Node 單元測試）
  const rankTxt = (r) => (r === 14 || r === 1 ? 'A' : r === 13 ? 'K' : r === 12 ? 'Q' : r === 11 ? 'J' : String(r));
  const cardTxt = (c) => (c.rank === 'T' ? '10' : c.rank) + ui.SUIT[c.suit].symbol;
  const oddsTxt = (m) => BLIND_ODDS[m] || `${m}:1`;

  /** 莊家合格：一對以上 */
  function qualifies(res) { return res.cat >= CAT.PAIR; }

  /** 三階段狀態機：整局只能加注一次；加注或棄牌後直接到攤牌 */
  function createFlow() {
    const f = {
      stage: 'preflop', play: 0, folded: false, raisedAt: null, history: [],
      allowed() { return ALLOWED[f.stage] ? [...ALLOWED[f.stage]] : []; },
      canAct(a) { return f.allowed().includes(a); },
      /** @returns {string} 新的 stage：'flop'|'river'|'showdown' */
      act(a) {
        if (!f.canAct(a)) throw new Error(`ILLEGAL:${f.stage}:${a}`);
        f.history.push([f.stage, a]);
        if (a.startsWith('raise')) { f.play = Number(a.slice(5)); f.raisedAt = f.stage; f.stage = 'showdown'; }
        else if (a === 'fold') { f.folded = true; f.stage = 'showdown'; }
        else f.stage = f.stage === 'preflop' ? 'flop' : 'river';
        return f.stage;
      },
    };
    return f;
  }

  /** 翻牌前 4× 表（規格 §4）：任 A；K-2s+/K-5o+；Q-6s+/Q-8o+；J-8s+/J-10o；對子 33+ */
  function preflopAdvice(hole) {
    let a = RV[hole[0].rank], b = RV[hole[1].rank];
    if (a < b) [a, b] = [b, a];
    const suited = hole[0].suit === hole[1].suit;
    const name = `${rankTxt(a)}-${rankTxt(b)}${a === b ? '' : suited ? ' 同花' : ' 不同花'}`;
    let ok = false, rule;
    if (a === b) { ok = a >= 3; rule = '對子 3-3 以上 4×（2-2 過牌）'; }
    else if (a === 14) { ok = true; rule = '任何 A 都 4×'; }
    else if (a === 13) { ok = suited ? b >= 2 : b >= 5; rule = suited ? 'K 同花：K-2 以上 4×' : 'K 不同花：K-5 以上 4×'; }
    else if (a === 12) { ok = suited ? b >= 6 : b >= 8; rule = suited ? 'Q 同花：Q-6 以上 4×' : 'Q 不同花：Q-8 以上 4×'; }
    else if (a === 11) { ok = suited ? b >= 8 : b >= 10; rule = suited ? 'J 同花：J-8 以上 4×' : 'J 不同花：只有 J-10 4×'; }
    else rule = '10 以下的高牌不在 4× 表';
    return { action: ok ? 'raise4' : 'check', why: `${name}：${rule} → ${ok ? '加注 4×' : '過牌'}。`, name };
  }

  const holeRanks = (hole) => hole.map((c) => RV[c.rank]);
  /** 用到手牌的對子：口袋對或手牌配中公共牌 */
  function hiddenPair(hole, board) {
    const hr = holeRanks(hole), br = board.map((c) => RV[c.rank]);
    return hr[0] === hr[1] || hr.some((r) => br.includes(r));
  }

  /** 翻牌後 2×（規格 §4）：兩對以上（用到手牌）；用到手牌的一對；4 張同花且手牌有 10 以上的該花色 */
  function flopAdvice(hole, flop) {
    const me = poker.best(hole.concat(flop)), bd = poker.best(flop);
    if (me.cat >= CAT.TWO_PAIR && me.cat > bd.cat) return { action: 'raise2', why: `你有${me.name.zh}（用到手牌）→ 加注 2×。` };
    if (hiddenPair(hole, flop)) return { action: 'raise2', why: '你的對子用到手牌（不是只有公共牌的對）→ 加注 2×。' };
    for (const s of 'SHDC') {
      const n = hole.concat(flop).filter((c) => c.suit === s).length;
      if (n >= 4 && hole.some((c) => c.suit === s && RV[c.rank] >= 10)) return { action: 'raise2', why: '4 張同花聽牌，而且手牌有 10 以上的同花色 → 加注 2×。' };
    }
    return { action: 'check', why: '沒有用到手牌的對子、也沒有好的同花聽牌 → 過牌，等河牌。' };
  }

  /**
   * 莊家 outs：剩下的牌裡，單獨一張配上 5 張公共牌就「贏過你」的張數。
   * @returns {{count:number, cards:Array}}
   */
  function dealerOuts(hole, board) {
    const mine = poker.score(hole.concat(board));
    const known = new Set(hole.concat(board).map((c) => c.id));
    const cards = [];
    for (const s of LG.cards.SUITS) for (const r of LG.cards.RANKS) {
      const id = r + s;
      if (known.has(id)) continue;
      const c = { rank: r, suit: s, id };
      if (poker.score(board.concat([c])) > mine) cards.push(c);
    }
    return { count: cards.length, cards };
  }

  /**
   * 河牌 1×（規格 §4 + 實作備註）：用到手牌的一對以上 → 1×；否則莊家 outs < 21 → 1×；否則 Fold。
   * 註：規格原文「公共牌無對且 outs < 21」會讓優勢升到 6% 以上（Monte Carlo 驗收不過），
   *     實作採標準版（不限公共牌是否有對），見 docs/change-requests/ultimate-holdem.md。
   */
  function riverAdvice(hole, board) {
    const me = poker.best(hole.concat(board)), bd = poker.best(board);
    if (me.cat >= CAT.PAIR && (me.cat > bd.cat || (me.cat >= CAT.STRAIGHT && me.score > bd.score))) {
      return { action: 'raise1', why: `你有${me.name.zh}，用到手牌 → 加注 1×。` };
    }
    const outs = dealerOuts(hole, board).count;
    if (outs < 21) return { action: 'raise1', outs, why: `沒有用到手牌的對子，但莊家只有 ${outs} 張牌能贏你（< 21）→ 加注 1×。` };
    return { action: 'fold', outs, why: `沒有用到手牌的對子，莊家有 ${outs} 張牌能贏你（≥ 21）→ 棄牌。` };
  }

  /** 依策略提示決定整局加注：→ {play:0|1|2|4, stage} */
  function strategyPlay(hole, board) {
    if (preflopAdvice(hole).action === 'raise4') return { play: 4, stage: 'preflop' };
    if (flopAdvice(hole, board.slice(0, 3)).action === 'raise2') return { play: 2, stage: 'flop' };
    if (riverAdvice(hole, board).action === 'raise1') return { play: 1, stage: 'river' };
    return { play: 0, stage: 'river' };
  }

  /** 由牌靴依序發：玩家 2、莊 2、公共牌 5 */
  function dealHand(shoe) {
    const d = () => shoe.draw();
    return { player: [d(), d()], dealer: [d(), d()], board: [d(), d(), d(), d(), d()] };
  }

  function line(spot, label, stake, result, mult, note = '') {
    let pay = 0, returned = 0, formula;
    if (result === 'win') {
      pay = round2(stake * mult); returned = round2(stake + pay);
      formula = `${label} ${fmt(stake)} × ${mult} = +${fmt(pay)}（拿回 ${fmt(returned)}）`;
    } else if (result === 'push') {
      returned = stake;
      formula = `${label} ${fmt(stake)} 退回 <i class="en">push</i>${note ? `（${note}）` : ''} = ${fmt(0)}`;
    } else {
      pay = -stake;
      formula = `${label} ${fmt(stake)} 輸 = −${fmt(stake)}`;
    }
    return { spot, label, stake, result, mult: result === 'win' ? mult : 0, pay, returned, formula };
  }

  /**
   * 結算。
   * @param {{ante:number, blind?:number, trips?:number, play?:number}} stakes play 為加注金額（不是倍數）
   * @param {{player, dealer, board}} hand
   * @param {{folded?:boolean, playMult?:number}} [o]
   */
  function settle(stakes, hand, { folded = false, playMult = 0 } = {}) {
    const ante = stakes.ante || 0, blind = stakes.blind ?? ante, trips = stakes.trips || 0, play = folded ? 0 : (stakes.play || 0);
    const p = poker.best(hand.player.concat(hand.board));
    const d = poker.best(hand.dealer.concat(hand.board));
    const qual = qualifies(d);
    const cmp = poker.compare(p, d);
    const playLabel = `加注 Play${playMult ? `（${playMult}×）` : ''}`;
    const lines = [];
    let outcome;
    if (folded) {
      outcome = 'fold';
      lines.push(line('ante', '底注 Ante', ante, 'lose'));
      lines.push(line('blind', '盲注 Blind', blind, 'lose'));
    } else if (cmp > 0) {
      outcome = 'win';
      lines.push(qual ? line('ante', '底注 Ante', ante, 'win', 1) : line('ante', '底注 Ante', ante, 'push', 0, '莊不合格'));
      const bm = BLIND_PAY[p.cat];
      lines.push(bm ? line('blind', '盲注 Blind', blind, 'win', bm) : line('blind', '盲注 Blind', blind, 'push', 0, '未達順子'));
      if (play) lines.push(line('play', playLabel, play, 'win', 1));
    } else if (cmp < 0) {
      outcome = 'lose';
      lines.push(qual ? line('ante', '底注 Ante', ante, 'lose') : line('ante', '底注 Ante', ante, 'push', 0, '莊不合格'));
      lines.push(line('blind', '盲注 Blind', blind, 'lose'));
      if (play) lines.push(line('play', playLabel, play, 'lose'));
    } else {
      outcome = 'tie';
      lines.push(line('ante', '底注 Ante', ante, 'push'));
      lines.push(line('blind', '盲注 Blind', blind, 'push'));
      if (play) lines.push(line('play', playLabel, play, 'push'));
    }
    if (trips > 0) {
      const tm = TRIPS_PAY[p.cat];
      lines.push(line('trips', '三條旁注 Trips', trips, tm ? 'win' : 'lose', tm || 0));
    }
    const wagered = round2(lines.reduce((a, l) => a + l.stake, 0));
    const returned = round2(lines.reduce((a, l) => a + l.returned, 0));
    return { outcome, lines, wagered, returned, net: round2(returned - wagered), p, d, qual, cmp, folded };
  }

  /** 7 張牌各類別的精確機率（C(52,7) = 133,784,560 手），供分層校正用 */
  const P7 = [23294460, 58627800, 31433400, 6461620, 6180020, 4047644, 3473184, 224848, 37260, 4324].map((v) => v / 133784560);

  /**
   * Monte Carlo：依策略提示玩 n 個「玩家情境」（2 張 + 5 張公共牌；Ante = Blind = 1），回傳 Ante 優勢 %。
   * 為了在合理時間內把標準誤壓到 ±0.3% 以下，用三個不改變期望值的變異數縮減：
   *  1. 策略與莊家牌無關 → 每個情境抽 dealerSamples 組莊家牌取平均。
   *  2. 依玩家 7 張的最終牌型分層（post-stratification）：各類別平均 × 精確機率 P7。
   *  3. Blind 皇家同花順 500:1 以精確機率加回：P(7 張成皇家) − P(公共牌本身皇家 → 平手不賠)。
   * @returns {{edge:number, se:number, hands:number, rates:{raise4,raise2,raise1,fold}}}
   */
  function simulate(n = 100000, { dealerSamples = 4 } = {}) {
    const deck = LG.cards.newDeck();
    const K = Math.max(1, dealerSamples | 0);
    const sum = new Float64Array(10), sq = new Float64Array(10), cnt = new Float64Array(10);
    const plays = { 4: 0, 2: 0, 1: 0, 0: 0 };
    const swap = (top) => { const j = Math.floor(LG.rng.random() * (top + 1)); const t = deck[top]; deck[top] = deck[j]; deck[j] = t; };
    for (let i = 0; i < n; i++) {
      for (let k = 0; k < 7; k++) swap(51 - k);
      const hole = [deck[45], deck[46]];
      const board = [deck[47], deck[48], deck[49], deck[50], deck[51]];
      const { play } = strategyPlay(hole, board);
      plays[play]++;
      const ps = poker.score(hole.concat(board));
      const pc = Math.floor(ps / B5);
      let x = 0;
      if (!play) x = -2;
      else {
        const bl = pc === CAT.ROYAL ? 0 : (BLIND_PAY[pc] || 0);   // 皇家的 Blind 另以精確機率加回
        for (let s = 0; s < K; s++) {
          swap(44); swap(43);
          const ds = poker.score([deck[43], deck[44]].concat(board));
          const q = Math.floor(ds / B5) >= CAT.PAIR;
          if (ps > ds) x += play + (q ? 1 : 0) + bl;
          else if (ps < ds) x += -play - (q ? 1 : 0) - 1;
        }
        x /= K;
      }
      sum[pc] += x; sq[pc] += x * x; cnt[pc]++;
    }
    let m = 0, v = 0;
    for (let c = 0; c < 10; c++) {
      if (!cnt[c]) continue;
      const mu = sum[c] / cnt[c];
      m += P7[c] * mu;
      v += P7[c] * Math.max(0, sq[c] / cnt[c] - mu * mu);
    }
    m += 500 * (4324 / 133784560 - 4 / 2598960);
    return {
      edge: -m * 100, se: Math.sqrt(v / n) * 100, hands: n,
      rates: { raise4: plays[4] / n, raise2: plays[2] / n, raise1: plays[1] / n, fold: plays[0] / n },
    };
  }

  // ---------------------------------------------------------------- 顯示小工具
  const mc = (c, extra = '') => `<span class="uth-mc${ui.SUIT[c.suit].color === 'red' ? ' is-red' : ''}${extra}">${cardTxt(c)}</span>`;
  const mcs = (arr) => arr.map((c) => mc(c)).join('');
  const handName = (res) => poker.describe(res);
  const tbl = (rows) => `<table class="lg-datatable">${rows.map((r, i) => `<tr>${r.map((c) => (i ? `<td>${c}</td>` : `<th>${c}</th>`)).join('')}</tr>`).join('')}</table>`;
  const RAISE4_TABLE = [['高張', '同花 suited', '不同花 offsuit'], ['A', '全部', '全部'], ['K', 'K-2 以上', 'K-5 以上'], ['Q', 'Q-6 以上', 'Q-8 以上'], ['J', 'J-8 以上', '只有 J-10'], ['對子', '3-3 以上', '']];

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'ultimate-holdem',
    category: 'poker-table',
    order: 4,
    name: { zh: '終極德州撲克', en: "Ultimate Texas Hold'em" },
    summary: 'Ante + Blind 開局，越早加注倍數越大，一局只能加一次。',
    houseEdge: [
      { bet: { zh: '底注（最佳策略）', en: 'Ante (optimal)' }, edge: 2.19, best: true },
      { bet: { zh: '三條旁注（本桌賠付表）', en: 'Trips' }, edge: 3.5 },
    ],
    limits: { real: { min: 25, max: 500 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    logic: {
      qualifies, createFlow, preflopAdvice, flopAdvice, riverAdvice, dealerOuts, strategyPlay, settle, simulate, dealHand,
      BLIND_PAY, TRIPS_PAY, TRIPS_LIMITS_REAL, STAGE_SECONDS, ALLOWED, TIMEOUT_ACTION,
    },

    create(ctx) {
      const state = {
        phase: 'idle', hand: null, flow: null, stakes: null, staked: 0, rounds: 0, decisions: 0,
        script: null, lastAction: null, lastResult: null, quiz: {},
      };
      const L = ctx.limits;
      const tripsLim = ctx.isReal ? TRIPS_LIMITS_REAL : { min: L.min, max: L.max };
      const bets = new LG.Bets({
        min: L.min, max: Infinity, perSpotMin: L.min, perSpotMax: L.max,
        spotRules: {
          ante: { min: L.min, max: L.max, label: '底注 Ante' },
          blind: { min: L.min, max: L.max, label: '盲注 Blind' },
          trips: { min: tripsLim.min, max: tripsLim.max, label: '三條旁注 Trips' },
          play: { min: 0, max: Infinity, label: '加注 Play' },
        },
      });
      // Blind 永遠與 Ante 同額（下注階段）
      bets.subscribe(() => {
        if (!bets.locked && bets.get('blind') !== bets.get('ante')) bets.set('blind', bets.get('ante'));
      });

      let root, tableEl, dealerHand, playerHand, slots = [], dealerBadge, playerBadge, hintEl;
      let tray, layer, bar, ab, stageCd = null, quizOff = null;
      const cardEls = { player: [], dealer: [], board: [] };

      // ---------------------------------------------------------- 桌面
      function spot(id) {
        const s = T.spots[id];
        const attrs = { class: ['lg-spot', 'uth-spot', `uth-spot--${id}`], dataset: { bet: id } };
        if (id === 'blind') { attrs.dataset.betDisabled = ''; attrs.dataset.disabledMsg = T.blindDisabled; }
        if (id === 'play') { attrs.dataset.betDisabled = ''; attrs.dataset.disabledMsg = T.playDisabled; }
        return el('div', attrs, [
          el('span.lg-spot__zh', { text: s.zh }),
          el('span.lg-spot__en', { text: s.en }),
          el('span.lg-spot__odds', { text: s.odds }),
        ]);
      }

      function buildTable() {
        dealerHand = el('div.lg-hand.uth-hand', { dataset: { role: 'dealer' } });
        playerHand = el('div.lg-hand.uth-hand', { dataset: { role: 'player' } });
        dealerBadge = el('div.uth-badge', { dataset: { role: 'dealer-badge' } });
        playerBadge = el('div.uth-badge', { dataset: { role: 'player-badge' } });
        slots = T.slotLabels.map((lab, i) => el('div.uth-slot', { dataset: { slot: String(i), label: lab } }));
        const ptBtn = el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-btn--ghost uth-ptbtn', dataset: { action: 'paytable' }, html: T.paytable });
        ptBtn.addEventListener('click', showPaytable);
        tableEl = el('div.lg-table.uth-table', [
          el('div.uth-row.uth-row--dealer', [el('div.lg-table__label', { html: term(T.dealer.zh, T.dealer.en) }), dealerHand, dealerBadge]),
          el('div.uth-row.uth-row--board', [el('div.lg-table__label', { html: term(T.board.zh, T.board.en) }), el('div.uth-board', { dataset: { role: 'board' } }, slots)]),
          el('div.uth-rule', { html: T.rule }),
          el('div.uth-row.uth-row--player', [playerBadge, playerHand, el('div.lg-table__label', { html: term(T.you.zh, T.you.en) })]),
          el('div.uth-spots', [spot('trips'), spot('blind'), spot('ante'), spot('play')]),
          el('div.uth-sync', { html: 'Ante = Blind 同額（自動） <i class="en">Ante and Blind must be equal</i>' }),
          ptBtn,
        ]);
        const actions = el('div.lg-actions.uth-actions', { dataset: { dealSlot: '' } });
        hintEl = el('div.lg-hint.uth-hint', { hidden: true, dataset: { role: 'hint' } });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, hintEl, actions, chips, barEl);

        ab = ui.actionBar(actions, ['fold', 'check', 'raise1', 'raise2', 'raise3', 'raise4'].map((id) => ({
          id, label: T.actions[id].zh, en: T.actions[id].en, hidden: true,
          primary: id === 'raise4' || id === 'raise2' || id === 'raise1',
          onClick: () => act(id),
        })));
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId, canPlace });
        bar = ui.betBar(barEl, { bets, layer });
        clearTable();
      }

      /**
       * 放 Ante（Blind 同步 → 實際 2 倍）時預留 1× Play；Trips 也要算進去。
       * 餘額連「最低注 × 3」都不夠時不再擋（否則真實模式會卡住），改成提醒「河牌只能棄牌」。
       */
      function reserveCheck(ante, trips) {
        const bal = ctx.bank.balance();
        if (round2(ante * 3 + trips) <= bal + 1e-9) return true;
        if (round2(ante * 2 + trips) > bal + 1e-9) return '籌碼不足：Ante + Blind 要 2 倍 Ante <i class="en">Insufficient chips</i>';
        if (round2(L.min * 3 + trips) <= bal + 1e-9) return T.reserve;
        return 'soft';
      }
      function canPlace(spotId, amount) {
        const ante = bets.get('ante') + (spotId === 'ante' ? amount : 0);
        const trips = bets.get('trips') + (spotId === 'trips' ? amount : 0);
        const r = reserveCheck(ante, trips);
        if (r === 'soft') { ui.toast(T.softReserve, { type: 'warn' }); return true; }
        return r;
      }
      function validateBets() {
        if (!(bets.get('ante') > 0)) return T.needAnte;
        if (bets.get('blind') !== bets.get('ante')) bets.set('blind', bets.get('ante'));
        const r = reserveCheck(bets.get('ante'), bets.get('trips'));
        return r === 'soft' ? true : r;
      }

      function showPaytable() {
        const blind = ui.table([['你贏時的牌型', 'Blind'], ['皇家同花順', '500:1'], ['同花順', '50:1'], ['四條', '10:1'], ['葫蘆', '3:1'], ['同花', '3:2'], ['順子', '1:1'], ['其他（你贏）', '退回 push']], { caption: 'Blind 盲注' });
        const trips = ui.table([['你的 7 張', 'Trips'], ['皇家同花順', '50:1'], ['同花順', '40:1'], ['四條', '30:1'], ['葫蘆', '8:1'], ['同花', '7:1'], ['順子', '4:1'], ['三條', '3:1']], { caption: 'Trips 三條旁注（與莊家無關）' });
        ui.modal({ title: T.paytable, body: el('div', [blind, trips, el('p.lg-muted', { html: 'Ante、Play 贏 1:1。莊家不合格（沒有一對）時 Ante 退回。' })]) });
      }

      // ---------------------------------------------------------- 牌區
      function clearTable() {
        dealerHand.innerHTML = ''; playerHand.innerHTML = '';
        slots.forEach((s) => { s.innerHTML = ''; });
        cardEls.player = []; cardEls.dealer = []; cardEls.board = [];
        dealerBadge.textContent = ''; playerBadge.textContent = '';
        dealerBadge.className = 'uth-badge'; playerBadge.className = 'uth-badge';
        markSpots(null);
      }
      function put(container, card, up) {
        const c = ui.card(up ? card : null, { faceDown: !up });
        container.appendChild(c);
        return c;
      }
      async function dealUp(container, card) {
        const c = put(container, card, false);
        await ctx.wait(110);
        await ui.flip(c, card);
        return c;
      }
      function paintBadges(hand, { boardN, dealerUp }) {
        if (ctx.isReal) return;
        const pb = poker.best(hand.player.concat(hand.board.slice(0, boardN)));
        playerBadge.innerHTML = handName(pb);
        if (dealerUp) {
          const db = poker.best(hand.dealer.concat(hand.board.slice(0, boardN)));
          dealerBadge.innerHTML = handName(db) + (boardN === 5 ? (qualifies(db) ? ' · 合格 ✓' : ' · 不合格 ✗') : '');
        } else dealerBadge.textContent = '';
      }
      function markWinner(r) {
        const ids = r.folded ? [] : r.outcome === 'win' ? r.p.best5.map((c) => c.id) : r.outcome === 'lose' ? r.d.best5.map((c) => c.id) : [];
        tableEl.querySelectorAll('.lg-card').forEach((c) => c.classList.toggle('is-win', ids.includes(c.dataset.id)));
        playerBadge.classList.toggle('is-win', r.outcome === 'win');
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
      function showActions(stage) {
        const allowed = stage ? ALLOWED[stage] : [];
        const ante = state.stakes ? state.stakes.ante : 0;
        for (const id of ['fold', 'check', 'raise1', 'raise2', 'raise3', 'raise4']) {
          const on = allowed.includes(id);
          const mult = id.startsWith('raise') ? Number(id.slice(5)) : 0;
          const afford = !mult || ctx.bank.canAfford(round2(mult * ante));
          ab.set(id, {
            hidden: !on, disabled: !on || !afford,
            label: mult && ante ? `${T.actions[id].zh}（${fmt(mult * ante)}）` : T.actions[id].zh,
          });
        }
      }
      function adviceFor(stage) {
        const h = state.hand;
        if (!h) return null;
        if (stage === 'preflop') return preflopAdvice(h.player);
        if (stage === 'flop') return flopAdvice(h.player, h.board.slice(0, 3));
        if (stage === 'river') return riverAdvice(h.player, h.board);
        return null;
      }
      function paintHint() {
        const show = ctx.hints && !ctx.isReal;
        hintEl.hidden = !show;
        if (!show) return;
        const stage = state.phase === 'decision' && state.flow ? state.flow.stage : null;
        const adv = stage ? adviceFor(stage) : null;
        if (adv) {
          hintEl.innerHTML = `建議：<b>${term(T.actions[adv.action].zh, T.actions[adv.action].en)}</b>——${adv.why}`;
          hintEl.dataset.advice = adv.action;
        } else {
          hintEl.innerHTML = '提示：放 Ante 時 Blind 會自動同額。好牌翻牌前就 4×；Trips 旁注優勢 3.50%，比 Ante 高。';
          delete hintEl.dataset.advice;
        }
      }
      function strategyHtml() {
        return `<p><b>翻牌前 4×</b>（其他過牌）：</p>${tbl(RAISE4_TABLE)}
          <p><b>翻牌後 2×</b>：兩對以上（用到手牌）；用到手牌的一對；4 張同花且手牌有 10 以上同花色。</p>
          <p><b>河牌 1×</b>：用到手牌的一對以上；否則數莊家 outs（單張就能贏你的牌）<b>&lt; 21 張</b> → 1×，否則棄牌。</p>
          <p class="lg-muted">照這套打優勢約 2.4%（最佳策略 2.19%）。</p>`;
      }

      // ---------------------------------------------------------- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        state.flow = null;
        showActions(null);
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
        state.stakes = { ante: bets.get('ante'), blind: bets.get('blind'), trips: bets.get('trips'), play: 0 };
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'dealing';
        state.lastAction = null;
        ctx.dealer.say('發牌', 'Dealing');
        const hand = dealHand(nextShoe());
        state.hand = hand;
        state.flow = createFlow();
        clearTable();
        for (const c of hand.player) cardEls.player.push(await dealUp(playerHand, c));
        if (!ctx.alive()) return;
        cardEls.dealer = hand.dealer.map((c) => put(dealerHand, c, false));
        paintBadges(hand, { boardN: 0, dealerUp: false });
        beginStage();
      }

      function beginStage() {
        if (!ctx.alive()) return;
        const stage = state.flow.stage;
        state.phase = 'decision';
        showActions(stage);
        ctx.dealer.say(...T.stageSay[stage]);
        paintHint();
        if (ctx.isReal) {
          stageCd = ui.countdown(STAGE_SECONDS, { onDone: () => { stageCd = null; act(TIMEOUT_ACTION[stage], { timeout: true }); } });
        }
      }

      async function revealBoard(from, to) {
        for (let i = from; i < to; i++) {
          if (cardEls.board[i]) continue;
          cardEls.board[i] = await dealUp(slots[i], state.hand.board[i]);
          if (!ctx.alive()) return;
        }
      }

      async function act(a, { timeout = false } = {}) {
        if (state.phase !== 'decision' || !state.flow || !state.flow.canAct(a)) return;
        const ante = state.stakes.ante;
        const mult = a.startsWith('raise') ? Number(a.slice(5)) : 0;
        if (mult && !ctx.bank.canAfford(round2(mult * ante))) { ui.toast('籌碼不足，不能加注', { type: 'warn' }); return; }
        if (stageCd) { stageCd.cancel(); stageCd = null; }
        const from = state.flow.stage;
        const next = state.flow.act(a);
        state.lastAction = a;
        state.decisions += 1;
        state.phase = 'dealing';
        showActions(null);
        if (timeout) ui.toast(`時間到，視為${T.actions[a].zh} <i class="en">${T.actions[a].en}</i>`, { type: 'warn' });
        if (mult) {
          const amt = round2(mult * ante);
          ctx.bank.debit(amt);
          state.staked = round2(state.staked + amt);
          state.stakes.play = amt;
          bets.set('play', amt);
          ctx.dealer.say(`加注 ${mult}×`, `Raise ${mult}×`);
        } else ctx.dealer.say(T.actions[a].zh, T.actions[a].en);
        paintHint();
        const hand = state.hand;
        if (next === 'flop') {
          await revealBoard(0, 3);
          if (!ctx.alive()) return;
          paintBadges(hand, { boardN: 3, dealerUp: false });
          beginStage();
          return;
        }
        if (next === 'river') {
          await revealBoard(3, 5);
          if (!ctx.alive()) return;
          paintBadges(hand, { boardN: 5, dealerUp: false });
          beginStage();
          return;
        }
        // 攤牌：翻完公共牌 → 莊家開牌
        await revealBoard(0, 5);
        if (!ctx.alive()) return;
        await ctx.wait(200);
        for (let i = 0; i < 2; i++) { await ui.flip(cardEls.dealer[i], hand.dealer[i]); if (!ctx.alive()) return; }
        finishRound(from);
      }

      function finishRound(lastStage) {
        const hand = state.hand, flow = state.flow;
        const r = settle(state.stakes, hand, { folded: flow.folded, playMult: flow.play });
        r.raisedAt = flow.raisedAt;
        r.lastStage = lastStage;
        state.lastResult = r;
        ctx.bank.credit(r.returned);
        state.staked = 0;
        paintBadges(hand, { boardN: 5, dealerUp: true });
        markWinner(r);
        markSpots(r.lines);
        ctx.dealer.say('派彩', 'Paying out');
        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
        ctx.explain(explainOf(r, hand, flow));
        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke(2 * ctx.limits.min);          // 每局最少 Ante + Blind（CR-4）
        ctx.nextRound(startRound);
      }

      // ---------------------------------------------------------- 結果面板內容
      function explainOf(r, hand, flow) {
        const hasTrips = r.lines.some((l) => l.spot === 'trips');
        const STAGE_ZH = { preflop: '翻牌前', flop: '翻牌後', river: '河牌後' };
        const handHtml = `<div class="uth-res">
          <div><span class="uth-res__k">公共牌 <i class="en">Board</i></span>${mcs(hand.board.slice(0, 3))}<span class="uth-res__sep"></span>${mcs(hand.board.slice(3))}</div>
          <div><span class="uth-res__k">你 <i class="en">You</i></span>${mcs(hand.player)} → 最佳 5 張 ${mcs(r.p.best5)} <b>${handName(r.p)}</b></div>
          <div><span class="uth-res__k">莊 <i class="en">Dealer</i></span>${mcs(hand.dealer)} → 最佳 5 張 ${mcs(r.d.best5)} <b>${handName(r.d)}</b></div>
          <div><span class="uth-res__k">合格 <i class="en">Qualify</i></span>${r.qual ? '<b class="lg-win">合格 ✓</b>' : '<b class="lg-lose">不合格 ✗</b>'}（需一對以上）</div>
          <div><span class="uth-res__k">你的決定</span>${flow.folded ? '河牌後棄牌' : flow.raisedAt ? `${STAGE_ZH[flow.raisedAt]}加注 ${flow.play}×` : '—'}</div>
        </div>`;
        const RESULT = {
          fold: '你棄牌 <i class="en">FOLD</i>',
          win: r.qual ? '你贏 <i class="en">YOU WIN</i>' : '你贏（莊不合格） <i class="en">YOU WIN · DEALER DOES NOT QUALIFY</i>',
          lose: '莊家贏 <i class="en">DEALER WINS</i>',
          tie: '平手 <i class="en">PUSH</i>',
        };
        const formula = r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>`;
        const pN = handName(r.p), dN = handName(r.d);
        const kk = (() => { const k = LG.poker.kicker(r.p, r.d); return k ? `（${k}）` : ''; })();   // 牌型相同 → 踢腳
        const why = [];
        if (r.outcome === 'fold') {
          why.push('棄牌輸 Ante + Blind（Trips 照算）。');
          const alt = settle({ ante: state.stakes.ante, blind: state.stakes.blind, play: state.stakes.ante }, hand, { playMult: 1 });
          why.push(`如果河牌加注 1×：你 ${pN} vs 莊 ${dN}，主注合計會是 ${money.fmtSigned(alt.net)}。`);
        } else if (r.outcome === 'win') {
          why.push(`你的 ${pN} 大於莊的 ${dN}${kk} → Play 1:1。`);
          why.push(r.qual ? '莊家有一對以上（合格）→ Ante 1:1。' : '莊家沒有一對（不合格）→ Ante 退回。');
          why.push(BLIND_PAY[r.p.cat] ? `Blind：你是${r.p.name.zh} → ${oddsTxt(BLIND_PAY[r.p.cat])}。` : 'Blind 只有順子以上才賠，你贏但沒到順子 → 退回。');
        } else if (r.outcome === 'lose') {
          why.push(`莊的 ${dN} 大於你的 ${pN}${kk} → Blind、Play 都輸；${r.qual ? 'Ante 也輸' : '莊不合格，Ante 退回'}。`);
        } else {
          why.push('兩邊最佳 5 張一樣大 → 平手，全部退回。');
        }
        if (hasTrips) {
          const tm = TRIPS_PAY[r.p.cat];
          why.push(tm ? `Trips 只看你的 7 張：${r.p.name.zh} → ${tm}:1（跟莊家無關）。` : `Trips 只看你的 7 張：${r.p.name.zh}，沒到三條 → 輸。`);
        }
        return { hand: handHtml, result: RESULT[r.outcome], formula, why: why.join('<br>') };
      }

      // ---------------------------------------------------------- 教學用
      const demo = {
        ensureBetting() { if (state.phase === 'idle' || state.phase === 'settled') startRound(); },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        show(ids) {
          if (['dealing', 'decision'].includes(state.phase)) return false;
          const P = LG.cards.parseMany;
          const hand = { player: P(ids.player), dealer: P(ids.dealer), board: P(ids.board) };
          clearTable();
          cardEls.player = hand.player.map((c) => put(playerHand, c, true));
          cardEls.dealer = hand.dealer.map((c) => put(dealerHand, c, true));
          cardEls.board = hand.board.map((c, i) => put(slots[i], c, true));
          paintBadges(hand, { boardN: 5, dealerUp: true });
          markWinner(settle({ ante: 50 }, hand));
          return true;
        },
        script(ids) { state.script = LG.cards.parseMany(ids); },
      };

      // 教學第一手：你 A♠K♦（任 A → 4×）、莊 9♣9♥、公共牌 K♠7♦2♣ 5♥J♠ → 你一對 K 贏，Blind 退回
      const TUTOR_HAND = 'AS KD 9C 9H KS 7D 2C 5H JS';

      function quizHtml(q, options, correct) {
        return `<div class="uth-quiz" data-quiz-group="${q}">${options.map(([v, label]) =>
          `<button type="button" class="lg-btn lg-btn--sm uth-quiz__btn" data-uth-quiz="${q}" data-answer="${v}" data-correct="${correct}">${label}</button>`).join('')}</div>`;
      }
      function quizCheck(q, correct, wrongMsg) {
        return (inst) => {
          const a = inst.state.quiz[q];
          if (!a) return '點上面的一個答案';
          return a === correct || wrongMsg;
        };
      }
      function onQuizClick(ev) {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-uth-quiz]') : null;
        if (!b) return;
        state.quiz[b.dataset.uthQuiz] = b.dataset.answer;
        const group = b.closest('.uth-quiz');
        if (group) group.querySelectorAll('[data-uth-quiz]').forEach((x) => {
          x.classList.toggle('is-picked', x === b);
          x.classList.toggle('is-right', x === b && x.dataset.answer === x.dataset.correct);
          x.classList.toggle('is-wrong', x === b && x.dataset.answer !== x.dataset.correct);
        });
      }

      function tutorialSteps() {
        const P = LG.cards.parseMany;
        const q1 = preflopAdvice(P('KD 5C'));
        const q2 = flopAdvice(P('9S 8S'), P('KH 9D 3C'));
        const q3hole = P('8C 3D'), q3board = P('KS JH 9D 5C 2S');
        const q3 = riverAdvice(q3hole, q3board);
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>上面是<b>莊家 <i class="en">Dealer</i></b>，中間 5 格<b>公共牌 <i class="en">Community cards</i></b>，下面是你和四個下注格。</p>',
            highlight: ['.uth-table'] },
          { id: 'layout-board', section: 'layout', title: '公共牌分兩次翻',
            body: '<p>先翻<b>翻牌 <i class="en">Flop</i></b> 3 張（F），再把<b>轉牌 <i class="en">Turn</i></b>（T）和<b>河牌 <i class="en">River</i></b>（R）一起翻。</p>',
            highlight: ['.uth-board'] },
          { id: 'layout-ante-blind', section: 'layout', title: '底注 <i class="en">Ante</i> + 盲注 <i class="en">Blind</i>',
            body: '<p>兩格<b>一定要押、而且同額</b>。你只要點 Ante，Blind 會自動放一樣多。</p>',
            highlight: ['[data-bet="ante"]', '[data-bet="blind"]'] },
          { id: 'layout-play', section: 'layout', title: '加注 <i class="en">Play</i>',
            body: '<p>看牌後決定加注，籌碼放這格：翻牌前 3× 或 4× Ante、翻牌後 2×、河牌 1×。用按鈕放，不用自己點。</p>',
            highlight: ['[data-bet="play"]'] },
          { id: 'layout-trips', section: 'layout', title: '三條旁注 <i class="en">Trips</i>',
            body: '<p>可選的<b>旁注 <i class="en">Side bet</i></b>：你的 7 張有三條以上就賠，跟莊家無關。</p>',
            highlight: ['[data-bet="trips"]'] },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p>押 Ante + Blind → 發牌 → 翻牌前、翻牌後、河牌後三次決定 → 莊家開牌。<b>整局只能加注一次</b>。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-ante', section: 'flow', title: '押 Ante（Blind 自動同額）',
            body: '<p>選籌碼、點「底注 ANTE」。看 Blind 格：自動變成一樣的金額。</p>',
            highlight: ['[data-bet="ante"]', '[data-bet="blind"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「底注 ANTE」放籌碼', check: (inst) => (inst.bets.get('ante') > 0 && inst.bets.get('blind') === inst.bets.get('ante')) || inst.state.rounds > 0 || '點一下「底注 ANTE」' } },
          { id: 'flow-deal', section: 'flow', title: '發牌 <i class="en">Deal</i>',
            body: '<p>按「發牌」：你 2 張（翻開）、莊家 2 張（蓋著）。公共牌還沒翻。</p>',
            highlight: ['[data-action="deal"]'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '按「發牌 Deal」', check: (inst) => inst.state.decisions > 0 || inst.state.phase === 'decision' || '先押 Ante，再按發牌' } },
          { id: 'flow-no-more-bets', section: 'flow', title: '停止下注 <i class="en">No more bets</i>',
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下——Ante、Blind、Trips 都不能再碰。之後只能用按鈕加注或棄牌。</p>',
            highlight: ['.lg-dealer-banner', '.uth-spots'] },
          { id: 'flow-preflop', section: 'flow', title: '翻牌前：過牌或 3× / 4×',
            body: '<p>你拿到 A♠K♦——<b>任何 A 都加注 4×</b>。越早加注倍數越大：翻牌前最多 4 倍。</p>',
            highlight: ['[data-action="raise4"]', '[data-action="raise3"]', '[data-action="check"]'],
            action: { label: '按「加注 4×」', check: (inst) => inst.state.decisions > 0 || (inst.state.phase === 'decision' ? '按「加注 4×」' : '先回上一步按「發牌」') } },
          { id: 'flow-once', section: 'flow', title: '加注過就不能再加',
            body: '<p>加注之後，後面兩次決定都<b>跳過</b>，直接翻完公共牌攤牌 <i class="en">Showdown</i>。一局只能加一次。</p>',
            highlight: ['.uth-board', '[data-bet="play"]'] },
          { id: 'flow-later', section: 'flow', title: '沒加注時：2× 或 1×',
            body: '<p>翻牌前過牌 <i class="en">Check</i>：翻牌後可 Check 或 2×；再過牌：河牌後只能 <b>1× 或棄牌 <i class="en">Fold</i></b>。</p>',
            highlight: ['.uth-actions'] },
          { id: 'flow-qualify', section: 'flow', title: '莊家合格 <i class="en">Qualify</i>',
            body: '<p>莊家要<b>一對以上</b>才合格。不合格時只有 Ante 退回，Blind 和 Play 照樣比大小。</p>',
            highlight: ['.uth-row--dealer', '.uth-rule'] },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼賠',
            body: `<p>Ante、Play 贏 1:1。Blind 照表：</p>${tbl([['你贏時', 'Blind'], ['皇家同花順', '500:1'], ['同花順', '50:1'], ['四條', '10:1'], ['葫蘆', '3:1'], ['同花', '3:2'], ['順子', '1:1'], ['其他', '退回']])}`,
            highlight: ['[data-bet="blind"]'] },
          { id: 'payout-blind-push', section: 'payout', title: '贏了但 Blind 退回',
            body: '<p>剛才那手：你一對 K 贏莊一對 9。Ante 50、Play 200 各 1:1 → <b>+RM 250</b>；Blind 沒到順子 → 退回。拿回 RM 550。</p>',
            highlight: ['[data-bet="blind"]', '.uth-row--player'],
            setup: (inst) => inst.demo.show({ player: 'AS KD', dealer: '9C 9H', board: 'KS 7D 2C 5H JS' }) },
          { id: 'payout-noqual', section: 'payout', title: '莊不合格 + 你順子',
            body: '<p>Ante/Blind 各 50、Play 100（2×）。莊沒有對子：<br>Ante 退回；Play <b>RM 100 × 1 = RM 100</b>；Blind 順子 <b>RM 50 × 1 = RM 50</b>。淨贏 RM 150，拿回 RM 350（含本金 RM 200）。</p>',
            highlight: ['.uth-row--dealer', '[data-bet="ante"]'],
            setup: (inst) => inst.demo.show({ player: '9S 8D', dealer: 'AC 4H', board: 'TH 7C 6S 2D KH' }) },
          { id: 'payout-lose', section: 'payout', title: '莊家贏：全部輸',
            body: '<p>莊合格而且比你大：Ante 50 + Blind 50 + Play 200 全輸 = <b>−RM 300</b>。所以 4× 要挑好牌。</p>',
            highlight: ['.uth-row--dealer'],
            setup: (inst) => inst.demo.show({ player: 'QS JD', dealer: 'AC KD', board: 'KH 7S 2C 9D 3S' }) },
          { id: 'payout-trips', section: 'payout', title: 'Trips 只看你的 7 張',
            body: `${tbl([['你的 7 張', 'Trips'], ['皇家', '50:1'], ['同花順', '40:1'], ['四條', '30:1'], ['葫蘆', '8:1'], ['同花', '7:1'], ['順子', '4:1'], ['三條', '3:1']])}<p>跟莊家無關，棄牌也照算。</p>`,
            highlight: ['[data-bet="trips"]'] },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: `${tbl([['注', '優勢'], ['Ante（最佳策略）', '2.19%'], ['Trips（本桌賠付表）', '3.50%']])}<p>優勢以 Ante 計：每押 RM 100 Ante 長期平均輸約 RM 2.19。</p>`,
            highlight: null },
          { id: 'strategy-4x', section: 'strategy', title: '該押：Ante + Blind，好牌早早 4×',
            body: `${tbl(RAISE4_TABLE)}<p>表上的牌翻牌前 4×；其他過牌。<b>永遠不要用 3×</b>，4× 比較好。</p>`,
            highlight: ['[data-bet="play"]'] },
          { id: 'strategy-2x1x', section: 'strategy', title: '2× 與 1× 的規則',
            body: '<p><b>翻牌後 2×</b>：兩對以上、用到手牌的一對、4 張同花且手牌有 10 以上同花色。<br><b>河牌 1×</b>：用到手牌的一對以上；或莊家 outs &lt; 21 張。</p>',
            highlight: ['.uth-board'] },
          { id: 'strategy-quiz1', section: 'strategy', title: '小測驗 1：翻牌前',
            body: `<p>你拿 K♦5♣（不同花），翻牌前怎麼做？</p>${quizHtml('q1', [['raise4', '加注 4×'], ['check', '過牌']], q1.action)}`,
            highlight: null,
            action: { label: '選出正確答案', check: quizCheck('q1', q1.action, '再想想：K 不同花從 K-5 開始 4×') } },
          { id: 'strategy-quiz2', section: 'strategy', title: '小測驗 2：翻牌後',
            body: `<p>你 9♠8♠，翻牌 K♥9♦3♣（還沒加注），怎麼做？</p>${quizHtml('q2', [['raise2', '加注 2×'], ['check', '過牌']], q2.action)}`,
            highlight: null,
            action: { label: '選出正確答案', check: quizCheck('q2', q2.action, '再想想：一對 9 有用到你的手牌') } },
          { id: 'strategy-quiz3', section: 'strategy', title: '小測驗 3：河牌',
            body: `<p>你 ${q3hole.map(cardTxt).join('')}，公共牌 ${q3board.map(cardTxt).join('')}，沒有對子。莊家有 <b>${q3.outs}</b> 張單牌能贏你。</p>${quizHtml('q3', [['raise1', '加注 1×'], ['fold', '棄牌']], q3.action)}`,
            highlight: null,
            action: { label: '選出正確答案', check: quizCheck('q3', q3.action, `再想想：outs ${q3.outs} 張 ≥ 21 要棄牌`) } },
          { id: 'strategy-avoid', section: 'strategy', title: '別押：Trips 旁注',
            body: '<p>這張賠付表的 Trips 優勢 <b>3.50%</b>，比 Ante 貴。7 張裡三條以上大約 15% 才出現一次。想玩久一點就別押。</p>',
            highlight: ['[data-bet="trips"]'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。每局最多要 6 倍 Ante（Ante + Blind + 4×）。上一手不影響下一手。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ---------------------------------------------------------- instance
      return {
        bets, state, demo,
        tray: () => tray,
        act,
        mount(el0) {
          root = el0;
          root.classList.add('uth-root');
          buildTable();
          if (ctx.isTutorial) {
            state.script = LG.cards.parseMany(TUTOR_HAND);
            document.addEventListener('click', onQuizClick);
            quizOff = () => document.removeEventListener('click', onQuizClick);
          }
          paintHint();
          ctx.on('hints:change', paintHint);
          if (ctx.isPractice) ctx.strategyPanel(strategyHtml());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (stageCd) { stageCd.cancel(); stageCd = null; }
          if (quizOff) { quizOff(); quizOff = null; }
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
