// ============================================================================
// 百家樂 Baccarat（id: baccarat）— 規格：docs/05-game-rules/baccarat.md
//
// 四個變體：classic（抽 5% 佣）/ super6（免佣 Super 6）/ tiger（老虎百家樂）/ squeeze（咪牌）
// 規則、第三張牌、結算全部交給 LG.baccarat（src/core/11-baccarat-lib.js）；本檔負責：
//   桌面（CSS 畫）、下注格、發牌動畫、咪牌、唱牌、練習解說、珠盤路、教學、真實模式限注。
// 金流照 CR-A1：下注階段不扣款；No more bets 後 debit；結算 credit(拿回含本金)。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el } = ui;
  const { fmt, fmtSigned } = money;
  const B = LG.baccarat;

  // ---------------------------------------------------------------- 文案 / 常數（集中管理）
  const T = {
    name: { zh: '百家樂', en: 'Baccarat' },
    summary: '押莊或閒，比誰接近 9 點。莊最划算，和與對子是給賭場賺的。',
    side: {
      banker: { zh: '莊', en: 'Banker', cls: 'is-banker' },
      player: { zh: '閒', en: 'Player', cls: 'is-player' },
    },
    // 下注格：zh / en（桌面大寫）/ 賠率 / 規則小字
    spots: {
      player: { zh: '閒', en: 'PLAYER', odds: '1:1' },
      banker: { zh: '莊', en: 'BANKER', odds: '1:1', oddsComm: '0.95:1（抽 5% 佣）' },
      tie: { zh: '和', en: 'TIE', odds: '8:1', rule: '莊閒同點' },
      playerPair: { zh: '閒對', en: 'P. PAIR', odds: '11:1', rule: '閒前兩張成對' },
      bankerPair: { zh: '莊對', en: 'B. PAIR', odds: '11:1', rule: '莊前兩張成對' },
      super6: { zh: '超級六', en: 'SUPER 6', odds: '12:1', rule: '莊以 6 點贏' },
      tiger: { zh: '老虎', en: 'TIGER', odds: '12:1 / 20:1', rule: '莊 6 點贏（2 張 / 3 張）' },
      bigTiger: { zh: '大老虎', en: 'BIG TIGER', odds: '50:1', rule: '莊 3 張 6 點贏' },
      smallTiger: { zh: '小老虎', en: 'SMALL TIGER', odds: '22:1', rule: '莊 2 張 6 點贏' },
      tigerTie: { zh: '老虎和', en: 'TIGER TIE', odds: '35:1', rule: '6 點和局' },
      tigerPair: { zh: '老虎對', en: 'TIGER PAIR', odds: '4 / 20 / 100:1', rule: '單對 / 雙對 / 同點雙對' },
    },
    b6note: { zh: '莊 6 點贏只賠一半', en: 'Banker wins on 6 pays 1/2' },
    outcome: {
      P: { zh: '閒贏', en: 'Player wins', big: 'PLAYER WINS' },
      B: { zh: '莊贏', en: 'Banker wins', big: 'BANKER WINS' },
      T: { zh: '和局', en: 'Tie', big: 'TIE' },
    },
    call: {
      bets: ['請下注', 'Place your bets'],
      dealing: ['發牌', 'Dealing'],
      squeeze: ['請開牌', 'Card please'],
      shuffle: ['洗牌', 'Shuffling'],
      natural: ['天牌', 'Natural'],
      pDraw: ['閒補牌', 'Player draws'],
      bDraw: ['莊補牌', 'Banker draws'],
    },
    hint: {
      comm: '建議：押<b>莊</b>（優勢最低 1.06%）。和、對子是高風險旁注。',
      nocomm: '建議：免佣桌押<b>閒</b>（1.24%）或<b>莊</b>（1.46%）——莊 6 點贏只賠一半，所以閒反而略優。旁注都是高風險。',
      risk: '高風險',
    },
    road: {
      title: '路單 <i class="en">Roadmap</i> · 珠盤路 <i class="en">Bead Plate</i>',
      note: '只是紀錄，不能預測',
    },
    // 教學互動題：answer = 正確選項
    quiz: {
      commission: { q: '押莊 RM 100 贏了（抽 5% 佣），拿回多少（含本金）？', options: ['RM 190', 'RM 195', 'RM 200'], answer: 'RM 195',
        wrong: '再算一次：RM 100 × 0.95 = RM 95 淨贏，加上本金 RM 100' },
      super6: { q: '免佣桌押莊 RM 100，莊以 6 點贏，拿回多少（含本金）？', options: ['RM 150', 'RM 195', 'RM 200'], answer: 'RM 150',
        wrong: '莊 6 點贏只賠一半：RM 100 × 0.5 = RM 50，加本金 RM 100' },
      tie: { q: '押閒 RM 100 + 和 RM 10，開出和局，淨輸贏是多少？', options: ['−RM 20', '+RM 80', '+RM 90'], answer: '+RM 80',
        wrong: '和局時閒注退回（RM 0），和注 RM 10 × 8 = +RM 80' },
    },
  };

  /** 莊家優勢（docs/05-game-rules/00-common.md §4） */
  const EDGE = {
    bankerComm: 1.06, player: 1.24, bankerNoComm: 1.46, tie: 14.36, pair: 10.36,
    super6: 29.98, tiger: 7.66, bigTiger: 6.03, smallTiger: 5.36, tigerTie: 9.9, tigerPair: 8.9,
  };
  const SPOT_EDGE = {
    tie: EDGE.tie, playerPair: EDGE.pair, bankerPair: EDGE.pair, super6: EDGE.super6, tiger: EDGE.tiger,
    bigTiger: EDGE.bigTiger, smallTiger: EDGE.smallTiger, tigerTie: EDGE.tigerTie, tigerPair: EDGE.tigerPair,
  };

  /** 旁注列（依變體）；對子與和在所有變體都有 */
  const SIDES = {
    classic: [], squeeze: [], super6: ['super6'],
    tiger: ['tiger', 'bigTiger', 'smallTiger', 'tigerTie', 'tigerPair'],
  };
  const noComm = (v) => v === 'super6' || v === 'tiger';
  /** 此變體所有下注格 */
  const spotsFor = (v) => ['bankerPair', 'playerPair', 'tie', 'banker', 'player', ...(SIDES[v] || [])];

  /** 真實模式每格限額（規格 §8：主注 50–5,000；和 10–500；對子/老虎/Super 6 旁注 10–1,000） */
  const REAL_RULES = {
    player: { min: 50, max: 5000 }, banker: { min: 50, max: 5000 }, tie: { min: 10, max: 500 },
    playerPair: { min: 10, max: 1000 }, bankerPair: { min: 10, max: 1000 }, super6: { min: 10, max: 1000 },
    tiger: { min: 10, max: 1000 }, bigTiger: { min: 10, max: 1000 }, smallTiger: { min: 10, max: 1000 },
    tigerTie: { min: 10, max: 1000 }, tigerPair: { min: 10, max: 1000 },
  };

  // ---------------------------------------------------------------- 純邏輯（單元測試用 def.logic）
  const cardLabel = (c) => `${c.rank === 'T' ? '10' : c.rank}${ui.SUIT[c.suit].symbol}`;
  const handText = (cards) => cards.map(cardLabel).join(' ');

  /** 建立下注模型。mode: 'real' → spotRules；其他 → 每格 limits.min–limits.max */
  function makeBets(mode, limits = { min: 10, max: 100000 }) {
    const labels = {};
    for (const [id, s] of Object.entries(T.spots)) labels[id] = `${s.zh} ${s.en}`;
    if (mode === 'real') return new LG.Bets({ min: 0, max: Infinity, spotRules: REAL_RULES, labels });
    return new LG.Bets({ min: 0, max: Infinity, perSpotMin: limits.min, perSpotMax: limits.max, labels });
  }

  /** 莊第三張的規則文字（莊兩張點數 b2） */
  function bankerRuleText(b2) {
    return ['一律補', '一律補', '一律補', '閒第三張不是 8 就補', '閒第三張 2–7 補', '閒第三張 4–7 補', '閒第三張 6–7 補', '停'][b2] || '停';
  }

  /** 補牌理由（繁中句子陣列）— 練習「為什麼」與教學用 */
  function drawReason(coup) {
    const p2 = B.total(coup.player.slice(0, 2));
    const b2 = B.total(coup.banker.slice(0, 2));
    const out = [];
    if (coup.natural) {
      const who = [p2 >= 8 ? `閒 ${p2}` : '', b2 >= 8 ? `莊 ${b2}` : ''].filter(Boolean).join('、');
      out.push(`${who} 點是天牌 <i class="en">Natural</i>，雙方都不補牌。`);
      return out;
    }
    out.push(p2 <= 5 ? `閒兩張 ${p2} 點 → 補牌（閒 0–5 補）。` : `閒兩張 ${p2} 點 → 停牌（閒 6–7 停）。`);
    const drew = coup.banker.length === 3;
    if (coup.player.length === 2) {
      out.push(`閒沒補牌，莊兩張 ${b2} 點 → ${drew ? '補牌（莊 0–5 補）' : '停牌（莊 6–7 停）'}。`);
    } else {
      const x = B.point(coup.player[2]);
      out.push(`莊兩張 ${b2} 點、閒第三張 ${x} 點 → 查表「莊 ${b2}：${bankerRuleText(b2)}」→ ${drew ? '補牌' : '停牌'}。`);
    }
    return out;
  }

  /** 單條賠付算式：贏寫淨贏與拿回，push 寫退回，輸寫 −本金 */
  function lineFormula(l) {
    const nm = l.name.zh;
    if (l.result === 'win') return `${nm} ${fmt(l.stake)} × ${l.odds} = ${fmtSigned(l.pay)}（拿回 ${fmt(l.returned)}）`;
    if (l.result === 'push') return `${nm} ${fmt(l.stake)} 和局退回 <i class="en">Push</i> → RM 0（拿回 ${fmt(l.stake)}）`;
    return `${nm} ${fmt(l.stake)} 輸 → ${fmtSigned(-l.stake)}`;
  }

  /** ctx.explain 的四段內容 */
  function describe(coup, r) {
    const o = T.outcome[coup.outcome];
    const pairs = [coup.playerPair && '閒對子', coup.bankerPair && '莊對子'].filter(Boolean);
    const hand = `閒 <b>${coup.pTotal}</b>（${handText(coup.player)}） vs 莊 <b>${coup.bTotal}</b>（${handText(coup.banker)}）`
      + (pairs.length ? `<br>${pairs.join('、')}` : '');
    const notes = [coup.natural && '天牌', coup.bankerWinsWith6 && `莊以 6 點贏（${coup.bankerCards} 張）`].filter(Boolean);
    const result = `${o.zh} <i class="en">${o.big}</i>${notes.length ? `（${notes.join('，')}）` : ''}`;
    const formula = r.lines.map(lineFormula).join('<br>') + `<br>淨 <b>${fmtSigned(r.net)}</b>`;
    const cmp = coup.outcome === 'T' ? `閒 ${coup.pTotal} = 莊 ${coup.bTotal}，和局：莊/閒主注退回。`
      : `${coup.outcome === 'P' ? `閒 ${coup.pTotal} > 莊 ${coup.bTotal}` : `莊 ${coup.bTotal} > 閒 ${coup.pTotal}`}，${o.zh}。`;
    const lineWhy = r.lines.filter((l) => l.spot !== 'player' && l.spot !== 'banker').map((l) => `${l.name.zh}：${l.why}。`);
    const why = [...drawReason(coup), cmp, ...lineWhy].join('<br>');
    return { hand, result, formula, why };
  }

  /** 珠盤路格位：由上而下、由左而右（6 行）。至少 minCols 欄。→ [{col,row,entry|null}] */
  function beadCells(history, { rows = 6, minCols = 12 } = {}) {
    const cols = Math.max(minCols, Math.ceil(history.length / rows) + 1);
    const out = [];
    for (let i = 0; i < cols * rows; i++) out.push({ col: Math.floor(i / rows), row: i % rows, entry: history[i] || null });
    return out;
  }

  /** 路單紀錄一筆 */
  const roadEntry = (coup) => ({ o: coup.outcome, pp: coup.playerPair, bp: coup.bankerPair, p: coup.pTotal, b: coup.bTotal });

  /** 教學示範用的路單（固定，不是預測） */
  const DEMO_ROAD = 'B P P T B B P B P B B P T P B B P P B'.split(' ').map((o, i) => ({ o, pp: i === 4, bp: i === 9, p: 0, b: 0 }));

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'baccarat',
    category: 'table',
    order: 1,
    name: T.name,
    summary: T.summary,
    houseEdge: [
      { bet: { zh: '莊（抽 5% 佣）', en: 'Banker' }, edge: EDGE.bankerComm, best: true },
      { bet: { zh: '閒', en: 'Player' }, edge: EDGE.player },
      { bet: { zh: '莊（免佣 Super 6 / 老虎，6 點贏賠一半）', en: 'Banker (no commission)' }, edge: EDGE.bankerNoComm },
      { bet: { zh: '和 8:1', en: 'Tie' }, edge: EDGE.tie },
      { bet: { zh: '閒對 / 莊對 11:1', en: 'Pair' }, edge: EDGE.pair },
      { bet: { zh: 'Super 6 12:1', en: 'Super 6' }, edge: EDGE.super6 },
      { bet: { zh: '老虎', en: 'Tiger' }, edge: EDGE.tiger, approx: true },
      { bet: { zh: '大老虎', en: 'Big Tiger' }, edge: EDGE.bigTiger, approx: true },
      { bet: { zh: '小老虎', en: 'Small Tiger' }, edge: EDGE.smallTiger, approx: true },
      { bet: { zh: '老虎和', en: 'Tiger Tie' }, edge: EDGE.tigerTie, approx: true },
      { bet: { zh: '老虎對', en: 'Tiger Pair' }, edge: EDGE.tigerPair, approx: true },
    ],
    limits: { real: { min: 50, max: 5000 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 15,
    variants: [
      { id: 'classic', name: { zh: '傳統', en: 'Commission' } },
      { id: 'super6', name: { zh: '免佣', en: 'Super 6' } },
      { id: 'tiger', name: { zh: '老虎', en: 'Tiger' } },
      { id: 'squeeze', name: { zh: '咪牌', en: 'Squeeze' } },
    ],
    logic: {
      T, EDGE, SPOT_EDGE, SIDES, REAL_RULES, spotsFor, noComm, makeBets, drawReason, bankerRuleText,
      lineFormula, describe, beadCells, roadEntry, cardLabel,
    },

    create(ctx) {
      const variant = SIDES[ctx.variant] ? ctx.variant : 'classic';
      const isSqueeze = variant === 'squeeze';
      const state = {
        phase: 'idle', rounds: 0, staked: 0, road: [], last: null,
        shown: { player: [], banker: [] }, squeezers: new Set(), quiz: {}, demoSqueezed: false,
        shoe: null,
      };
      const bets = makeBets(ctx.mode, ctx.limits);
      let root, tableEl, hintEl, tray, layer, bar, roadEl, roadCount;
      const spotEls = new Map();
      const hands = {};

      function newShoe() {
        state.shoe = LG.cards.newShoe(8, { cutCard: 14 });
        B.burnStart(state.shoe);
      }
      newShoe();

      // ---------------------------------------------------------- 桌面
      function spotEl(id) {
        const s = T.spots[id];
        const main = id === 'player' || id === 'banker';
        const odds = id === 'banker' && !noComm(variant) ? s.oddsComm : s.odds;
        const kids = [
          el('span.lg-spot__zh', { text: s.zh }),
          el('span.lg-spot__en', { text: s.en }),
          el('span.lg-spot__odds', { text: odds }),
        ];
        if (s.rule) kids.push(el('span.bac-spot__rule', { text: s.rule }));
        if (id === 'banker' && noComm(variant)) {
          kids.push(el('span.bac-note', { html: `${T.b6note.en}<br><small>${T.b6note.zh}</small>` }));
        }
        if (SPOT_EDGE[id]) kids.push(el('span.bac-risk', { text: `${T.hint.risk} · 優勢 ${SPOT_EDGE[id]}%` }));
        const e = el('div', { class: ['lg-spot', 'bac-spot', `bac-spot--${id}`, main && 'bac-spot--main'], dataset: { bet: id } }, kids);
        spotEls.set(id, e);
        return e;
      }

      function handEl(side) {
        const s = T.side[side];
        const total = el('span.lg-hand__total.bac-hand__total', { dataset: { role: `${side}-total` }, text: '–' });
        const cards = el('div.lg-hand.bac-hand__cards');
        const box = el('div', { class: ['bac-hand', s.cls], dataset: { side } }, [
          el('div.bac-hand__head', [el('span.bac-hand__name', { html: `${s.zh} <i class="en">${s.en.toUpperCase()}</i>` }), total]),
          cards,
        ]);
        hands[side] = { box, cards, total };
        return box;
      }

      function buildTable() {
        const sides = SIDES[variant];
        roadEl = el('div.bac-bead', { dataset: { role: 'bead' } });
        roadCount = el('span.bac-road__count');
        tableEl = el('div.lg-table.bac-table', { dataset: { variant } }, [
          el('div.lg-table__label', { html: '荷官 <i class="en">Dealer</i>' }),
          el('div.bac-cards', [handEl('banker'), handEl('player')]),
          el('div.bac-pairs', [spotEl('bankerPair'), spotEl('playerPair')]),
          el('div.bac-main.lg-table__line', [spotEl('tie'), spotEl('banker'), spotEl('player')]),
          sides.length ? el('div', { class: ['bac-sides', `bac-sides--${sides.length}`] }, sides.map(spotEl)) : null,
          el('div.bac-road', [
            el('div.bac-road__head', [el('span.bac-road__title', { html: T.road.title }), roadCount]),
            el('div.bac-road__scroll', [roadEl]),
            el('div.bac-road__note', { text: `${T.road.note}（紅 = 莊、藍 = 閒、綠 = 和；小點 = 對子）` }),
          ]),
        ]);
        hintEl = el('div.lg-hint.bac-hint', { hidden: true });
        const actions = el('div.lg-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        root.append(tableEl, hintEl, actions, chips, barEl);
        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 50 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId });
        bar = ui.betBar(barEl, { bets, layer });
        bets.subscribe(() => { if (state.phase === 'betting' && bets.total() > 0) clearMarks(); });
      }

      // ---------------------------------------------------------- 牌區
      function clearHands() {
        state.squeezers.forEach((h) => h.destroy());
        state.squeezers.clear();
        for (const side of ['player', 'banker']) {
          hands[side].cards.innerHTML = '';
          hands[side].box.classList.remove('is-winner');
          state.shown[side] = [];
        }
        paintTotals();
      }
      function paintTotals() {
        for (const side of ['player', 'banker']) {
          const list = state.shown[side];
          hands[side].total.textContent = list.length ? String(B.total(list)) : '–';
          hands[side].total.dataset.total = list.length ? String(B.total(list)) : '';
        }
      }
      function addCard(side, card, { faceDown = true, third = false } = {}) {
        const e = ui.card(card, { faceDown, size: 'md' });
        if (third) e.classList.add('bac-card--third');
        hands[side].cards.appendChild(e);
        if (!faceDown) { state.shown[side].push(card); paintTotals(); }
        return e;
      }
      function revealed(side, card) { state.shown[side].push(card); paintTotals(); }

      function clearMarks() {
        spotEls.forEach((e) => e.classList.remove('is-win', 'is-lose'));
        for (const side of ['player', 'banker']) hands[side].box.classList.remove('is-winner');
      }
      function markSpots(coup, r) {
        const winMain = { P: 'player', B: 'banker', T: 'tie' }[coup.outcome];
        spotEls.forEach((e, id) => {
          const line = r.lines.find((l) => l.spot === id);
          e.classList.toggle('is-win', line ? line.result === 'win' : id === winMain);
          e.classList.toggle('is-lose', !!line && line.result === 'lose');
        });
        if (coup.outcome !== 'T') hands[winMain].box.classList.add('is-winner');
      }

      // ---------------------------------------------------------- 路單（珠盤路）
      function paintRoad() {
        roadEl.innerHTML = '';
        for (const c of beadCells(state.road)) {
          const x = c.entry;
          const cell = el('div', { class: ['bac-bead__c', x && `is-${x.o}`], dataset: x ? { outcome: x.o } : {} });
          if (x) {
            cell.textContent = { B: '莊', P: '閒', T: '和' }[x.o];
            if (x.bp) cell.appendChild(el('span.bac-bead__bp', { title: '莊對 Banker pair' }));
            if (x.pp) cell.appendChild(el('span.bac-bead__pp', { title: '閒對 Player pair' }));
          }
          roadEl.appendChild(cell);
        }
        const n = (o) => state.road.filter((x) => x.o === o).length;
        roadCount.innerHTML = `莊 ${n('B')} · 閒 ${n('P')} · 和 ${n('T')}`;
        const sc = roadEl.parentElement;
        if (sc && state.road.length) { try { sc.scrollLeft = sc.scrollWidth; } catch { /* */ } }
      }

      // ---------------------------------------------------------- 練習提示
      function paintHints() {
        const on = !!ctx.hints;
        hintEl.hidden = !on;
        hintEl.innerHTML = noComm(variant) ? T.hint.nocomm : T.hint.comm;
        tableEl.classList.toggle('bac-hints-on', on);
      }
      function edgeTable() {
        const rows = [['注 <i class="en">Bet</i>', '賠率', '優勢']];
        if (noComm(variant)) rows.push(['閒 Player', '1:1', `${EDGE.player}%`], ['莊 Banker', '1:1（6 點贏 0.5:1）', `${EDGE.bankerNoComm}%`]);
        else rows.push(['莊 Banker', '0.95:1', `<b>${EDGE.bankerComm}%</b>`], ['閒 Player', '1:1', `${EDGE.player}%`]);
        rows.push(['和 Tie', '8:1', `${EDGE.tie}%`], ['對子 Pair', '11:1', `${EDGE.pair}%`]);
        if (variant === 'super6') rows.push(['Super 6', '12:1', `${EDGE.super6}%`]);
        if (variant === 'tiger') {
          for (const id of SIDES.tiger) rows.push([`${T.spots[id].zh} ${T.spots[id].en}`, T.spots[id].odds, `≈${SPOT_EDGE[id]}%`]);
        }
        return ui.table(rows, { caption: '莊家優勢 <i class="en">House edge</i>（越低越划算）' });
      }
      function thirdCardTable() {
        return ui.table([
          ['莊兩張', '閒沒補牌', '閒有補牌（看閒第三張）'],
          ['0–2', '補', '一律補'], ['3', '補', '閒第三張 ≠ 8 補'], ['4', '補', '閒第三張 2–7 補'],
          ['5', '補', '閒第三張 4–7 補'], ['6', '停', '閒第三張 6–7 補'], ['7', '停', '停'],
        ], { caption: '莊補第三張 <i class="en">Banker third card</i>（8–9 天牌不補）' });
      }
      const html = (node) => (node && node.outerHTML) || '';

      // ---------------------------------------------------------- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        ctx.bettingWindow({ bets, onClose: onNoMoreBets });
      }

      async function onNoMoreBets({ ok, validation }) {
        if (!ok) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(validation.zh, { type: 'warn' });
          ctx.nextRound(startRound);
          return;
        }
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'dealing';
        clearMarks();
        clearHands();
        if (state.shoe.needsShuffle()) {
          ctx.dealer.say(...T.call.shuffle);
          newShoe();
          state.road = [];
          paintRoad();
          await ctx.wait(700);
          if (!ctx.alive()) return;
        }
        ctx.dealer.say(...T.call.dealing);
        const coup = B.dealCoup(state.shoe);
        const done = isSqueeze ? await playSqueeze(coup) : await playNormal(coup);
        if (!done || !ctx.alive()) return;
        await callCoup(coup);
        if (!ctx.alive()) return;
        finishRound(coup);
      }

      /** 一般發牌：閒、莊、閒、莊逐張翻開，再依規則補第三張 */
      async function playNormal(coup) {
        const seq = [['player', coup.player[0]], ['banker', coup.banker[0]], ['player', coup.player[1]], ['banker', coup.banker[1]]];
        for (const [side, c] of seq) {
          const e = addCard(side, c);
          await ctx.wait(220);
          if (!ctx.alive()) return false;
          await ui.flip(e, c);
          if (!ctx.alive()) return false;
          revealed(side, c);
        }
        if (coup.natural) { ctx.dealer.say(...T.call.natural); await ctx.wait(600); }
        for (const side of ['player', 'banker']) {
          const c = coup[side][2];
          if (!c) continue;
          ctx.dealer.say(...(side === 'player' ? T.call.pDraw : T.call.bDraw));
          await ctx.wait(450);
          if (!ctx.alive()) return false;
          const e = addCard(side, c, { third: true });
          await ctx.wait(200);
          await ui.flip(e, c);
          if (!ctx.alive()) return false;
          revealed(side, c);
        }
        return true;
      }

      /** 咪牌時把牌區捲進畫面（按「發牌」後畫面通常在下方） */
      function showCards() {
        const box = tableEl.querySelector('.bac-cards');
        if (box && box.scrollIntoView) { try { box.scrollIntoView({ block: 'center' }); } catch { /* */ } }
      }
      /** 咪牌：牌蓋著發，玩家用 squeezeable 掀；全部掀完才繼續 */
      function squeeze(side, c, e) {
        return new Promise((resolve) => {
          const h = ui.squeezeable(e, c, {
            onRevealed: () => { state.squeezers.delete(h); revealed(side, c); resolve(); },
          });
          state.squeezers.add(h);
        });
      }
      async function playSqueeze(coup) {
        state.phase = 'squeeze';
        const seq = [['player', coup.player[0]], ['banker', coup.banker[0]], ['player', coup.player[1]], ['banker', coup.banker[1]]];
        const els = [];
        for (const [side, c] of seq) {
          els.push([side, c, addCard(side, c)]);
          await ctx.wait(180);
          if (!ctx.alive()) return false;
        }
        ctx.dealer.say(...T.call.squeeze);
        showCards();
        await Promise.all(els.map(([side, c, e]) => squeeze(side, c, e)));
        if (!ctx.alive()) return false;
        if (coup.natural) { ctx.dealer.say(...T.call.natural); await ctx.wait(600); }
        for (const side of ['player', 'banker']) {
          const c = coup[side][2];
          if (!c) continue;
          const [zh, en] = side === 'player' ? T.call.pDraw : T.call.bDraw;
          const e = addCard(side, c, { third: true });
          ctx.dealer.say(`${zh}，${T.call.squeeze[0]}`, `${en} · ${T.call.squeeze[1]}`);
          showCards();
          await squeeze(side, c, e);
          if (!ctx.alive()) return false;
        }
        state.phase = 'dealing';
        return true;
      }

      /** 唱牌：閒 X 點 → 莊 Y 點 → 宣布結果 */
      async function callCoup(coup) {
        ctx.dealer.say(`閒 ${coup.pTotal} 點`, `Player ${coup.pTotal}`);
        await ctx.wait(550);
        if (!ctx.alive()) return;
        ctx.dealer.say(`莊 ${coup.bTotal} 點`, `Banker ${coup.bTotal}`);
        await ctx.wait(550);
        if (!ctx.alive()) return;
        const o = T.outcome[coup.outcome];
        ctx.dealer.say(o.zh, o.en);
      }

      function finishRound(coup) {
        const r = B.settle(bets.entries(), coup, variant);
        ctx.bank.credit(r.returned);
        state.staked = 0;
        state.road.push(roadEntry(coup));
        paintRoad();
        markSpots(coup, r);
        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
        ctx.explain({ ...describe(coup, r), net: r.net });
        state.rounds += 1;
        state.last = { coup, r };
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      // ---------------------------------------------------------- 教學互動題（事件委派）
      function onQuiz(ev) {
        const b = ev.target && ev.target.closest ? ev.target.closest('[data-bac-quiz]') : null;
        if (!b) return;
        const q = b.dataset.bacQuiz;
        state.quiz[q] = b.dataset.answer;
        const ok = b.dataset.answer === T.quiz[q].answer;
        b.parentElement.querySelectorAll('[data-bac-quiz]').forEach((x) => x.classList.remove('is-right', 'is-wrong'));
        b.classList.add(ok ? 'is-right' : 'is-wrong');
      }
      const quizHtml = (q) => `<p>${T.quiz[q].q}</p><div class="bac-quiz">${T.quiz[q].options
        .map((o) => `<button type="button" class="lg-btn lg-btn--sm bac-quiz__opt" data-bac-quiz="${q}" data-answer="${o}">${o}</button>`).join('')}</div>`;
      const quizCheck = (q) => (inst) => {
        const a = inst.state.quiz[q];
        if (a === T.quiz[q].answer) return true;
        return a ? T.quiz[q].wrong : '點選一個答案';
      };

      // ---------------------------------------------------------- 教學示範
      const busy = () => state.phase === 'dealing' || state.phase === 'squeeze';
      const demo = {
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        ensureBetting() { if (state.phase !== 'betting' && !busy()) startRound(); },
        /** 擺一手指定牌（前兩張，其餘依規則由 extra 補）並翻開 */
        showCoup(p, b, extra = '') {
          if (busy()) return null;
          const shoe = LG.cards.newShoe(1).stack(extra || '2S 3S');
          const coup = B.resolveCoup(LG.cards.parseMany(p), LG.cards.parseMany(b), shoe);
          clearMarks();
          clearHands();
          coup.player.forEach((c, i) => addCard('player', c, { faceDown: false, third: i === 2 }));
          coup.banker.forEach((c, i) => addCard('banker', c, { faceDown: false, third: i === 2 }));
          return coup;
        },
        /** 牌序示範：閒、莊、閒、莊（標號） */
        showOrder() {
          const coup = demo.showCoup('4S 3H', '9C KD');
          if (!coup) return;
          const order = [['player', 0, 1], ['banker', 0, 2], ['player', 1, 3], ['banker', 1, 4]];
          for (const [side, i, n] of order) {
            const c = hands[side].cards.children[i];
            if (c) c.appendChild(el('span.bac-order', { text: String(n) }));
          }
        },
        fillRoad() { if (!state.road.length) { state.road = DEMO_ROAD.slice(); paintRoad(); } },
        /** 咪牌練習：閒位放一張可拖曳的蓋牌 */
        squeezeCard() {
          if (busy()) return;
          clearMarks();
          clearHands();
          const c = LG.cards.parse('9H');
          const e = addCard('player', c);
          const h = ui.squeezeable(e, c, { onRevealed: () => { state.squeezers.delete(h); state.demoSqueezed = true; revealed('player', c); } });
          state.squeezers.add(h);
        },
      };

      // ---------------------------------------------------------- 教學步驟
      function tutorialSteps() {
        const nc = noComm(variant);
        const sideStep = variant === 'super6'
          ? { title: `Super 6 旁注 <i class="en">Super 6</i>`, body: '<p>莊以 6 點贏時，Super 6 賠 <b>12:1</b>。這張桌免佣，但莊 6 點贏只賠一半（格內英文 <b>Banker wins on 6 pays 1/2</b>）。</p>',
            highlight: ['[data-bet="super6"]', '.bac-note'] }
          : variant === 'tiger'
            ? { title: `老虎旁注 <i class="en">Tiger side bets</i>`, body: '<p>五個老虎旁注都跟「莊 6 點」有關：老虎、大老虎、小老虎、老虎和、老虎對。這張桌莊 6 點贏只賠一半。</p>',
              highlight: ['.bac-sides', '.bac-note'] }
            : { title: `變體旁注 <i class="en">Side bets</i>`, body: '<p>這張是傳統桌，旁注只有對子與和。上方「變體」可切到 <b>Super 6</b> 或 <b>老虎</b> 桌，會多出不同旁注格。</p>',
              highlight: ['.lg-variantbar'] };
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：桌面',
            body: '<p>百家樂只比兩手牌：<b>莊 <i class="en">Banker</i></b> 和 <b>閒 <i class="en">Player</i></b>，誰接近 9 點誰贏。你不用做任何決定，只要選押哪邊。</p>',
            highlight: ['.bac-table'] },
          { id: 'layout-main', section: 'layout', title: `莊 <i class="en">Banker</i> / 閒 <i class="en">Player</i>`,
            body: nc ? '<p>主注兩格：押莊或押閒，都賠 <b>1:1</b>。這張免佣桌例外：莊以 6 點贏只賠一半。</p>'
              : '<p>主注兩格：押閒賠 <b>1:1</b>；押莊也是 1:1，但要抽 <b>5% 佣 <i class="en">Commission</i></b>，實拿 0.95 倍。</p>',
            highlight: ['[data-bet="banker"]', '[data-bet="player"]'] },
          { id: 'layout-tie', section: 'layout', title: `和 <i class="en">Tie</i>`,
            body: '<p>莊閒同點數就是和局，押和賠 <b>8:1</b>。和局時莊、閒主注退回。</p>',
            highlight: ['[data-bet="tie"]'] },
          { id: 'layout-pairs', section: 'layout', title: `對子 <i class="en">Pair</i>`,
            body: '<p><b>閒對 <i class="en">P. Pair</i></b>、<b>莊對 <i class="en">B. Pair</i></b>：那一邊前兩張同點數字母（如 K♠K♥），賠 <b>11:1</b>。</p>',
            highlight: ['[data-bet="bankerPair"]', '[data-bet="playerPair"]'] },
          { id: 'layout-sides', section: 'layout', ...sideStep },
          { id: 'layout-road', section: 'layout', title: `路單 <i class="en">Roadmap</i>`,
            body: '<p><b>珠盤路 <i class="en">Bead plate</i></b>：每局一格，由上往下、再往右。紅莊、藍閒、綠和，小點是對子。<b>只是紀錄，不能預測。</b></p>',
            highlight: ['.bac-road'],
            setup: (inst) => inst.demo.fillRoad() },
          { id: 'layout-chips', section: 'layout', title: `籌碼 <i class="en">Chips</i>`,
            body: '<p>顏色代表面額：10 藍、25 綠、50 橙、100 黑、500 紫、1000 黃。現場顏色可能不同，看面額。</p>',
            highlight: ['.lg-chips'],
            action: { label: '點選橙色的 RM 50 籌碼', check: (inst) => inst.tray().selected() === 50 || '點一下「50」那枚籌碼' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: `<p>荷官說 <b>請下注 <i class="en">Place your bets</i></b> 才能放籌碼。真實桌會倒數約 <b>15 秒</b>，時間到就停止。</p>`,
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner(...T.call.bets); } },
          { id: 'flow-place', section: 'flow', title: '放籌碼',
            body: '<p>點下注格放一枚目前選的籌碼；長按或右鍵拿回一枚。</p>',
            highlight: ['[data-bet="banker"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「莊 BANKER」放 RM 50', check: (inst) => inst.bets.get('banker') >= 50 || `目前莊上有 ${fmt(inst.bets.get('banker'))}` } },
          { id: 'flow-no-more-bets', section: 'flow', title: `停止下注 <i class="en">No more bets</i>`,
            body: '<p>荷官說 <b>No more bets</b> 之後，手放桌下——加、減、移動籌碼都不行，一直到派彩完成。</p>',
            highlight: ['.lg-dealer-banner', '.bac-main'],
            setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          { id: 'flow-order', section: 'flow', title: '發牌順序',
            body: '<p>荷官依 <b>閒 → 莊 → 閒 → 莊</b> 各發兩張（圖上 1–4）。點數：A = 1、2–9 照面值、10/J/Q/K = 0，加總只看個位數。</p>',
            highlight: ['.bac-cards'],
            setup: (inst) => inst.demo.showOrder() },
          { id: 'flow-natural', section: 'flow', title: `天牌 <i class="en">Natural</i>`,
            body: '<p>任一方前兩張是 <b>8 或 9 點</b> 叫天牌，雙方都不再補牌，直接比大小。例：閒 7+A = 8，天牌。</p>',
            highlight: ['.bac-cards'],
            setup: (inst) => inst.demo.showCoup('7S AH', 'KD 6C') },
          { id: 'flow-player-third', section: 'flow', title: '閒補第三張',
            body: '<p>沒有天牌時先看閒：<b>0–5 補</b>一張、<b>6–7 停</b>。例：閒 2+3 = 5 → 補牌。</p>',
            highlight: ['.bac-hand[data-side="player"]'],
            setup: (inst) => inst.demo.showCoup('2S 3D', 'KC 7H', '4H') },
          { id: 'flow-banker-third', section: 'flow', title: '莊補第三張（規則表）',
            get body() { return `${html(thirdCardTable())}<p>荷官照表做，你不用記；看懂為什麼補牌就好。</p>`; },
            highlight: ['.bac-hand[data-side="banker"]'],
            setup: (inst) => inst.demo.showCoup('2S 3D', 'KC 5H', '4H 9D') },
          { id: 'flow-deal', section: 'flow', title: `發牌 <i class="en">Deal</i>`,
            body: isSqueeze ? '<p>練習時按「發牌」；咪牌桌的牌會蓋著，拖曳每張牌掀開後荷官才唱牌。</p>'
              : '<p>練習時按「發牌」開始；真實模式是倒數結束自動發牌。荷官會唱牌：「閒 X 點、莊 Y 點」。</p>',
            highlight: ['[data-action="deal"]', '.bac-cards'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '按「發牌 Deal」玩一局', check: (inst) => inst.state.rounds > 0 || '先放籌碼，再按發牌' } },
          { id: 'flow-squeeze', section: 'flow', title: `咪牌 <i class="en">Squeeze</i> 禮儀`,
            body: '<p>咪牌桌：荷官說 <b>請開牌 <i class="en">Card please</i></b>，押最多的人慢慢掀。只能掀自己押的那一邊；<b>不可撕牌、折壞</b>。</p>',
            highlight: ['.bac-hand[data-side="player"]'],
            setup: (inst) => inst.demo.squeezeCard(),
            action: { label: '拖曳閒位那張蓋牌，把它掀開', check: (inst) => inst.state.demoSqueezed || '由上往下拖曳那張牌' } },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼賠',
            body: '<p>賠率 1:1 = 押 1 賠 1。贏了拿回<b>本金 + 彩金</b>；以下每題都寫「淨贏」和「拿回（含本金）」。</p>',
            highlight: ['.lg-spot__odds'] },
          { id: 'payout-commission', section: 'payout', title: `莊 5% 佣 <i class="en">Commission</i>`,
            body: `<p>傳統桌押莊 RM 100 贏：<b>RM 100 × 0.95 = RM 95</b>（淨贏）。</p>${quizHtml('commission')}`,
            highlight: ['[data-bet="banker"]'],
            action: { label: '選出拿回的金額', check: quizCheck('commission') } },
          { id: 'payout-super6', section: 'payout', title: `Super 6 半賠 <i class="en">Pays 1/2</i>`,
            body: `<p>免佣桌莊贏 1:1 不抽佣，但莊以 6 點贏只賠 0.5 倍。</p>${quizHtml('super6')}`,
            highlight: ['[data-bet="banker"]'],
            setup: (inst) => inst.demo.showCoup('3S AD', 'KC 6H', 'KD'),
            action: { label: '選出拿回的金額', check: quizCheck('super6') } },
          { id: 'payout-tie', section: 'payout', title: `和局退注 <i class="en">Push</i>`,
            body: `<p>和局時莊、閒主注<b>退回</b>（不輸不贏），和注贏 8 倍。</p>${quizHtml('tie')}`,
            highlight: ['[data-bet="tie"]', '[data-bet="player"]'],
            setup: (inst) => inst.demo.showCoup('3S 4D', 'KC 7H'),
            action: { label: '選出淨輸贏', check: quizCheck('tie') } },
          { id: 'payout-pair', section: 'payout', title: '對子怎麼判定',
            body: '<p>只看<b>前兩張</b>、要<b>同點數字母</b>：K♠K♥ 是對子；10 和 K 雖然都算 0 點，但不是對子。莊對 RM 10 中：RM 10 × 11 = RM 110，拿回 RM 120。</p>',
            highlight: ['[data-bet="bankerPair"]', '.bac-hand[data-side="banker"]'],
            setup: (inst) => inst.demo.showCoup('TS 9D', 'KS KH') },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: `莊家優勢 <i class="en">House edge</i>`,
            get body() { return `${html(edgeTable())}<p>優勢 1.06% = 長期每押 RM 100 平均輸 RM 1.06。</p>`; },
            highlight: null },
          { id: 'strategy-bet', section: 'strategy', title: '該押：莊',
            body: nc ? '<p>傳統桌<b>莊最划算</b>（1.06%）。這張免佣桌莊 6 點只賠一半，莊變 1.46%，<b>閒 1.24% 反而略好</b>——兩者都可以。</p>'
              : '<p><b>莊最划算</b>：優勢 1.06%，比閒的 1.24% 低。莊贏的機率比較高，所以要抽 5% 佣，抽完還是最好。</p>',
            highlight: ['[data-bet="banker"]'] },
          { id: 'strategy-avoid', section: 'strategy', title: '別押：和、對子、老虎旁注',
            body: '<p>和 14.36%、對子 10.36%、Super 6 29.98%、老虎旁注約 5–10%。<b>和與對子是給賭場賺的</b>，賠率高只是因為很難中。</p>',
            highlight: ['[data-bet="tie"]', '.bac-pairs'] },
          { id: 'strategy-road', section: 'strategy', title: '路單不能預測',
            body: '<p>每局牌都是新的，「長莊」「跳閒」都只是過去的紀錄。<b>路單只是紀錄，不能預測</b>下一局。</p>',
            highlight: ['.bac-road'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 <b>RM 500</b>，輸完就走。不追輸、不借錢；贏了也可以先停。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      // ---------------------------------------------------------- instance
      return {
        bets,
        state,
        tray: () => tray,
        demo,
        tutorialSteps,
        mount(el0) {
          root = el0;
          buildTable();
          paintRoad();
          paintHints();
          ctx.on('hints:change', paintHints);
          document.addEventListener('click', onQuiz);
          if (ctx.isPractice) {
            const wrap = el('div', [edgeTable(), thirdCardTable()]);
            ctx.strategyPanel(wrap);
          }
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          document.removeEventListener('click', onQuiz);
          state.squeezers.forEach((h) => h.destroy());
          state.squeezers.clear();
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
      };
    },
  });
})();
