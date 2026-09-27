// ============================================================================
// 3 軸經典機（FAFAFA 風）id: slot-classic — 規格 docs/05-game-rules/slot-classic.md
//
// 單一賠付線（中線）、3 軸、每軸顯示 3 格。符號：金發 G / 紅發 R / 藍發 B / 空白 X。
// 賠付（乘「每轉總注 = credits × credit 價值」）：
//   金金金 1000×、紅紅紅 200×、藍藍藍 50×、任意三個發（混色）10×、任意兩個發 2×、任意一個發 1×、沒有發 0。
//
// 轉軸帶（最終版，由 docs/change-requests/slot-classic.md 記錄調整過程）：
//   軸 1（32 停）：XXGXXXBXXXBXXXRXXXBXXXBXXXBXXXBX   金 1、紅 1、藍 6、空白 24
//   軸 2（35 停）：XRXXXBXXXGXXXBXXXBXXXRXXXBXXXGXXXBX 金 2、紅 2、藍 5、空白 26
//   軸 3（32 停）：XXXBXXXXXRXXXXXXBXXXXXGXXXXXBXXX   金 1、紅 1、藍 3、空白 27
// 精確 RTP（32×35×32 = 35,840 種停點組合全列舉）= 90.0000%；命中率（含 1× 退本）53.0%。
// simulateRTP：LG.rng.seed(4) 500,000 轉 = 90.135%（測試用）；seed(123) 4,000,000 轉 = 89.787%。
//   注意：1000× 頭獎讓每轉標準差約 8 倍押注，500k 轉的標準誤約 1.1%，
//   所以單元測試同時驗「精確值 = 90% ± 0.5%」與「固定 seed 模擬落在 89.5–90.5%」。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;
  const cents = (n) => fmt(n, { cents: true });

  // ---------------------------------------------------------------- 文案
  const T = {
    title: 'FA FA FA',
    credit: { zh: '餘額', en: 'CREDIT' },
    bet: { zh: '押注', en: 'BET' },
    win: { zh: '贏分', en: 'WIN' },
    denom: '面額 <i class="en">Credit value</i>',
    credits: '注數 <i class="en">Credits</i>',
    spin: 'SPIN 轉',
    cashout: '兌現 <i class="en">Cash out</i>',
    payline: '中線 <i class="en">Payline</i>',
    noMoney: '餘額不足，降低面額或注數',
    overMax: (max) => `每轉最高 ${cents(max)}`,
    underMin: (min) => `每轉最低 ${cents(min)}`,
    noWin: (bet) => `未中獎，本次投入 ${cents(bet)}`,
    hint: '提示：RTP 90% = 每押 RM 100，長期平均拿回 RM 90。押大押小，比例都一樣；每一轉都是獨立的，沒有「快出了」。',
  };

  // ---------------------------------------------------------------- 符號、轉軸帶、賠付
  const SYMBOLS = {
    G: { zh: '金發', en: 'Gold Fa', short: '金', color: '#b8860b' },
    R: { zh: '紅發', en: 'Red Fa', short: '紅', color: '#d0141b' },
    B: { zh: '藍發', en: 'Blue Fa', short: '藍', color: '#1846c9' },
    X: { zh: '空白', en: 'Blank', short: '', color: '#999' },
  };
  const isFa = (s) => s === 'G' || s === 'R' || s === 'B';
  const STRIPS = [
    'XXGXXXBXXXBXXXRXXXBXXXBXXXBXXXBX',
    'XRXXXBXXXGXXXBXXXBXXXRXXXBXXXGXXXBX',
    'XXXBXXXXXRXXXXXXBXXXXXGXXXXXBXXX',
  ].map((s) => Object.freeze([...s]));
  Object.freeze(STRIPS);

  /** 賠付表（由高到低） */
  const PAYS = [
    { id: 'GGG', zh: '金發 金發 金發', en: 'Three Gold', mult: 1000 },
    { id: 'RRR', zh: '紅發 紅發 紅發', en: 'Three Red', mult: 200 },
    { id: 'BBB', zh: '藍發 藍發 藍發', en: 'Three Blue', mult: 50 },
    { id: 'MIX3', zh: '任意三個發（混色）', en: 'Any three Fa', mult: 10 },
    { id: 'ANY2', zh: '任意兩個發', en: 'Any two Fa', mult: 2 },
    { id: 'ANY1', zh: '任意一個發', en: 'Any one Fa', mult: 1 },
    { id: 'NONE', zh: '沒有發', en: 'No Fa', mult: 0 },
  ];
  const PAY = Object.fromEntries(PAYS.map((p) => [p.id, p]));
  const CREDIT_VALUES = [0.1, 0.2, 0.5, 1, 2, 5];
  const CREDITS = [1, 2, 3, 4, 5];
  const MID = 1; // 中線 = row 1

  /**
   * 評中線。line = [軸1, 軸2, 軸3] 的符號。
   * @returns {{id, zh, en, mult, count, cells:number[][]}}  cells = 中線上「發」的格 [[reel,row]]
   */
  function evalLine(line) {
    const count = line.filter(isFa).length;
    let id;
    if (count === 3) id = line[0] === line[1] && line[1] === line[2] ? `${line[0]}${line[0]}${line[0]}` : 'MIX3';
    else id = ['NONE', 'ANY1', 'ANY2'][count];
    const cells = line.map((s, reel) => (isFa(s) ? [reel, MID] : null)).filter(Boolean);
    return { ...PAY[id], count, cells };
  }
  /** grid[reel][row] → 中線結果 */
  const evalGrid = (grid) => evalLine(grid.map((col) => col[MID]));

  /** 精確機率：每個組合的出現率與對 RTP 的貢獻（全列舉停點） */
  function comboStats(strips = STRIPS) {
    const freq = strips.map((s) => {
      const f = {};
      s.forEach((x) => { f[x] = (f[x] || 0) + 1 / s.length; });
      return f;
    });
    const out = Object.fromEntries(PAYS.map((p) => [p.id, 0]));
    const syms = Object.keys(SYMBOLS);
    for (const a of syms) for (const b of syms) for (const c of syms) {
      const p = (freq[0][a] || 0) * (freq[1][b] || 0) * (freq[2][c] || 0);
      if (p) out[evalLine([a, b, c]).id] += p;
    }
    const rows = PAYS.map((x) => ({ ...x, p: out[x.id], contrib: out[x.id] * x.mult }));
    const rtp = rows.reduce((s, r) => s + r.contrib, 0);
    const hit = rows.filter((r) => r.mult > 0).reduce((s, r) => s + r.p, 0);
    return { rows, rtp, hit };
  }

  /** RTP 模擬（LG.slots.simulateRTP；bet = 1 單位） */
  function simulate(spins = 500000, seed = 4) {
    if (seed !== null && seed !== undefined) LG.rng.seed(seed);
    const r = LG.slots.simulateRTP({ strips: STRIPS, rows: 3, evaluate: (g) => evalGrid(g).mult, bet: 1 }, spins);
    if (seed !== null && seed !== undefined) LG.rng.seed(null);
    return r;
  }

  const lineText = (line) => line.map((s) => (s === 'X' ? '空白' : SYMBOLS[s].zh)).join(' · ');

  /** Pay Table modal 內容 */
  function paytableHtml() {
    const rows = PAYS.map((p) => `<tr><td>${p.zh} <i class="en">${p.en}</i></td><td class="sc-pt__m">${p.mult ? `${p.mult}×` : '—'}</td><td>${p.mult ? cents(round2(0.5 * p.mult)) : 'RM 0'}</td></tr>`).join('');
    return `<div class="sc-pt">
      <p><b>倍數 × 每線注</b>：本機只有 1 條線（中線），所以每線注 = 每轉總注 = <b>注數 <i class="en">Credits</i> × 面額 <i class="en">Credit value</i></b>。</p>
      <table class="lg-datatable"><thead><tr><th>中線組合</th><th>倍數</th><th>押 RM 0.50 時</th></tr></thead><tbody>${rows}</tbody></table>
      <ul class="lg-list">
        <li>只有<b>中線</b>（金色箭頭那一列）算分；上、下兩列只是「看起來差一點」。</li>
        <li>「發」不分顏色都算：兩個發 2×、一個發 1×（1× 只是拿回本金，淨贏 0）。</li>
        <li>例：押 RM 0.50 中任意三個發 → RM 0.50 × 10 = RM 5.00（淨贏 RM 4.50）。</li>
        <li>RTP <i class="en">Return to Player</i> 90%：長期每押 RM 100 平均拿回 RM 90。</li>
      </ul></div>`;
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'slot-classic',
    category: 'slots',
    order: 1,
    name: { zh: '3 軸經典機', en: 'Classic 3-Reel (FA FA FA)' },
    summary: '只有一條線、一種「發」字：看懂老虎機最簡單的一台。',
    houseEdge: [{ bet: { zh: '總體', en: 'Overall' }, edge: 10.0, best: true }],
    limits: { real: { min: 0.1, max: 25 }, practice: { min: 0.1, max: 25 } },
    countdown: 0,                 // 老虎機不倒數：核心進場 modal 顯示「不倒數」
    startHint: '按 SPIN 就轉，只顯示輸贏金額',
    limitsLabel: (l) => `每轉 ${LG.money.fmt(l.min, { cents: true })} – ${LG.money.fmt(l.max, { cents: true })}`,
    logic: { STRIPS, SYMBOLS, PAYS, CREDIT_VALUES, CREDITS, evalLine, evalGrid, comboStats, simulate },

    create(ctx) {
      const state = { phase: 'idle', staked: 0, spins: 0, lastWin: 0, paytableOpened: false, cashedOut: false, wagered: 0, won: 0 };
      let root, view, panel, spinB, meters = {}, hintEl, winAnim = 0;
      let ready = !ctx.isReal;

      // ---- 畫面
      const symView = Object.fromEntries(Object.entries(SYMBOLS).map(([k, s]) => [k, {
        label: s.zh,
        svg: k === 'X' ? '<span class="sc-blank" aria-hidden="true"></span>'
          : `<span class="sc-fa sc-fa--${k}"><b>發</b><small>${s.short}</small></span>`,
      }]));

      function meter(key, t) {
        const v = el('b.sc-meter__v', { dataset: { role: key } });
        meters[key] = v;
        return el('div', { class: ['sc-meter', `sc-meter--${key}`] }, [el('span.sc-meter__k', { html: `${t.en} <i class="en">${t.zh}</i>` }), v]);
      }

      function build() {
        const head = el('div.sc-head', [el('div.sc-logo', { html: `<span>FA</span><span>FA</span><span>FA</span>` })]);
        const reels = el('div.sc-reels');
        const wrap = el('div.sc-reelwrap', [
          el('span.sc-payline.sc-payline--l', { 'aria-hidden': 'true', text: '▶' }),
          reels,
          el('span.sc-payline.sc-payline--r', { 'aria-hidden': 'true', text: '◀' }),
          el('span.sc-payline__label', { html: T.payline }),
        ]);
        const meterRow = el('div.sc-meters', [meter('credit', T.credit), meter('bet', T.bet), meter('win', T.win)]);
        const machine = el('div.sc-machine', [head, wrap, meterRow]);
        const ctrl = el('div.sc-controls');
        spinB = el('button', { type: 'button', class: 'lg-btn lg-btn--primary sc-spin', dataset: { action: 'spin' }, html: T.spin });
        const cashB = el('button', { type: 'button', class: 'lg-btn lg-btn--ghost lg-btn--sm sc-cashout', dataset: { action: 'cashout' }, html: T.cashout });
        hintEl = el('div.lg-hint.sc-hint', { hidden: true });
        root.append(machine, ctrl, el('div.sc-spinrow', [cashB, spinB]), hintEl);

        view = LG.slotView.create(reels, { reels: 3, rows: 3, symbols: symView, strips: STRIPS, spinMs: 800, stepMs: 200 });
        view.setGrid(LG.slots.gridAt(STRIPS, [0, 7, 1]));
        const pb = LG.slotView.paytableButton(head, { render: paytableHtml });
        pb.addEventListener('click', () => { state.paytableOpened = true; });
        panel = LG.slotView.betPanel(ctrl, {
          lines: CREDITS, lineBets: CREDIT_VALUES, linesLabel: T.credits, lineBetLabel: T.denom,
          onChange: () => { paintMeters(); paintSpin(); },
        });
        panel.el.children[0].classList.add('sc-denom');
        panel.el.children[1].classList.add('sc-credits');
        spinB.addEventListener('click', () => { spin(); });
        cashB.addEventListener('click', cashOut);
        ctx.on('bank:change', () => { paintMeters(); paintSpin(); });
        paintMeters();
        setWin(0);
        paintSpin();
      }

      function paintMeters() {
        if (!meters.credit) return;
        meters.credit.textContent = cents(ctx.bank.balance());
        meters.bet.textContent = cents(panel.bet());
      }
      function setWin(n) { if (meters.win) { meters.win.textContent = cents(n); meters.win.dataset.win = String(n); } }
      /** 贏分滾動累加 */
      function rollWin(target) {
        cancelAnimationFrame(winAnim);
        const dur = LG.ms(target > 0 ? 700 : 0);
        if (!dur || typeof requestAnimationFrame !== 'function') { setWin(target); return; }
        const t0 = performance.now();
        const step = (t) => {
          if (!ctx.alive()) return;
          const k = Math.min(1, (t - t0) / dur);
          setWin(k >= 1 ? target : round2(target * k));
          if (k < 1) winAnim = requestAnimationFrame(step);
        };
        winAnim = requestAnimationFrame(step);
      }
      function canSpin() {
        return ready && state.phase === 'idle' && ctx.bank.canAfford(panel.bet());
      }
      function paintSpin() {
        if (!spinB) return;
        spinB.disabled = !canSpin();
        // 餘額付不起目前押注：SPIN 灰掉 + 提示一次（恢復可付後重置）
        const broke = ready && state.phase === 'idle' && !ctx.bank.canAfford(panel.bet());
        if (broke && !state.warnedAfford) ui.toast(T.noMoney, { type: 'warn' });
        state.warnedAfford = broke;
        spinB.classList.toggle('is-spinning', state.phase === 'spinning');
        if (panel) panel.setEnabled(state.phase === 'idle');
      }
      function paintHints() {
        if (!hintEl) return;
        hintEl.hidden = !ctx.hints;
        const ret = state.wagered ? ` 本次已押 ${cents(state.wagered)}，拿回 ${cents(state.won)}（${((state.won / state.wagered) * 100).toFixed(1)}%）——短期會亂跳，長期才會接近 90%。` : '';
        hintEl.textContent = T.hint + ret;
      }

      // ---- 一轉
      async function spin() {
        if (state.phase !== 'idle' || !ready) return;
        const bet = panel.bet();
        if (bet < ctx.limits.min - 1e-9) { ui.toast(T.underMin(ctx.limits.min), { type: 'warn' }); return; }
        if (bet > ctx.limits.max + 1e-9) { ui.toast(T.overMax(ctx.limits.max), { type: 'warn' }); return; }
        if (!ctx.bank.canAfford(bet)) { ui.toast(T.noMoney, { type: 'warn' }); paintSpin(); return; }
        state.phase = 'spinning';
        ctx.bank.debit(bet);
        state.staked = bet;
        setWin(0);
        paintSpin();
        const grid = LG.slots.spin(STRIPS, 3);
        const res = evalGrid(grid);
        const win = round2(res.mult * bet);
        await view.spin(grid);
        if (!ctx.alive()) return;
        settle(grid, res, bet, win);
      }

      function settle(grid, res, bet, win) {
        if (win > 0) ctx.bank.credit(win);
        state.staked = 0;
        state.spins += 1;
        state.lastWin = win;
        state.wagered = round2(state.wagered + bet);
        state.won = round2(state.won + win);
        if (res.mult > 0) view.highlight(res.cells);
        rollWin(win);
        const net = round2(win - bet);
        ctx.recordRound({ wagered: bet, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' });
        const line = grid.map((c) => c[MID]);
        const credits = panel.lines(), cv = panel.lineBet();
        const betText = `${cents(bet)}（${credits} credit${credits > 1 ? 's' : ''} × ${cents(cv)}）`;
        ctx.explain({
          net,
          hand: `中線 <i class="en">Payline</i>：<b>${lineText(line)}</b>`,
          result: res.mult > 0 ? `${res.zh} <i class="en">${res.en}</i> → <b>${res.mult}×</b>` : `未中獎 <i class="en">No win</i>`,
          formula: res.mult > 0
            ? `押注 ${betText} × ${res.mult} = <b>${cents(win)}</b>（拿回，含本金）<br>淨 <b>${money.fmtSigned(net)}</b>`
            : `${T.noWin(bet)}<br>淨 <b>${money.fmtSigned(net)}</b>`,
          why: whyText(res),
        });
        state.phase = 'idle';
        paintSpin();
        paintHints();
        ctx.checkBroke();
      }

      function whyText(res) {
        const base = '只算中線；上、下兩列不算分。';
        switch (res.id) {
          case 'GGG': case 'RRR': case 'BBB': return `中線三個同色的發，照賠付表 ${res.mult}×。${base}`;
          case 'MIX3': return `中線三格都是發但顏色不同，算「任意三個發」10×。${base}`;
          case 'ANY2': return `中線有 2 個發（不分顏色），賠 2×。${base}`;
          case 'ANY1': return `中線只有 1 個發，賠 1×——剛好拿回本金，淨贏 0。${base}`;
          default: return `中線沒有任何發，這一轉輸掉押注。${base}每一轉都是獨立的，上一轉輸了不代表下一轉「快出了」。`;
        }
      }

      function cashOut() {
        state.cashedOut = true;
        const bal = ctx.bank.balance();
        ui.modal({
          title: '兌現 <i class="en">Cash out</i>',
          body: `<div class="sc-ticket"><div class="sc-ticket__k">TITO <i class="en">Ticket in, ticket out</i></div><div class="sc-ticket__v">${cents(bal)}</div></div>
            <p>現場按 <b>CASH OUT</b> 後，機台會印出一張<b>票券</b>，拿去兌換機或櫃台換現金，也可以插進別台機器繼續玩。</p>
            <p class="lg-muted">練習場不會真的把錢拿走，餘額不變。</p>`,
        });
      }

      // ---- 教學示範
      const demo = {
        setGrid(mid, top = 'XXX', bot = 'XXX') {
          if (state.phase !== 'idle') return;
          view.reset();
          view.setGrid([0, 1, 2].map((r) => [top[r], mid[r], bot[r]]));
          const res = evalLine([...mid]);
          if (res.mult > 0) view.highlight(res.cells);
        },
        clear() { if (view && state.phase === 'idle') view.clear(); },
      };

      function tutorialSteps() {
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：機台長什麼樣',
            body: '<p>三個轉軸、一條中線、三個表（CREDIT / BET / WIN）和幾顆按鈕。先認識，再動手。</p>',
            highlight: ['.sc-machine'], setup: () => demo.clear() },
          { id: 'layout-meters', section: 'layout', title: `三個表 <i class="en">CREDIT / BET / WIN</i>`,
            body: '<p><b>CREDIT</b> 是餘額、<b>BET</b> 是這一轉押多少、<b>WIN</b> 是這一轉贏多少。</p>',
            highlight: ['.sc-meters'] },
          { id: 'layout-denom', section: 'layout', title: `面額 <i class="en">Credit value</i>`,
            body: '<p>一個 credit 值多少錢：RM 0.10 到 RM 5。按 + / − 調整。</p>',
            highlight: ['.sc-denom'],
            action: { label: '把面額調到 RM 0.50', check: () => panel.lineBet() === 0.5 || `目前面額 ${cents(panel.lineBet())}，按 + 或 −` } },
          { id: 'layout-credits', section: 'layout', title: `注數 <i class="en">Credits</i>`,
            body: '<p>每轉押 1–5 個 credit。<b>押注 = 注數 × 面額</b>，例：5 × RM 0.10 = RM 0.50。</p>',
            highlight: ['.sc-credits', '.lg-betpanel__total'] },
          { id: 'layout-maxbet', section: 'layout', title: `最大注 <i class="en">MAX BET</i>`,
            body: '<p>一鍵設成 5 credits × 最大面額 RM 5 = <b>RM 25</b>。很多真機按 MAX BET 會直接開轉，小心。</p>',
            highlight: ['[data-action="maxbet"]'] },
          { id: 'layout-paytable', section: 'layout', title: `賠付表 <i class="en">Pay Table</i>`,
            body: '<p>所有組合與倍數都寫在這裡。玩任何機台前先看一次。</p>',
            highlight: ['[data-action="paytable"]'],
            action: { label: '按「賠付表 Pay Table」打開看看', check: () => state.paytableOpened || '按左上角的「賠付表」' } },
          { id: 'layout-payline', section: 'layout', title: `中線 <i class="en">Payline</i>`,
            body: '<p>只有金色箭頭指的<b>中間那一列</b>算分。上下兩列的發再多也不算。</p>',
            highlight: ['.sc-reelwrap'], setup: () => demo.setGrid('GXR', 'GGX', 'XRG') },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一轉的流程',
            body: '<p>投注 → 按 SPIN → 三軸依序停 → 自動派彩 → 想走時兌現。沒有荷官，也沒有倒數。</p>',
            highlight: ['.sc-spinrow'], setup: () => demo.clear() },
          { id: 'flow-spin', section: 'flow', title: `轉 <i class="en">SPIN</i>`,
            body: '<p>按 SPIN，押注立刻從 CREDIT 扣掉。</p>',
            highlight: ['[data-action="spin"]', '.sc-meters'],
            action: { label: '按「SPIN 轉」轉一次', check: () => state.spins > 0 || '按下方的 SPIN 轉' } },
          { id: 'flow-stop', section: 'flow', title: '三軸依序停',
            body: '<p>第 1、2、3 軸依序停下。停下前結果早就決定好了，動畫只是表演。</p>',
            highlight: ['.sc-reels'] },
          { id: 'flow-pay', section: 'flow', title: `自動派彩 <i class="en">Payout</i>`,
            body: '<p>中獎時 WIN 會滾動累加，再自動加進 CREDIT。不用伸手，也不用等人。</p>',
            highlight: ['.sc-meters'] },
          { id: 'flow-cashout', section: 'flow', title: `兌現 <i class="en">Cash out</i>`,
            body: '<p>要走時按 CASH OUT，機台印出 <b>TITO 票券</b>，拿去兌換機換現金。</p>',
            highlight: ['[data-action="cashout"]'],
            action: { label: '按「兌現 Cash out」看票券', check: () => state.cashedOut || '按 SPIN 左邊的「兌現」' } },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼算贏多少',
            body: '<p>贏分 = <b>押注 × 倍數</b>。倍數看賠付表，押注看 BET 表。</p>',
            highlight: ['[data-action="paytable"]', '.sc-meters'] },
          { id: 'payout-mix', section: 'payout', title: '任意三個發 10×',
            body: '<p>押 RM 0.50，中線三個不同色的發：<br><b>RM 0.50 × 10 = RM 5.00</b>（拿回）<br>淨贏 RM 4.50。</p>',
            highlight: ['.sc-reelwrap'], setup: () => demo.setGrid('GRB', 'XXR', 'BXX') },
          { id: 'payout-one', section: 'payout', title: '一個發 1× ＝ 沒贏',
            body: '<p>押 RM 0.50 中一個發：RM 0.50 × 1 = RM 0.50。<br>拿回的剛好是本金，<b>淨贏 RM 0</b>。燈會亮，但你沒贏。</p>',
            highlight: ['.sc-reelwrap'], setup: () => demo.setGrid('XBX', 'RXX', 'XXG') },
          // ===== strategy
          { id: 'strategy-rtp', section: 'strategy', title: `這段你會學到：RTP 是什麼 <i class="en">Return to Player</i>`,
            body: '<table class="lg-datatable"><tr><th>RTP</th><th>莊家優勢</th></tr><tr><td>90%</td><td>10%</td></tr></table><p>每押 RM 100，長期平均拿回 RM 90、輸 RM 10。</p>',
            highlight: null, setup: () => demo.clear() },
          { id: 'strategy-size', section: 'strategy', title: '押大不改變比例',
            body: '<p>每轉 RM 0.10 平均輸 RM 0.01；每轉 RM 25 平均輸 RM 2.50。<b>比例都是 10%</b>，押大只是輸得快。</p>',
            highlight: ['.lg-betpanel'] },
          { id: 'strategy-due', section: 'strategy', title: '沒有「快出了」',
            body: '<p>每一轉都獨立。連輸 50 轉，下一轉中獎機率一樣。<br>「很久沒開」<b>這只是紀錄，不能預測</b>。</p>',
            highlight: ['.sc-reels'] },
          { id: 'strategy-do', section: 'strategy', title: '該押：小面額、當娛樂費',
            body: '<p>用 RM 0.10–0.50 慢慢玩，把輸掉的當成買娛樂的錢。</p>',
            highlight: ['.sc-denom'] },
          { id: 'strategy-dont', section: 'strategy', title: '別押：追損加注',
            body: '<p>輸了按 MAX BET 想一次翻本，只會讓 10% 的損失來得更快。</p>',
            highlight: ['[data-action="maxbet"]'] },
          { id: 'strategy-budget', section: 'strategy', title: `預算與停損 <i class="en">Stop-loss</i>`,
            body: '<p>今晚只帶 RM 500，輸完就走；贏了先把本金收起來。</p>',
            highlight: ['.sc-meter--credit'] },
        ];
      }

      return {
        state,
        demo,
        panel: () => panel,
        view: () => view,
        spin,
        mount(el0) {
          root = el0;
          root.classList.add('sc-root');
          build();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) {
            const st = comboStats();
            ctx.strategyPanel(ui.table([['組合', '倍數', '機率', '貢獻 RTP'],
              ...st.rows.map((r) => [r.zh, r.mult ? `${r.mult}×` : '—', `${(r.p * 100).toFixed(r.p < 0.001 ? 4 : 2)}%`, `${(r.contrib * 100).toFixed(2)}%`]),
              ['合計', '', `中獎 ${(st.hit * 100).toFixed(1)}%`, `${(st.rtp * 100).toFixed(1)}%`]], { caption: 'RTP 90% 從哪裡來' }));
          }
          if (ctx.isReal) {
            ctx.ready.then(() => { ready = true; paintSpin(); });
          }
          root.dataset.ready = '1';
        },
        unmount() {
          cancelAnimationFrame(winAnim);
          // 轉到一半離開：退回已扣未結算的押注
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (view) view.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
