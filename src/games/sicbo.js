// ============================================================================
// 骰寶 Sic Bo（id: sicbo）— 規格：docs/05-game-rules/sicbo.md
// 三顆骰子在骰盅搖出；澳門/雲頂標準賠率表。
//   logic.settle(entries, dice) 可在 Node 測試；logic.multOf(spot, dice) 回傳淨賠倍數（輸 = −1）。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el } = ui;
  const { fmt, round2 } = money;

  // ---------------------------------------------------------------- 規則常數
  const TOTAL_PAY = { 4: 60, 5: 30, 6: 18, 7: 12, 8: 8, 9: 6, 10: 6, 11: 6, 12: 6, 13: 8, 14: 12, 15: 18, 16: 30, 17: 60 };
  const PAY = { small: 1, big: 1, odd: 1, even: 1, double: 10, triple: 180, anyTriple: 30, combo: 5 };
  /** 規格 §2 的莊家優勢（%）— 單元測試以 216 種骰面枚舉驗證 */
  const SPEC_EDGE = {
    small: 2.78, big: 2.78, odd: 2.78, even: 2.78, single: 7.87, double: 18.52, triple: 16.20, anyTriple: 13.89, combo: 16.67,
    total: { 4: 15.28, 5: 13.89, 6: 12.04, 7: 9.72, 8: 12.50, 9: 18.98, 10: 12.50, 11: 12.50, 12: 18.98, 13: 12.50, 14: 9.72, 15: 12.04, 16: 13.89, 17: 15.28 },
  };
  /** 真實模式限注（規格 §7）：大小/單雙 25–3,000；其他 10 起，上限依賠率 */
  const REAL_LIMIT = {
    small: [25, 3000], big: [25, 3000], odd: [25, 3000], even: [25, 3000],
    single: [10, 1000], total: [10, 500], combo: [10, 500], double: [10, 300], triple: [10, 100], anyTriple: [10, 100],
  };
  const EN_NUM = ['Zero', 'One', 'Two', 'Three', 'Four', 'Five', 'Six', 'Seven', 'Eight', 'Nine', 'Ten', 'Eleven', 'Twelve',
    'Thirteen', 'Fourteen', 'Fifteen', 'Sixteen', 'Seventeen', 'Eighteen'];
  const SHAKE_MS = 1500;

  // ---------------------------------------------------------------- 文案
  const T = {
    small: { zh: '小', en: 'Small', odds: '1:1', rule: '4–10 · 圍骰輸' },
    big: { zh: '大', en: 'Big', odds: '1:1', rule: '11–17 · 圍骰輸' },
    odd: { zh: '單', en: 'Odd', odds: '1:1', rule: '總點單 · 圍骰輸' },
    even: { zh: '雙', en: 'Even', odds: '1:1', rule: '總點雙 · 圍骰輸' },
    single: { zh: '單點', en: 'Single', odds: '1:1 · 2:1 · 3:1' },
    double: { zh: '雙骰', en: 'Double', odds: '10:1' },
    triple: { zh: '圍骰', en: 'Triple', odds: '180:1' },
    anyTriple: { zh: '全圍', en: 'Any Triple', odds: '30:1' },
    total: { zh: '總點', en: 'Total' },
    combo: { zh: '組合', en: 'Combo', odds: '5:1' },
    shake: { zh: '搖盅', en: 'Shake' },
    history: '最近 10 局（這只是紀錄，不能預測）',
  };

  // ---------------------------------------------------------------- 下注格定義
  const COMBOS = [];
  for (let a = 1; a <= 5; a++) for (let b = a + 1; b <= 6; b++) COMBOS.push([a, b]);
  const N6 = [1, 2, 3, 4, 5, 6];
  const SPOT_IDS = [
    'small', 'big', 'odd', 'even',
    ...N6.map((n) => `single-${n}`), ...N6.map((n) => `double-${n}`), ...N6.map((n) => `triple-${n}`), 'anyTriple',
    ...Object.keys(TOTAL_PAY).map((t) => `total-${t}`), ...COMBOS.map(([a, b]) => `combo-${a}-${b}`),
  ];
  const kindOf = (id) => id.split('-')[0];

  function labelOf(id) {
    const [k, x, y] = id.split('-');
    if (k === 'single') return `單點 ${x}`;
    if (k === 'double') return `雙骰 ${x}`;
    if (k === 'triple') return `圍骰 ${x}`;
    if (k === 'total') return `總點 ${x}`;
    if (k === 'combo') return `組合 ${x}-${y}`;
    return `${T[k].zh} ${T[k].en}`;
  }
  function oddsOf(id) {
    const [k, x] = id.split('-');
    if (k === 'total') return `${TOTAL_PAY[x]}:1`;
    return T[k].odds;
  }
  function specEdge(id) {
    const [k, x] = id.split('-');
    return k === 'total' ? SPEC_EDGE.total[x] : SPEC_EDGE[k];
  }

  // ---------------------------------------------------------------- 純邏輯
  function analyze(dice) {
    const counts = [0, 0, 0, 0, 0, 0, 0];
    dice.forEach((d) => { counts[d] += 1; });
    const sum = dice[0] + dice[1] + dice[2];
    const tripleOf = counts.findIndex((c) => c === 3);
    return { dice: [...dice], counts, sum, triple: tripleOf > 0, tripleOf: tripleOf > 0 ? tripleOf : 0 };
  }

  /** 淨賠倍數：贏 → 倍數（單點 1/2/3）；輸 → −1 */
  function multOf(id, dice) {
    const a = Array.isArray(dice) ? analyze(dice) : dice;
    const [k, xs, ys] = id.split('-');
    const x = Number(xs), y = Number(ys);
    switch (k) {
      case 'small': return !a.triple && a.sum >= 4 && a.sum <= 10 ? PAY.small : -1;
      case 'big': return !a.triple && a.sum >= 11 && a.sum <= 17 ? PAY.big : -1;
      case 'odd': return !a.triple && a.sum % 2 === 1 ? PAY.odd : -1;
      case 'even': return !a.triple && a.sum % 2 === 0 ? PAY.even : -1;
      case 'single': return a.counts[x] > 0 ? a.counts[x] : -1;
      case 'double': return a.counts[x] >= 2 ? PAY.double : -1;
      case 'triple': return a.counts[x] === 3 ? PAY.triple : -1;
      case 'anyTriple': return a.triple ? PAY.anyTriple : -1;
      case 'total': return a.sum === x ? TOTAL_PAY[x] : -1;
      case 'combo': return a.counts[x] > 0 && a.counts[y] > 0 ? PAY.combo : -1;
      default: throw new Error('UNKNOWN_SPOT:' + id);
    }
  }

  /** 所有 216 種骰面（有序） */
  function allRolls() {
    const out = [];
    for (let a = 1; a <= 6; a++) for (let b = 1; b <= 6; b++) for (let c = 1; c <= 6; c++) out.push([a, b, c]);
    return out;
  }
  /** 每注精確 {prob, ev, edge%}（216 種骰面枚舉） */
  function exactStats(id) {
    let win = 0, ev = 0;
    const rolls = allRolls();
    rolls.forEach((d) => { const m = multOf(id, d); if (m > 0) win += 1; ev += m; });
    return { prob: win / rolls.length, ev: ev / rolls.length, edge: (-ev / rolls.length) * 100 };
  }
  const STATS = Object.fromEntries(SPOT_IDS.map((id) => [id, exactStats(id)]));

  /** 這組骰面會贏的所有格（燈亮）→ Map(spot → 倍數) */
  function winningSpots(dice) {
    const a = analyze(dice);
    const m = new Map();
    SPOT_IDS.forEach((id) => { const x = multOf(id, a); if (x > 0) m.set(id, x); });
    return m;
  }

  function whyOf(id, a, mult) {
    const [k, xs, ys] = id.split('-');
    const x = Number(xs);
    const tri = a.triple ? `開出圍骰（三顆 ${a.tripleOf}）→ 大小單雙全輸` : '';
    switch (k) {
      case 'small': case 'big': {
        if (a.triple) return tri;
        const range = k === 'small' ? '4–10' : '11–17';
        return mult > 0 ? `總點 ${a.sum} 在 ${range}` : `總點 ${a.sum} 不在 ${range}`;
      }
      case 'odd': case 'even':
        if (a.triple) return tri;
        return `總點 ${a.sum} 是${a.sum % 2 ? '單' : '雙'}數`;
      case 'single': return mult > 0 ? `${x} 出現 ${a.counts[x]} 顆 → 賠 ${mult} 倍` : `沒有開出 ${x}`;
      case 'double': return mult > 0 ? `${x} 出現 ${a.counts[x]} 顆（至少兩顆）` : `${x} 只出現 ${a.counts[x]} 顆，要至少兩顆`;
      case 'triple': return mult > 0 ? `三顆都是 ${x}` : `不是三顆 ${x}`;
      case 'anyTriple': return mult > 0 ? `三顆同點（${a.tripleOf}）` : '三顆不同點';
      case 'total': return mult > 0 ? `總點正好 ${x}` : `總點是 ${a.sum}，不是 ${x}`;
      case 'combo': {
        const y = Number(ys);
        if (mult > 0) return `${x} 和 ${y} 都有出現`;
        const miss = [x, y].filter((n) => !a.counts[n]);
        return `缺 ${miss.join('、')}`;
      }
      default: return '';
    }
  }

  /**
   * 結算。entries = [[spotId, stake]]
   * @returns {{dice, sum, triple, wagered, returned, net, lines:[{spot, label, stake, result, mult, pay, returned, formula, why}]}}
   */
  function settle(entries, dice) {
    const a = analyze(dice);
    let wagered = 0, returned = 0;
    const lines = entries.map(([spot, stake]) => {
      const mult = multOf(spot, a);
      const label = labelOf(spot);
      wagered += stake;
      const why = whyOf(spot, a, mult);
      if (mult > 0) {
        const pay = round2(stake * mult);
        const back = round2(stake + pay);
        returned += back;
        return { spot, label, stake, result: 'win', mult, pay, returned: back, why,
          formula: `${label} ${fmt(stake)} × ${mult} = +${fmt(pay)}（拿回 ${fmt(back)}）` };
      }
      return { spot, label, stake, result: 'lose', mult: -1, pay: -stake, returned: 0, why,
        formula: `${label} ${fmt(stake)} 輸 = −${fmt(stake)}` };
    });
    wagered = round2(wagered); returned = round2(returned);
    return { dice: a.dice, sum: a.sum, triple: a.triple, tripleOf: a.tripleOf, wagered, returned, net: round2(returned - wagered), lines };
  }

  /** 唱點：{zh:'3、5、6 總點 14 大', en:'Fourteen, Big'} */
  function callOf(dice) {
    const a = analyze(dice);
    const tag = a.triple ? { zh: `圍 ${a.tripleOf}`, en: `Triple ${EN_NUM[a.tripleOf]}` }
      : a.sum <= 10 ? { zh: '小', en: 'Small' } : { zh: '大', en: 'Big' };
    return { zh: `${a.dice.join('、')} 總點 ${a.sum} ${tag.zh}`, en: `${EN_NUM[a.sum]}, ${tag.en}` };
  }

  // ---------------------------------------------------------------- 骰子圖形（CSS 點陣）
  const PIPS = { 1: [4], 2: [0, 8], 3: [0, 4, 8], 4: [0, 2, 6, 8], 5: [0, 2, 4, 6, 8], 6: [0, 2, 3, 5, 6, 8] };
  function dieEl(v, size = '') {
    const d = el('span', { class: ['sb-die', size && `sb-die--${size}`], dataset: { v }, role: 'img', 'aria-label': `骰子 ${v} 點` });
    for (let i = 0; i < 9; i++) d.appendChild(el('i', { class: PIPS[v].includes(i) ? 'on' : null }));
    return d;
  }
  function diceHtml(dice) {
    return `<span class="sb-dicerow">${dice.map((v) => dieEl(v, 'sm').outerHTML).join('')}</span>`;
  }

  const pct = (p) => `${(p * 100).toFixed(p < 0.01 ? 2 : 1)}%`;
  const reduceMotion = () => { try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'sicbo',
    category: 'table',
    order: 4,
    name: { zh: '骰寶', en: 'Sic Bo' },
    summary: '三顆骰子押大小、點數與組合。只押大小最划算。',
    houseEdge: [
      { bet: { zh: '大 / 小', en: 'Big / Small' }, edge: 2.78, best: true },
      { bet: { zh: '單 / 雙', en: 'Odd / Even' }, edge: 2.78 },
      { bet: { zh: '單點', en: 'Single' }, edge: 7.87 },
      { bet: { zh: '總點 7 / 14', en: 'Total 7 / 14' }, edge: 9.72 },
      { bet: { zh: '總點 6 / 15', en: 'Total 6 / 15' }, edge: 12.04 },
      { bet: { zh: '總點 8 / 13、10 / 11', en: 'Total 8 / 13, 10 / 11' }, edge: 12.5 },
      { bet: { zh: '全圍', en: 'Any Triple' }, edge: 13.89 },
      { bet: { zh: '總點 5 / 16', en: 'Total 5 / 16' }, edge: 13.89 },
      { bet: { zh: '總點 4 / 17', en: 'Total 4 / 17' }, edge: 15.28 },
      { bet: { zh: '圍骰（指定）', en: 'Specific Triple' }, edge: 16.2 },
      { bet: { zh: '組合', en: 'Combination' }, edge: 16.67 },
      { bet: { zh: '雙骰', en: 'Double' }, edge: 18.52 },
      { bet: { zh: '總點 9 / 12', en: 'Total 9 / 12' }, edge: 18.98 },
    ],
    limits: { real: { min: 25, max: 3000 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 20,
    logic: { settle, multOf, analyze, allRolls, exactStats, winningSpots, callOf, labelOf, specEdge, SPOT_IDS, TOTAL_PAY, SPEC_EDGE, REAL_LIMIT, COMBOS },

    create(ctx) {
      const state = { phase: 'idle', dice: null, staked: 0, rounds: 0, rig: null, history: [], last: null };
      const spotRules = {};
      if (ctx.isReal) SPOT_IDS.forEach((id) => { const [mn, mx] = REAL_LIMIT[kindOf(id)]; spotRules[id] = { min: mn, max: mx }; });
      const bets = new LG.Bets({
        min: ctx.isReal ? 10 : ctx.limits.min,
        max: ctx.isReal ? Infinity : ctx.limits.max,
        perSpotMin: ctx.isReal ? 10 : ctx.limits.min,
        perSpotMax: ctx.limits.max,
        spotRules,
        labels: Object.fromEntries(SPOT_IDS.map((id) => [id, labelOf(id)])),
      });
      let root, tableEl, bowlEl, coverEl, diceEl, callEl, histEl, hintEl, tray, layer, bar;

      // ---- 桌面
      function spot(id, { zh, en, odds, icon, cls } = {}) {
        const k = kindOf(id);
        const st = STATS[id];
        return el('div', { class: ['lg-spot', 'sb-spot', `sb-spot--${k}`, cls], dataset: { bet: id }, title: `${labelOf(id)} ${oddsOf(id)}` }, [
          el('span.lg-spot__zh', [zh ?? T[k].zh, icon || null]),
          el('span.lg-spot__en', { text: en ?? T[k].en }),
          el('span.lg-spot__odds', { text: odds ?? oddsOf(id) }),
          el('span.sb-spot__hint', { html: `${pct(st.prob)}<br>−${st.edge.toFixed(2)}%`, title: '中獎機率 / 莊家優勢' }),
        ]);
      }
      const dieIcons = (arr) => el('span.sb-icons', arr.map((v) => dieEl(v, 'xs')));

      function buildTable() {
        bowlEl = el('div.sb-bowl.is-open', { 'aria-label': '骰盅 Shaker' }, [
          el('div.sb-plate', [diceEl = el('div.sb-dice')]),
          coverEl = el('div.sb-cover', [el('span', { html: '骰盅 <i class="en">Shaker</i>' })]),
        ]);
        callEl = el('div.sb-call', { 'aria-live': 'polite' });
        histEl = el('div.sb-history', { 'aria-label': T.history });
        const top = el('div.sb-top', [bowlEl, el('div.sb-top__side', [callEl, el('div.sb-history__k', { text: T.history }), histEl])]);

        const triples = el('div.sb-row.sb-triples', [
          ...[1, 2, 3].map((n) => spot(`triple-${n}`, { zh: '圍', icon: dieIcons([n, n, n]) })),
          spot('anyTriple', { zh: '全圍', en: 'Any Triple', icon: null, cls: 'sb-spot--wide' }),
          ...[4, 5, 6].map((n) => spot(`triple-${n}`, { zh: '圍', icon: dieIcons([n, n, n]) })),
        ]);
        const doubles = el('div.sb-row.sb-doubles', N6.map((n) => spot(`double-${n}`, { zh: '雙', icon: dieIcons([n, n]) })));
        const totals = el('div.sb-row.sb-totals', Object.keys(TOTAL_PAY).map((t) => spot(`total-${t}`, { zh: `${t} 點`, en: 'Total' })));
        const combos = el('div.sb-row.sb-combos', COMBOS.map(([a, b]) => spot(`combo-${a}-${b}`, { zh: '組', icon: dieIcons([a, b]) })));
        const singles = el('div.sb-row.sb-singles', N6.map((n) => spot(`single-${n}`, { zh: '單點', icon: dieIcons([n]), odds: '1:1 2:1 3:1' })));
        const section = (cls, label, row) => el(`div.sb-sec.${cls}`, [el('div.sb-sec__k', { html: label }), row]);

        const board = el('div.sb-board', [
          el('div.sb-side.sb-side--l', [
            spot('small', { cls: 'sb-spot--main', odds: '1:1' }),
            spot('odd', { cls: 'sb-spot--main' }),
          ]),
          el('div.sb-center', [
            section('sb-sec--triples', '圍骰 <i class="en">Triple</i> 180:1 · 全圍 <i class="en">Any Triple</i> 30:1', triples),
            section('sb-sec--doubles', '雙骰 <i class="en">Double</i> 10:1', doubles),
            section('sb-sec--totals', '總點 <i class="en">Total</i>', totals),
            section('sb-sec--combos', '組合 <i class="en">Combination</i> 5:1', combos),
            section('sb-sec--singles', '單點 <i class="en">Single</i> 一顆 1:1 · 兩顆 2:1 · 三顆 3:1', singles),
          ]),
          el('div.sb-side.sb-side--r', [
            spot('big', { cls: 'sb-spot--main' }),
            spot('even', { cls: 'sb-spot--main' }),
          ]),
        ]);
        // 大小加規則小字
        ['small', 'big', 'odd', 'even'].forEach((id) => {
          const s = board.querySelector ? board.querySelector(`[data-bet="${id}"]`) : null;
          if (s) s.insertBefore(el('span.sb-spot__rule', { text: T[id].rule }), s.querySelector('.sb-spot__hint'));
        });

        tableEl = el('div.lg-table.sb-table', [top, board]);
        const actions = el('div.lg-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        hintEl = el('div.lg-hint.sb-hint', { hidden: true });
        root.append(tableEl, hintEl, actions, chips, barEl);

        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 25 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId });
        bar = ui.betBar(barEl, { bets, layer });
        showDice([1, 2, 3], { quiet: true });
        paintHistory();
      }

      function showDice(dice, { quiet = false } = {}) {
        diceEl.replaceChildren(...dice.map((v) => dieEl(v)));
        bowlEl.classList.remove('is-covered', 'is-shaking');
        bowlEl.classList.add('is-open');
        bowlEl.classList.toggle('is-idle', quiet);
        if (quiet) { callEl.textContent = ''; return; }
        const c = callOf(dice);
        callEl.innerHTML = `<b>${c.zh}</b> <i class="en">${c.en}</i>`;
      }
      function cover() {
        bowlEl.classList.remove('is-open', 'is-idle');
        bowlEl.classList.add('is-covered');
      }
      function markSpots(dice) {
        const wins = dice ? winningSpots(dice) : new Map();
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          const id = s.dataset.bet;
          const w = wins.has(id);
          s.classList.toggle('is-win', w);
          s.classList.toggle('sb-lit', w);
          s.classList.toggle('is-lose', !!dice && !w && bets.get(id) > 0);
        });
      }
      function paintHistory() {
        histEl.replaceChildren(...state.history.map((d) => {
          const a = analyze(d);
          const tag = a.triple ? '圍' : a.sum <= 10 ? '小' : '大';
          return el('span', { class: ['sb-hist', `sb-hist--${a.triple ? 'triple' : a.sum <= 10 ? 'small' : 'big'}`], title: d.join('-') }, [
            el('b', { text: String(a.sum) }), el('small', { text: tag }),
          ]);
        }));
        if (!state.history.length) histEl.appendChild(el('span.sb-hist--empty', { text: '—' }));
      }

      // ---- 練習提示
      function paintHints() {
        root.classList.toggle('sb-show-hints', !!ctx.hints);
        hintEl.hidden = !ctx.hints;
        hintEl.innerHTML = '提示：每格下方小字 = <b>中獎機率 · 莊家優勢</b>。大小/單雙優勢最低（2.78%）；雙骰、總點 9/12 最差（約 19%）。';
      }
      function strategyTable() {
        const rows = [['注別', '賠率', '中獎率', '優勢']];
        const add = (zh, id) => rows.push([zh, oddsOf(id), pct(STATS[id].prob), `${STATS[id].edge.toFixed(2)}%`]);
        add('大 / 小', 'big'); add('單 / 雙', 'odd'); add('單點', 'single-1');
        [7, 6, 8, 10, 5, 4, 9].forEach((t) => add(`總點 ${t} / ${21 - t}`, `total-${t}`));
        add('全圍', 'anyTriple'); add('圍骰', 'triple-1'); add('組合', 'combo-1-2'); add('雙骰', 'double-1');
        return ui.table(rows, { caption: '只押大小/單雙最划算' });
      }

      // ---- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        // 上一局的亮燈保留到下一次搖盅（方便對照）；只清掉「輸」的標記
        tableEl.querySelectorAll('[data-bet].is-lose').forEach((s) => s.classList.remove('is-lose'));
        ctx.bettingWindow({ bets, onClose: onNoMoreBets, label: `${T.shake.zh} <i class="en">${T.shake.en}</i>` });
      }

      async function onNoMoreBets({ ok, validation }) {
        if (!ok) {
          bets.unlock();
          if (bets.total() > 0) ui.toast(validation.zh, { type: 'warn' });
          state.phase = 'idle';
          ctx.nextRound(startRound);
          return;
        }
        state.staked = bets.total();
        ctx.bank.debit(state.staked);
        state.phase = 'rolling';
        ctx.dealer.say('搖盅', 'Shaking the dice');
        const dice = state.rig || LG.dice.roll(3);
        state.rig = null;
        await shake();
        if (!ctx.alive()) return;
        showDice(dice);
        const c = callOf(dice);
        ctx.dealer.say(c.zh, c.en);
        await ctx.wait(250);
        if (!ctx.alive()) return;
        finishRound(dice);
      }

      function shake() {
        markSpots(null);
        cover();
        callEl.textContent = '';
        if (reduceMotion()) return ctx.wait(200);
        const ms = LG.ms(SHAKE_MS);
        bowlEl.style.setProperty('--sb-shake', ms + 'ms');
        bowlEl.classList.add('is-shaking');
        return ctx.wait(SHAKE_MS).then(() => { bowlEl.classList.remove('is-shaking'); });
      }

      function finishRound(dice) {
        state.dice = dice;
        const r = settle(bets.entries(), dice);
        state.last = r;
        ctx.bank.credit(r.returned);
        state.staked = 0;
        markSpots(dice);
        state.history.unshift([...dice]);
        state.history = state.history.slice(0, 10);
        paintHistory();

        ctx.recordRound({ wagered: r.wagered, net: r.net, outcome: r.net > 0 ? 'win' : r.net < 0 ? 'lose' : 'push' });
        const a = analyze(dice);
        const c = callOf(dice);
        const tags = a.triple ? `圍骰 ${a.tripleOf}（大小單雙全輸）` : `${a.sum <= 10 ? '小 SMALL' : '大 BIG'}、${a.sum % 2 ? '單 ODD' : '雙 EVEN'}`;
        ctx.explain({
          hand: `${diceHtml(dice)} 總點 <b>${a.sum}</b>`,
          result: `${tags} <i class="en">${c.en}</i>`,
          formula: r.lines.map((l) => l.formula).join('<br>') + `<br>淨 <b>${money.fmtSigned(r.net)}</b>`,
          why: '<ul class="sb-why">' + r.lines.map((l) => `<li><b>${l.label}</b>：${l.why}</li>`).join('') + '</ul>'
            + '<p class="lg-muted">亮燈的格 = 這局會贏的所有注。</p>',
        });

        state.rounds += 1;
        state.phase = 'settled';
        bets.unlock();
        bets.clear();
        ctx.checkBroke();
        ctx.nextRound(startRound);
      }

      // ---- 教學用
      const demo = {
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        ensureBetting() { if (state.phase === 'idle' || state.phase === 'settled') startRound(); },
        showDice(d) { showDice(d); markSpots(d); },
        clearLights() { markSpots(null); },
        cover() { cover(); markSpots(null); callEl.textContent = ''; },
        rig(d) { state.rig = [...d]; },
      };

      function tutorialSteps() {
        const edgeRows = ['big', 'odd', 'single-1', 'total-7', 'total-9', 'combo-1-2', 'anyTriple', 'triple-1', 'double-1']
          .map((id) => `<tr><td>${id === 'big' ? '大 / 小' : id === 'odd' ? '單 / 雙' : id === 'total-7' ? '總點 7/14' : id === 'total-9' ? '總點 9/12' : labelOf(id).replace(/ \d.*$/, '')}</td><td>${oddsOf(id)}</td><td>${STATS[id].edge.toFixed(2)}%</td></tr>`).join('');
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：骰寶桌面',
            body: '<p>上方是<b>骰盅 <i class="en">Shaker</i></b>，下方是下注檯面。先認識每一區，再動手。</p>',
            highlight: ['.sb-bowl', '.sb-board'] },
          { id: 'layout-bigsmall', section: 'layout', title: '大 <i class="en">Big</i> / 小 <i class="en">Small</i>',
            body: '<p>三顆總點 4–10 是小、11–17 是大，賠 <b>1:1</b>。開出<b>圍骰</b>（三顆同點）時大小都輸。</p>',
            highlight: ['[data-bet="small"]', '[data-bet="big"]'] },
          { id: 'layout-oddeven', section: 'layout', title: '單 <i class="en">Odd</i> / 雙 <i class="en">Even</i>',
            body: '<p>押總點是單數或雙數，賠 <b>1:1</b>，一樣遇圍骰輸。</p>',
            highlight: ['[data-bet="odd"]', '[data-bet="even"]'] },
          { id: 'layout-single', section: 'layout', title: '單點 <i class="en">Single</i>',
            body: '<p>押一個號碼：出現一顆賠 1:1、兩顆 2:1、三顆 3:1。</p>',
            highlight: ['.sb-singles'] },
          { id: 'layout-double-triple', section: 'layout', title: '雙骰 <i class="en">Double</i> / 圍骰 <i class="en">Triple</i>',
            body: '<p>雙骰：指定號至少兩顆，賠 10:1。圍骰：三顆都是指定號，賠 180:1；<b>全圍 <i class="en">Any Triple</i></b> 任何三同，賠 30:1。</p>',
            highlight: ['.sb-doubles', '.sb-triples'] },
          { id: 'layout-total', section: 'layout', title: '總點 <i class="en">Total</i>',
            body: '<p>押三顆加起來的點數 4–17。越難出的點數賠越高：4 和 17 賠 60:1。</p>',
            highlight: ['.sb-totals'] },
          { id: 'layout-combo', section: 'layout', title: '組合 <i class="en">Combination</i>',
            body: '<p>押兩個不同號碼都出現（例如 1 和 2），共 15 格，賠 <b>5:1</b>。</p>',
            highlight: ['.sb-combos'] },
          { id: 'layout-chips', section: 'layout', title: '籌碼 <i class="en">Chips</i>',
            body: '<p>10 藍、25 綠、50 橙、100 黑、500 紫、1000 黃。現場顏色可能不同，看面額。</p>',
            highlight: ['.lg-chips'],
            action: { label: '點選 RM 50 籌碼', check: (inst) => inst.tray().selected() === 50 || '點一下「50」那枚籌碼' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一局怎麼進行',
            body: '<p><b>請下注 <i class="en">Place your bets</i></b> → 停止下注 → 搖盅 → 開盅唱點 → 派彩。</p>',
            highlight: ['.lg-dealer-banner'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-place', section: 'flow', title: '搖盅前下注',
            body: '<p>骰盅蓋著、荷官喊請下注時才能放籌碼。點格子放一枚，長按或右鍵拿回。</p>',
            highlight: ['[data-bet="big"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「大 BIG」放至少 RM 50', check: (inst) => inst.bets.get('big') >= 50 || `目前「大」上有 ${fmt(inst.bets.get('big'))}` } },
          { id: 'flow-shake', section: 'flow', title: '搖盅 <i class="en">Shake</i>',
            body: '<p>練習時按「搖盅」開始；真實模式倒數 20 秒結束自動搖。骰盅會搖約 1.5 秒再開。</p>',
            highlight: ['[data-action="deal"]', '.sb-bowl'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.rig([3, 5, 6]); },
            action: { label: '按「搖盅 Shake」玩一局', check: (inst) => inst.state.rounds > 0 || '先在「大」放籌碼，再按搖盅' } },
          { id: 'flow-no-touch', section: 'flow', title: '開盅後不可碰 <i class="en">No more bets</i>',
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下——直到派彩完成，加、減、移動籌碼都不行。</p>',
            highlight: ['.lg-dealer-banner', '.sb-board'],
            setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          { id: 'flow-lit', section: 'flow', title: '燈亮的格是中獎格',
            body: '<p>開盅唱點：「3、5、6 總點 14 大」。檯面上亮燈的格就是這局贏的注。</p>',
            highlight: ['.sb-lit', '.sb-call'],
            setup: (inst) => inst.demo.showDice([3, 5, 6]) },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼算錢',
            body: '<p>贏了拿回<b>本金 + 彩金</b>。以下都用押 RM 100 舉例。</p>',
            highlight: ['.lg-spot__odds'], setup: (inst) => inst.demo.clearLights() },
          { id: 'payout-single2', section: 'payout', title: '單點出兩顆 = 2:1',
            body: '<p>押單點 4 RM 100，開 4、4、2：<br><b>RM 100 × 2 = RM 200</b>（淨贏）<br>拿回 RM 300（含本金）。</p>',
            highlight: ['[data-bet="single-4"]'], setup: (inst) => inst.demo.showDice([4, 4, 2]) },
          { id: 'payout-triple-lose', section: 'payout', title: '大小遇圍骰輸',
            body: '<p>開 5、5、5：總點 15 本來是大，但這是<b>圍骰</b>，大小單雙全輸。押大 RM 100 → −RM 100。</p>',
            highlight: ['[data-bet="big"]', '[data-bet="triple-5"]'], setup: (inst) => inst.demo.showDice([5, 5, 5]) },
          { id: 'payout-combo', section: 'payout', title: '組合 5:1',
            body: '<p>押組合 1-2 RM 100，開 1、2、6：<br><b>RM 100 × 5 = RM 500</b>（淨贏）<br>拿回 RM 600。</p>',
            highlight: ['[data-bet="combo-1-2"]'], setup: (inst) => inst.demo.showDice([1, 2, 6]) },
          { id: 'payout-try', section: 'payout', title: '自己押一個單點',
            body: '<p>單點至少出現一顆就贏，出越多顆賠越多。</p>',
            highlight: ['.sb-singles'],
            setup: (inst) => { inst.demo.clearLights(); inst.demo.ensureBetting(); },
            action: { label: '在任一個「單點」格放籌碼', check: (inst) => N6.some((n) => inst.bets.get(`single-${n}`) > 0) || '點下方任一顆骰子的單點格' } },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: `<table class="lg-datatable"><tr><th>注</th><th>賠率</th><th>優勢</th></tr>${edgeRows}</table>`,
            highlight: null },
          { id: 'strategy-do', section: 'strategy', title: '該押：大小 / 單雙',
            body: '<p>優勢只有 <b>2.78%</b>：長期每押 RM 100 平均輸 RM 2.78。這是骰寶最划算的注。</p>',
            highlight: ['[data-bet="small"]', '[data-bet="big"]', '[data-bet="odd"]', '[data-bet="even"]'] },
          { id: 'strategy-dont', section: 'strategy', title: '別押：雙骰 / 圍骰',
            body: '<p>雙骰優勢 18.52%、圍骰 16.20%——比大小貴 6 倍以上。賠率高不代表划算。</p>',
            highlight: ['.sb-doubles', '.sb-triples'] },
          { id: 'strategy-total', section: 'strategy', title: '總點看起來很香？',
            body: '<p>60:1、30:1 看起來很高，但總點優勢 9.72%–18.98%，全部比大小差。</p>',
            highlight: ['.sb-totals'] },
          { id: 'strategy-history', section: 'strategy', title: '路單只是紀錄',
            body: '<p>「最近 10 局」連開幾次大，下一局開小的機率一樣。<b>這只是紀錄，不能預測。</b></p>',
            highlight: ['.sb-history'] },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。每注固定金額，不要輸了加碼追。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      return {
        bets,
        state,
        tray: () => tray,
        demo,
        mount(el0) {
          root = el0;
          root.classList.add('sb-root');
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) ctx.strategyPanel(strategyTable());
          root.dataset.ready = '1';
          startRound();
        },
        unmount() {
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (layer) layer.destroy();
          if (bar) bar.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
