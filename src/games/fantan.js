// ============================================================================
// 番攤 Fan Tan（id: fantan）— 規格：docs/05-game-rules/fantan.md
// 碗蓋住一把鈕扣（60–200 顆），荷官每次撥走 4 顆，最後剩 1/2/3/4 顆 = 開出號碼。
// 贏注抽 5% 佣（派彩 × 0.95）。方桌四邊：下 1、左 2、上 3、右 4。
//   番 fan-n 3:1；念 nim-主-副 2:1（副號開出 push）；角 kwok-a-b 1:1；三門 ngatan-缺號 1:3；單雙 odd/even 1:1。
//   三門賠率與規格 §2「1:2」不同 → 見 docs/change-requests/fantan.md CR-1。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el } = ui;
  const { fmt, round2 } = money;

  // ---------------------------------------------------------------- 規則常數
  const COMMISSION = 0.05;
  const KEEP = 1 - COMMISSION;                     // 0.95
  const BUTTONS = { min: 60, max: 200, per: 4 };
  /** 每種注的「扣佣前」賠率（淨贏倍數） */
  const ODDS = { fan: 3, nim: 2, kwok: 1, ngatan: 1 / 3, odd: 1, even: 1 };
  const ODDS_TEXT = { fan: '3:1', nim: '2:1', kwok: '1:1', ngatan: '1:3', odd: '1:1', even: '1:1' };
  /** 規格優勢（%）；三門依 CR-1 為 1.25% */
  const SPEC_EDGE = { fan: 3.75, nim: 2.5, kwok: 2.5, ngatan: 1.25, odd: 2.5, even: 2.5 };
  const N4 = [1, 2, 3, 4];
  const ZH_NUM = ['', '一', '二', '三', '四'];
  const EN_NUM = ['', 'One', 'Two', 'Three', 'Four'];
  const STEP_MS = 140;         // 每撥一次的動畫時間
  const FAST = 5;              // 加速倍數

  const T = {
    fan: { zh: '番', en: 'Fan' },
    nim: { zh: '念', en: 'Nim' },
    kwok: { zh: '角', en: 'Kwok' },
    ngatan: { zh: '三門', en: 'Nga Tan' },
    odd: { zh: '單', en: 'Odd' },
    even: { zh: '雙', en: 'Even' },
    fast: '加速 <i class="en">Fast</i> ⏩',
    fastOn: '加速中 <i class="en">Fast</i> ⏩',
    history: '最近 10 局（這只是紀錄，不能預測）',
  };

  // ---------------------------------------------------------------- 下注格
  const NIMS = [];
  N4.forEach((a) => N4.forEach((b) => { if (a !== b) NIMS.push([a, b]); }));
  const KWOKS = [[1, 2], [1, 3], [1, 4], [2, 3], [2, 4], [3, 4]];
  const SPOT_IDS = [
    ...N4.map((n) => `fan-${n}`), ...NIMS.map(([a, b]) => `nim-${a}-${b}`), ...KWOKS.map(([a, b]) => `kwok-${a}-${b}`),
    ...N4.map((n) => `ngatan-${n}`), 'odd', 'even',
  ];
  const kindOf = (id) => id.split('-')[0];
  const others = (x) => N4.filter((n) => n !== x);

  function labelOf(id) {
    const [k, a, b] = id.split('-');
    if (k === 'fan') return `番 ${a}`;
    if (k === 'nim') return `${a}念${b}`;
    if (k === 'kwok') return `角 ${a}-${b}`;
    if (k === 'ngatan') return `三門 ${others(Number(a)).join('·')}`;
    return k === 'odd' ? '單 1·3' : '雙 2·4';
  }

  // ---------------------------------------------------------------- 純邏輯
  /** 鈕扣數 → 開出號碼：N mod 4（0 → 4） */
  const resultFromCount = (n) => (n % 4) || 4;

  /** 某注在結果 r 下：{res:'win'|'push'|'lose', odds} */
  function outcome(id, r) {
    const [k, as, bs] = id.split('-');
    const a = Number(as), b = Number(bs);
    const W = { res: 'win', odds: ODDS[k] }, L = { res: 'lose', odds: 0 };
    switch (k) {
      case 'fan': return r === a ? W : L;
      case 'nim': return r === a ? W : r === b ? { res: 'push', odds: 0 } : L;
      case 'kwok': return r === a || r === b ? W : L;
      case 'ngatan': return r !== a ? W : L;
      case 'odd': return r % 2 === 1 ? W : L;
      case 'even': return r % 2 === 0 ? W : L;
      default: throw new Error('UNKNOWN_SPOT:' + id);
    }
  }

  /** 每 1 單位的淨輸贏（已扣佣） */
  function netPerUnit(id, r) {
    const o = outcome(id, r);
    return o.res === 'win' ? o.odds * KEEP : o.res === 'push' ? 0 : -1;
  }
  /** 4 種結果枚舉 → {ev, edge%, pWin, pPush} */
  function exactStats(id) {
    let ev = 0, w = 0, p = 0;
    N4.forEach((r) => { ev += netPerUnit(id, r); const o = outcome(id, r).res; if (o === 'win') w++; if (o === 'push') p++; });
    return { ev: ev / 4, edge: (-ev / 4) * 100, pWin: w / 4, pPush: p / 4 };
  }
  const STATS = Object.fromEntries(SPOT_IDS.map((id) => [id, exactStats(id)]));

  function whyOf(id, r, o) {
    const [k, as, bs] = id.split('-');
    switch (k) {
      case 'fan': return o.res === 'win' ? `押 ${as}，開 ${r}` : `押 ${as}，開的是 ${r}`;
      case 'nim': return o.res === 'win' ? `主號 ${as} 開出 → 贏` : o.res === 'push' ? `副號 ${bs} 開出 → 和，退回本金` : `開 ${r}，不是主號 ${as} 也不是副號 ${bs}`;
      case 'kwok': return o.res === 'win' ? `${r} 在 ${as}、${bs} 之中` : `開 ${r}，不在 ${as}、${bs}`;
      case 'ngatan': return o.res === 'win' ? `${r} 在 ${others(Number(as)).join('、')} 之中` : `開出唯一沒押的 ${as}`;
      default: return `${r} 是${r % 2 ? '單' : '雙'}數`;
    }
  }

  const oddsFormula = (k) => (k === 'ngatan' ? '1/3' : String(ODDS[k]));

  /**
   * 結算。entries = [[spotId, stake]]，r = 開出號碼 1–4
   * @returns {{result, wagered, returned, commission, net, lines:[{spot,label,stake,result,pay,returned,commission,formula,why}]}}
   */
  function settle(entries, r) {
    let wagered = 0, returned = 0, commission = 0;
    const lines = entries.map(([spot, stake]) => {
      const k = kindOf(spot);
      const o = outcome(spot, r);
      const label = labelOf(spot);
      const why = whyOf(spot, r, o);
      wagered += stake;
      if (o.res === 'win') {
        const gross = stake * o.odds;
        const pay = round2(gross * KEEP);
        const com = round2(gross - pay);
        const back = round2(stake + pay);
        returned += back; commission += com;
        return { spot, label, stake, result: 'win', pay, returned: back, commission: com, why,
          formula: `${label} ${fmt(stake)} × ${oddsFormula(k)} × 0.95 = +${fmt(pay)}（拿回 ${fmt(back)}）` };
      }
      if (o.res === 'push') {
        returned += stake;
        return { spot, label, stake, result: 'push', pay: 0, returned: stake, commission: 0, why,
          formula: `${label} ${fmt(stake)} 和 <i class="en">push</i> = RM 0（拿回 ${fmt(stake)}）` };
      }
      return { spot, label, stake, result: 'lose', pay: -stake, returned: 0, commission: 0, why,
        formula: `${label} ${fmt(stake)} 輸 = −${fmt(stake)}` };
    });
    wagered = round2(wagered); returned = round2(returned);
    return { result: r, wagered, returned, commission: round2(commission), net: round2(returned - wagered), lines };
  }

  /** 這個結果下：贏的格與 push 的格 */
  function spotStates(r) {
    const m = new Map();
    SPOT_IDS.forEach((id) => { const o = outcome(id, r).res; if (o !== 'lose') m.set(id, o); });
    return m;
  }

  /** 撥扣模擬：總數 n → 每撥 4 顆的剩餘序列，最後剩 1–4 */
  function strokes(n) {
    const seq = [n];
    let left = n;
    while (left > BUTTONS.per) { left -= BUTTONS.per; seq.push(left); }
    return seq;
  }

  const pct = (p) => `${Math.round(p * 100)}%`;
  const reduceMotion = () => { try { return !!(globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches); } catch { return false; } };

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'fantan',
    category: 'table',
    order: 6,
    name: { zh: '番攤', en: 'Fan Tan' },
    summary: '碗裡的鈕扣每次撥 4 顆，猜最後剩幾顆（1–4）。贏注抽 5% 佣。',
    houseEdge: [
      { bet: { zh: '念 / 角（5% 佣）', en: 'Nim / Kwok' }, edge: 2.5, best: true },
      { bet: { zh: '單 / 雙', en: 'Odd / Even' }, edge: 2.5 },
      { bet: { zh: '三門（1:3）', en: 'Nga Tan' }, edge: 1.25 },
      { bet: { zh: '番', en: 'Fan' }, edge: 3.75 },
    ],
    limits: { real: { min: 50, max: 3000 }, practice: { min: 10, max: 100000 } },
    denoms: [10, 25, 50, 100, 500, 1000],
    countdown: 20,
    logic: { settle, outcome, netPerUnit, exactStats, resultFromCount, strokes, spotStates, labelOf, SPOT_IDS, SPEC_EDGE, ODDS, COMMISSION, BUTTONS },

    create(ctx) {
      const state = { phase: 'idle', staked: 0, rounds: 0, rig: null, fast: false, count: null, result: null, history: [], last: null };
      const bets = new LG.Bets({
        min: ctx.limits.min,
        max: ctx.isReal ? Infinity : ctx.limits.max,
        perSpotMin: ctx.limits.min,
        perSpotMax: ctx.limits.max,
        labels: Object.fromEntries(SPOT_IDS.map((id) => [id, labelOf(id)])),
      });
      let root, tableEl, centerEl, pileEl, countEl, resultEl, histEl, fastB, hintEl, tray, layer, bar;

      // ---- 桌面
      function spot(id, { zh, en, odds, cls } = {}) {
        const k = kindOf(id);
        const st = STATS[id];
        const hint = k === 'nim' ? `贏${pct(st.pWin)}<br>和${pct(st.pPush)}<br>EV −${st.edge.toFixed(2)}%` : `贏${pct(st.pWin)}<br>EV −${st.edge.toFixed(2)}%`;
        return el('div', { class: ['lg-spot', 'ft-spot', `ft-spot--${k}`, cls], dataset: { bet: id }, title: `${labelOf(id)} ${ODDS_TEXT[k]}` }, [
          el('span.lg-spot__zh', { text: zh ?? labelOf(id) }),
          el('span.lg-spot__en', { text: en ?? T[k].en }),
          el('span.lg-spot__odds', { text: odds ?? ODDS_TEXT[k] }),
          el('span.ft-spot__hint', { html: hint }),
        ]);
      }
      const nim = (a, b, cls) => spot(`nim-${a}-${b}`, { cls });
      function zone(n) {
        const fan = spot(`fan-${n}`, { zh: `番 ${n}`, cls: 'ft-fan' });
        fan.insertBefore(el('b.ft-fan__num', { text: String(n) }), fan.firstChild);
        // 每號格：中心 = 番；三個方向 = 念（主號 = n，副號 = 靠向的號）
        const parts = {
          1: [nim(1, 3, 'ft-in'), fan, nim(1, 2, 'ft-l'), nim(1, 4, 'ft-r')],
          3: [fan, nim(3, 1, 'ft-in'), nim(3, 2, 'ft-l'), nim(3, 4, 'ft-r')],
          2: [nim(2, 3, 'ft-t'), fan, nim(2, 4, 'ft-in'), nim(2, 1, 'ft-b')],
          4: [nim(4, 3, 'ft-t'), nim(4, 2, 'ft-in'), fan, nim(4, 1, 'ft-b')],
        }[n];
        return el('div', { class: ['ft-zone', `ft-zone--${n}`], dataset: { zone: n } }, parts);
      }
      const kwok = (a, b, cls) => spot(`kwok-${a}-${b}`, { cls: ['ft-kwok', cls] });

      function buildTable() {
        pileEl = el('div.ft-pile');
        countEl = el('div.ft-count', { 'aria-live': 'polite' });
        resultEl = el('div.ft-result');
        centerEl = el('div.ft-center.is-covered', [
          pileEl,
          el('div.ft-bowl', [el('span', { html: '碗 <i class="en">Bowl</i>' })]),
          el('div.ft-stick', { 'aria-hidden': 'true' }),
          resultEl, countEl,
        ]);
        const square = el('div.ft-square', [
          kwok(2, 3, 'ft-k23'), zone(3), kwok(3, 4, 'ft-k34'),
          zone(2), centerEl, zone(4),
          kwok(1, 2, 'ft-k12'), zone(1), kwok(1, 4, 'ft-k14'),
        ]);
        const outer = el('div.ft-outer', [
          el('div.ft-outer__row', [
            spot('kwok-1-3', { cls: 'ft-kwok' }), spot('odd', { zh: '單 1·3' }), spot('even', { zh: '雙 2·4' }), spot('kwok-2-4', { cls: 'ft-kwok' }),
          ]),
          el('div.ft-outer__k', { html: '三門 <i class="en">Nga Tan</i>：押三個號（以缺號命名），1:3' }),
          el('div.ft-outer__row', N4.map((n) => spot(`ngatan-${n}`, { zh: others(n).join('·'), en: `NGA TAN · 缺 ${n}` }))),
        ]);
        histEl = el('div.ft-history');
        fastB = el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-btn--ghost ft-fast', dataset: { action: 'fast' }, 'aria-pressed': 'false', html: T.fast });
        fastB.addEventListener('click', () => {
          state.fast = !state.fast;
          fastB.setAttribute('aria-pressed', state.fast ? 'true' : 'false');
          fastB.classList.toggle('is-on', state.fast);
          fastB.innerHTML = state.fast ? T.fastOn : T.fast;
        });
        tableEl = el('div.lg-table.ft-table', [
          el('div.ft-controls', [el('div.ft-history__wrap', [el('div.ft-history__k', { text: T.history }), histEl]), fastB]),
          el('div.ft-board', [square]),
          outer,
        ]);
        const actions = el('div.lg-actions', { dataset: { dealSlot: '' } });
        const chips = el('div');
        const barEl = el('div');
        hintEl = el('div.lg-hint.ft-hint', { hidden: true });
        root.append(tableEl, hintEl, actions, chips, barEl);

        tray = ui.chipTray(chips, { denoms: ctx.denoms, selected: ctx.isReal ? 50 : 10 });
        layer = ui.betLayer(tableEl, { bets, chipTray: tray, gameId: ctx.gameId });
        bar = ui.betBar(barEl, { bets, layer });
        coverBowl();
        paintHistory();
      }

      function coverBowl() {
        centerEl.classList.add('is-covered');
        centerEl.classList.remove('is-open', 'is-done');
        pileEl.replaceChildren();
        resultEl.textContent = '';
        countEl.textContent = '';
      }
      function renderPile(n) {
        const frag = [];
        for (let i = 0; i < n; i++) frag.push(el('i', { style: `--h:${(i * 47) % 360}` }));
        pileEl.replaceChildren(...frag);
      }
      function showCount(left, total) {
        countEl.innerHTML = `剩 <b>${left}</b> 顆 <i class="en">left</i>${total ? `（共 ${total}）` : ''}`;
      }
      function markSpots(r) {
        const m = r ? spotStates(r) : new Map();
        tableEl.querySelectorAll('[data-bet]').forEach((s) => {
          const st = m.get(s.dataset.bet);
          s.classList.toggle('is-win', st === 'win');
          s.classList.toggle('ft-push', st === 'push');
          s.classList.toggle('is-lose', !!r && !st && bets.get(s.dataset.bet) > 0);
        });
      }
      function showResult(r, n) {
        centerEl.classList.remove('is-covered');
        centerEl.classList.add('is-open', 'is-done');
        renderPile(r);
        resultEl.innerHTML = `開 ${r} <i class="en">${EN_NUM[r]}</i>`;
        showCount(r, n);
        markSpots(r);
      }
      function paintHistory() {
        histEl.replaceChildren(...state.history.map((r) => el('span', { class: ['ft-hist', `ft-hist--${r}`], text: String(r) })));
        if (!state.history.length) histEl.appendChild(el('span.ft-hist--empty', { text: '—' }));
      }

      // ---- 練習提示
      function paintHints() {
        root.classList.toggle('ft-show-hints', !!ctx.hints);
        hintEl.hidden = !ctx.hints;
        hintEl.innerHTML = '提示：每格小字 = 中獎機率與扣佣後 EV。每個號碼都是 25%；番最差（−3.75%），念/角/單雙 −2.5%，三門 −1.25% 但贏得最少。';
      }
      function strategyTable() {
        const rows = [['注別', '賠率', '中獎率', '扣佣後優勢']];
        [['番', 'fan-1'], ['念', 'nim-1-2'], ['角', 'kwok-1-2'], ['單 / 雙', 'odd'], ['三門', 'ngatan-4']].forEach(([zh, id]) => {
          const s = STATS[id];
          rows.push([zh, ODDS_TEXT[kindOf(id)], kindOf(id) === 'nim' ? `${pct(s.pWin)}（和 ${pct(s.pPush)}）` : pct(s.pWin), `${s.edge.toFixed(2)}%`]);
        });
        return ui.table(rows, { caption: '贏注派彩 × 0.95（5% 佣）' });
      }

      // ---- 一局流程
      function startRound() {
        if (!ctx.alive()) return;
        state.phase = 'betting';
        tableEl.querySelectorAll('[data-bet].is-lose').forEach((s) => s.classList.remove('is-lose'));
        ctx.bettingWindow({ bets, onClose: onNoMoreBets, label: '開碗 <i class="en">Open</i>' });
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
        state.phase = 'counting';
        markSpots(null);
        coverBowl();
        const n = state.rig || LG.rng.int(BUTTONS.min, BUTTONS.max);
        state.rig = null;
        state.count = n;
        renderPile(n);
        ctx.dealer.say('掀碗', 'Lifting the bowl');
        await ctx.wait(350);
        if (!ctx.alive()) return;
        centerEl.classList.remove('is-covered');
        centerEl.classList.add('is-open');
        showCount(n, 0);
        await ctx.wait(400);
        if (!ctx.alive()) return;
        ctx.dealer.say('每次撥 4 顆', 'Four at a time');
        const seq = strokes(n);
        if (reduceMotion()) { renderPile(seq[seq.length - 1]); }
        else {
          for (let i = 1; i < seq.length; i++) {
            const kids = [...pileEl.children].slice(-BUTTONS.per);
            kids.forEach((k) => k.classList.add('is-out'));
            centerEl.classList.remove('is-stroke'); void centerEl.offsetWidth; centerEl.classList.add('is-stroke');
            await ctx.wait(state.fast ? Math.ceil(STEP_MS / FAST) : STEP_MS);
            if (!ctx.alive()) return;
            kids.forEach((k) => k.remove());
            showCount(seq[i], n);
          }
        }
        const r = resultFromCount(n);
        showResult(r, n);
        ctx.dealer.say(`開${ZH_NUM[r]}`, EN_NUM[r]);
        await ctx.wait(300);
        if (!ctx.alive()) return;
        finishRound(r, n);
      }

      function finishRound(r, n) {
        state.result = r;
        const res = settle(bets.entries(), r);
        state.last = { ...res, count: n };
        ctx.bank.credit(res.returned);
        state.staked = 0;
        state.history.unshift(r);
        state.history = state.history.slice(0, 10);
        paintHistory();
        ctx.dealer.say(`開${ZH_NUM[r]}，派彩`, `${EN_NUM[r]}. Paying out`);
        ctx.recordRound({ wagered: res.wagered, net: res.net, outcome: res.net > 0 ? 'win' : res.net < 0 ? 'lose' : 'push' });
        ctx.explain({
          hand: `鈕扣 <b>${n}</b> 顆，每次撥 4 顆 → ${n} ÷ 4 餘 ${n % 4}${n % 4 === 0 ? '（餘 0 算 4）' : ''} → 剩 <b>${r}</b> 顆`,
          result: `開 ${r} <i class="en">${EN_NUM[r]}</i>（${r % 2 ? '單' : '雙'}）`,
          formula: res.lines.map((l) => l.formula).join('<br>')
            + (res.commission > 0 ? `<br>佣金 5% 共 ${fmt(res.commission)}` : '') + `<br>淨 <b>${money.fmtSigned(res.net)}</b>`,
          why: '<ul class="ft-why">' + res.lines.map((l) => `<li><b>${l.label}</b>：${l.why}</li>`).join('') + '</ul>'
            + '<p class="lg-muted">贏注派彩一律 × 0.95（抽 5% 佣）；念的副號開出是和局，退回本金。</p>',
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
        showResult(r, n) { showResult(r, n || r); },
        cover() { coverBowl(); markSpots(null); },
        rig(n) { state.rig = n; },
      };

      function tutorialSteps() {
        const edgeRows = [['番 Fan', 'fan-1'], ['念 Nim', 'nim-1-2'], ['角 Kwok', 'kwok-1-2'], ['單雙', 'odd'], ['三門', 'ngatan-4']]
          .map(([zh, id]) => `<tr><td>${zh}</td><td>${ODDS_TEXT[kindOf(id)]}</td><td>${STATS[id].edge.toFixed(2)}%</td></tr>`).join('');
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：番攤方桌',
            body: '<p>方桌四邊是號碼：下 1、左 2、上 3、右 4。中間是<b>碗 <i class="en">Bowl</i></b>，蓋著一把鈕扣。</p>',
            highlight: ['.ft-square'], setup: (inst) => inst.demo.cover() },
          { id: 'layout-fan', section: 'layout', title: '番 <i class="en">Fan</i>：押一個號',
            body: '<p>籌碼放在號碼<b>中心</b> = 番。開出這個號賠 3:1（扣 5% 佣）。</p>',
            highlight: ['.ft-fan'] },
          { id: 'layout-nim', section: 'layout', title: '念 <i class="en">Nim</i>：一主一副',
            body: '<p>放在號碼格<b>靠向另一號</b>的一側。「3念2」：開 3 贏 2:1，開 2 和局退注，其他輸。</p>',
            highlight: ['[data-bet="nim-3-2"]', '[data-bet="nim-3-4"]', '[data-bet="nim-3-1"]'] },
          { id: 'layout-kwok', section: 'layout', title: '角 <i class="en">Kwok</i>：押兩號',
            body: '<p>放在兩號之間的角落 = 角。兩個號任一開出就贏 1:1。</p>',
            highlight: ['.ft-kwok'] },
          { id: 'layout-ngatan', section: 'layout', title: '三門 <i class="en">Nga Tan</i>：押三號',
            body: '<p>一次押三個號，以「缺的那號」命名。三號任一開出贏 1:3（押 3 贏 1）。</p>',
            highlight: ['.ft-spot--ngatan'] },
          { id: 'layout-oddeven', section: 'layout', title: '單 <i class="en">Odd</i> / 雙 <i class="en">Even</i>',
            body: '<p>單 = 1 或 3，雙 = 2 或 4，賠 1:1。角 1-3、角 2-4 效果和單雙一樣。</p>',
            highlight: ['[data-bet="odd"]', '[data-bet="even"]'] },
          { id: 'layout-chips', section: 'layout', title: '籌碼 <i class="en">Chips</i>',
            body: '<p>10 藍、25 綠、50 橙、100 黑、500 紫、1000 黃。現場顏色可能不同，看面額。</p>',
            highlight: ['.lg-chips'],
            action: { label: '點選 RM 50 籌碼', check: (inst) => inst.tray().selected() === 50 || '點一下「50」那枚籌碼' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：碗蓋住才能下注',
            body: '<p>荷官用碗蓋住鈕扣、喊 <b>請下注 <i class="en">Place your bets</i></b>，這時才能放籌碼。</p>',
            highlight: ['.ft-center', '.lg-dealer-banner'],
            setup: (inst) => { inst.demo.cover(); inst.demo.ensureBetting(); inst.demo.showBanner('請下注', 'Place your bets'); } },
          { id: 'flow-place', section: 'flow', title: '押番 3',
            body: '<p>點「番 3」的中心格放籌碼。長按或右鍵拿回一枚。</p>',
            highlight: ['[data-bet="fan-3"]', '.lg-chips'],
            setup: (inst) => inst.demo.ensureBetting(),
            action: { label: '在「番 3」放至少 RM 50', check: (inst) => inst.bets.get('fan-3') >= 50 || `目前番 3 上有 ${fmt(inst.bets.get('fan-3'))}` } },
          { id: 'flow-open', section: 'flow', title: '掀碗、撥扣',
            body: '<p>按「開碗」：碗掀開，荷官用棒子<b>每次撥走 4 顆</b>，直到剩 1–4 顆。</p>',
            highlight: ['[data-action="deal"]', '.ft-center'],
            setup: (inst) => { inst.demo.ensureBetting(); inst.demo.rig(63); },
            action: { label: '按「開碗 Open」玩一局', check: (inst) => inst.state.rounds > 0 || '先在番 3 放籌碼，再按開碗' } },
          { id: 'flow-no-touch', section: 'flow', title: '撥扣中不可碰',
            body: '<p>荷官說 <b>No more bets</b> 後，手放桌下。撥扣過程中碰籌碼會被當成作弊。</p>',
            highlight: ['.lg-dealer-banner', '.ft-board'],
            setup: (inst) => inst.demo.showBanner('停止下注', 'No more bets') },
          { id: 'flow-remainder', section: 'flow', title: '剩幾顆就開幾',
            body: '<p>63 顆：每撥 4 顆，撥 15 次後剩 <b>3</b> 顆 → 開 3。算法 = 63 ÷ 4 的餘數；餘 0 算 4。</p>',
            highlight: ['.ft-center'], setup: (inst) => inst.demo.showResult(3, 63) },
          { id: 'flow-fast', section: 'flow', title: '加速鍵',
            body: '<p>撥扣很慢時按「加速 <i class="en">Fast</i>」，動畫快 5 倍，結果不變。</p>',
            highlight: ['[data-action="fast"]'] },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：扣佣怎麼算',
            body: '<p>所有<b>贏注</b>的彩金都抽 5% <b>佣 <i class="en">Commission</i></b>，也就是彩金 × 0.95。</p>',
            highlight: ['.lg-spot__odds'], setup: (inst) => inst.demo.cover() },
          { id: 'payout-fan', section: 'payout', title: '番 3:1 扣佣',
            body: '<p>押番 RM 100 贏：<br><b>RM 100 × 3 × 0.95 = RM 285</b>（淨贏）<br>拿回 RM 385（含本金）。</p>',
            highlight: ['.ft-fan'], setup: (inst) => inst.demo.showResult(3, 63) },
          { id: 'payout-nim', section: 'payout', title: '念的和局 <i class="en">Push</i>',
            body: '<p>押「3念2」RM 100，開 2 → 和局，退回 RM 100，淨 RM 0。開 3 → RM 100 × 2 × 0.95 = RM 190（淨贏），拿回 RM 290。</p>',
            highlight: ['[data-bet="nim-3-2"]'], setup: (inst) => inst.demo.showResult(2, 62) },
          { id: 'payout-ngatan', section: 'payout', title: '三門 1:3',
            body: '<p>押三門 1·2·3 RM 300，開 1：<br><b>RM 300 × 1/3 × 0.95 = RM 95</b>（淨贏）<br>拿回 RM 395。開 4 則輸 RM 300。</p>',
            highlight: ['[data-bet="ngatan-4"]'], setup: (inst) => inst.demo.showResult(1, 61) },
          { id: 'payout-try', section: 'payout', title: '押一個角試試',
            body: '<p>角押兩個號，贏 1:1：RM 100 × 1 × 0.95 = RM 95（淨贏），拿回 RM 195。</p>',
            highlight: ['.ft-kwok'],
            setup: (inst) => { inst.demo.cover(); inst.demo.ensureBetting(); },
            action: { label: '在任一個「角」放籌碼', check: (inst) => inst.bets.entries().some(([id]) => id.startsWith('kwok-')) || '點四個角落或下方「角 1-3 / 2-4」' } },
          // ===== strategy
          { id: 'strategy-edge', section: 'strategy', title: '這段你會學到：莊家優勢 <i class="en">House edge</i>',
            body: `<table class="lg-datatable"><tr><th>注</th><th>賠率</th><th>扣佣後優勢</th></tr>${edgeRows}</table>`,
            highlight: null },
          { id: 'strategy-do', section: 'strategy', title: '該押：念 / 角 / 單雙',
            body: '<p>優勢 2.5%，差不多一樣。三門 1.25% 更低，但每次贏得很少。</p>',
            highlight: ['.ft-kwok', '[data-bet="odd"]', '[data-bet="even"]'] },
          { id: 'strategy-dont', section: 'strategy', title: '別押：番',
            body: '<p>番賠最多（3:1），但扣佣後優勢 <b>3.75%</b>，是全桌最差的注。</p>',
            highlight: ['.ft-fan'] },
          { id: 'strategy-swing', section: 'strategy', title: '波動大小自選',
            body: '<p>番：少贏多輸、起伏大。三門：常贏但贏很少、起伏小。優勢差不多，挑你受得了的。</p>',
            highlight: ['.ft-fan', '.ft-spot--ngatan'] },
          { id: 'strategy-history', section: 'strategy', title: '路單只是紀錄',
            body: '<p>連開三次 4，下一局開 4 的機率還是 25%。<b>這只是紀錄，不能預測。</b></p>',
            highlight: ['.ft-history'] },
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
          root.classList.add('ft-root');
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
