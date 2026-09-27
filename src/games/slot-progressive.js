// ============================================================================
// 四級累積獎金機「金龍」（id: slot-progressive）— 規格 docs/05-game-rules/slot-progressive.md
//
// 5×3、20 線（LINES_20），基礎符號同 slot-video 賠付表（主題「金龍」），另加 JACKPOT 符號（每軸 1 停點）。
// 3 個以上 JACKPOT（任意位置）→ 獎金輪盤 Jackpot Wheel（12 格：MINI 6、MINOR 4、MAJOR 1、GRAND 1）。
// 只有最大注（每線 RM 5 × 20 = RM 100）有資格中 GRAND；非最大注時 GRAND 格變 MAJOR，
// 而且獎金按「總注 ÷ RM 100」比例支付（實作決定，見 docs/change-requests/slot-progressive.md）。
// 四級獎池存 LG.store.jackpots['slot-progressive']：種子 20 / 50 / 500 / 10,000，
// 每轉成長 總注 × 0.5% / 0.5% / 0.8% / 1.2%（不論注額都貢獻），中獎後該級回種子。
// RTP 92%（最大注，獎池以種子期望計）。
// ============================================================================
(() => {
  const { ui, money, slots, slotView } = LG;
  const { el, term } = ui;
  const { fmt, round2 } = money;
  const ID = 'slot-progressive';
  const cents = (n) => fmt(n, { cents: true });

  // ---------------------------------------------------------------- 文案
  const T = {
    name: { zh: '四級累積獎金機', en: 'Progressive Jackpot' },
    summary: '3 個 JACKPOT 轉輪盤，四級獎池；GRAND 只給最大注。',
    spin: term('旋轉', 'SPIN'),
    spinning: ['轉動中', 'Spinning'],
    paying: ['派彩', 'Paying out'],
    ready: ['按「旋轉」開始', 'Press SPIN'],
    wheel: ['獎金輪盤！', 'Jackpot Wheel'],
    noMoney: '餘額不足：請調低每線注',
    win: term('贏分', 'WIN'),
    maxOnly: '僅最大注 <i class="en">MAX BET ONLY</i>',
    levels: {
      mini: { zh: '迷你', en: 'MINI' },
      minor: { zh: '小獎', en: 'MINOR' },
      major: { zh: '大獎', en: 'MAJOR' },
      grand: { zh: '頭獎', en: 'GRAND' },
    },
  };

  // ---------------------------------------------------------------- 規則常數
  const LINES = slots.LINES_20;
  const NLINES = LINES.length;
  const LINE_BETS = [0.1, 0.2, 0.5, 1, 2, 5];
  const MAX_BET = NLINES * LINE_BETS[LINE_BETS.length - 1];   // RM 100
  const TRIGGER = 3;
  const SEEDS = { mini: 20, minor: 50, major: 500, grand: 10000 };
  const GROWTH = { mini: 0.005, minor: 0.005, major: 0.008, grand: 0.012 };
  const LEVELS = ['grand', 'major', 'minor', 'mini'];
  /** 輪盤 12 格（順時針，第 0 格在正上方起算） */
  const WHEEL = ['grand', 'mini', 'minor', 'mini', 'minor', 'mini', 'major', 'mini', 'minor', 'mini', 'minor', 'mini'];

  const SYMS = {
    WILD: { zh: '金龍', en: 'WILD', label: '龍', color: '#fff3b0', bg: 'linear-gradient(160deg,#c9302c,#6b0f0c)' },
    PHX: { zh: '鳳凰', en: 'Phoenix', label: '鳳', color: '#c2410c', bg: 'linear-gradient(180deg,#fff4d6,#f5c96a)' },
    LION: { zh: '醒獅', en: 'Lion Dance', label: '獅', color: '#b91c1c', bg: 'linear-gradient(180deg,#fff7df,#f4dc97)' },
    LANT: { zh: '燈籠', en: 'Lantern', label: '燈', color: '#fff', bg: 'linear-gradient(180deg,#e0453a,#a3150f)' },
    KOI: { zh: '錦鯉', en: 'Koi', label: '鯉', color: '#e0621b', bg: 'linear-gradient(180deg,#fffaf0,#f7e3c4)' },
    A: { zh: 'A', en: 'Ace', label: 'A', color: '#9a1b1b' },
    K: { zh: 'K', en: 'King', label: 'K', color: '#1b6d3a' },
    Q: { zh: 'Q', en: 'Queen', label: 'Q', color: '#6b2a8c' },
    J: { zh: 'J', en: 'Jack', label: 'J', color: '#a0521b' },
    T: { zh: '10', en: 'Ten', label: '10', color: '#2a5b9a' },
    N: { zh: '9', en: 'Nine', label: '9', color: '#6b6b6b' },
    JP: {
      zh: 'JACKPOT', en: 'Jackpot', label: 'JACKPOT', bg: 'radial-gradient(circle,#8a1414,#2a0404)',
      svg: '<svg viewBox="0 0 40 40" aria-hidden="true"><circle cx="20" cy="20" r="18.5" fill="none" stroke="#f5c542" stroke-width="2"/><text x="20" y="18" text-anchor="middle" font-size="10" font-weight="900" fill="#ffe38a">JACK</text><text x="20" y="29" text-anchor="middle" font-size="10" font-weight="900" fill="#ffe38a">POT</text></svg>',
    },
  };
  const PAYTABLE = {
    WILD: { 5: 1000 },
    PHX: { 3: 50, 4: 200, 5: 1000 },
    LION: { 3: 25, 4: 100, 5: 400 },
    LANT: { 3: 20, 4: 60, 5: 200 },
    KOI: { 3: 15, 4: 40, 5: 120 },
    A: { 3: 10, 4: 25, 5: 75 },
    K: { 3: 10, 4: 25, 5: 75 },
    Q: { 3: 5, 4: 15, 5: 50 },
    J: { 3: 5, 4: 15, 5: 50 },
    T: { 3: 5, 4: 10, 5: 40 },
    N: { 3: 5, 4: 10, 5: 40 },
  };
  const PAY_ORDER = ['WILD', 'PHX', 'LION', 'LANT', 'KOI', 'A', 'K', 'Q', 'J', 'T', 'N'];

  // ---------------------------------------------------------------- 轉軸帶
  function interleave(items) {
    const list = items.filter(([, c]) => c > 0).map(([u, c]) => ({ u, w: c, cur: 0 }));
    const total = list.reduce((s, x) => s + x.w, 0);
    const out = [];
    for (let k = 0; k < total; k++) {
      let best = null;
      for (const x of list) { x.cur += x.w; if (!best || x.cur > best.cur) best = x; }
      best.cur -= total;
      out.push(best.u);
    }
    return out;
  }
  /** 一軸：{syms:[[符號, 停點數]], jp:JACKPOT 停點數}；JACKPOT 均勻插入（彼此相隔很遠，一軸最多露出 1 個） */
  function buildStrip(spec) {
    const out = interleave(spec.syms);
    const n = spec.jp || 0;
    const F = out.length;
    for (let k = n - 1; k >= 0; k--) out.splice(Math.floor(((k + 0.5) * F) / n), 0, 'JP');
    return out;
  }
  // 各軸停點數（以 exactRTP 精確調到最大注 RTP 92%；見單元測試）
  const MID_SYMS = [['WILD', 4], ['PHX', 2], ['LION', 2], ['LANT', 3], ['KOI', 3], ['A', 3], ['K', 3], ['Q', 3], ['J', 3], ['T', 3], ['N', 3]];
  const OUT_SYMS = [['PHX', 2], ['LION', 3], ['LANT', 4], ['KOI', 3], ['A', 3], ['K', 3], ['Q', 3], ['J', 3], ['T', 3], ['N', 3]];
  // 金龍 WILD 只在第 2–4 軸；每軸 1 個 JACKPOT
  const STRIP_SPEC = [0, 1, 2, 3, 4].map((r) => ({ syms: r >= 1 && r <= 3 ? MID_SYMS : OUT_SYMS, jp: 1 }));
  const STRIPS = STRIP_SPEC.map(buildStrip);
  // 精確值（由 exactRTP 算出、單元測試核對）：非最大注 RTP、最大注平均幾轉中一次 GRAND（觸發 1/142.6 × 1/12）
  const exactNonMax = 0.8664;
  const grandOneIn = 1711;

  // ---------------------------------------------------------------- 純邏輯
  const isMaxBet = (bet) => bet >= MAX_BET - 1e-9;
  /** 輪盤 12 格：非最大注 GRAND 格變 MAJOR */
  const wheelSegments = (isMax) => WHEEL.map((lv) => (lv === 'grand' && !isMax ? 'major' : lv));
  /** 獎金 = 獎池 × min(1, 總注 ÷ RM 100)（最大注拿全額） */
  const payRatio = (bet) => Math.min(1, bet / MAX_BET);
  const jackpotPrize = (level, pools, bet) => round2(pools[level] * payRatio(bet));

  function evalBase(grid, lineBet) {
    const r = slots.evalLines(grid, LINES, PAYTABLE, { wild: 'WILD', scatter: 'JP' });
    return { wins: r.wins, mult: r.total, win: round2(r.total * lineBet) };
  }
  const jpCount = (grid) => slots.countScatter(grid, 'JP');
  const isTrigger = (grid) => jpCount(grid).count >= TRIGGER;

  /** 完整一轉（純邏輯）。pools = 當下獎池；segment 可指定（測試用） */
  function playSpin({ bet, lineBet, pools, grid, segment }) {
    const g = grid || slots.spin(STRIPS, 3);
    const base = evalBase(g, lineBet);
    const jp = jpCount(g);
    let wheel = null;
    if (jp.count >= TRIGGER) {
      const isMax = isMaxBet(bet);
      const segs = wheelSegments(isMax);
      const idx = segment ?? LG.rng.int(0, segs.length - 1);
      const level = segs[idx];
      wheel = { isMax, segs, idx, level, pool: round2(pools[level]), ratio: payRatio(bet), prize: jackpotPrize(level, pools, bet) };
    }
    const win = round2(base.win + (wheel ? wheel.prize : 0));
    return { grid: g, base, jp, wheel, win, bet, lineBet };
  }

  // ---- 累積獎金（LG.store）
  const jackpots = {
    get() {
      const j = (LG.store.peek().jackpots || {})[ID] || {};
      const o = {};
      for (const lv of LEVELS) o[lv] = Number.isFinite(j[lv]) ? j[lv] : SEEDS[lv];
      return o;
    },
    /** 每轉：四級各 +總注 × 成長比例（非最大注也照樣貢獻） */
    grow(bet) {
      LG.store.update((s) => {
        const cur = s.jackpots[ID] || { ...SEEDS };
        const next = {};
        for (const lv of LEVELS) next[lv] = Math.round(((Number(cur[lv]) || SEEDS[lv]) + bet * GROWTH[lv]) * 1e6) / 1e6;
        s.jackpots[ID] = next;
      });
      return jackpots.get();
    },
    claim(level) {
      LG.store.update((s) => { s.jackpots[ID] = { ...jackpots.get(), [level]: SEEDS[level] }; });
      return jackpots.get();
    },
    reset() { LG.store.update((s) => { s.jackpots[ID] = { ...SEEDS }; }); },
  };

  // ---- 精確分析
  /** 輪盤期望獎金（RM；獎池以種子計） */
  function wheelEV(bet = MAX_BET, pools = SEEDS) {
    const segs = wheelSegments(isMaxBet(bet));
    return segs.reduce((s, lv) => s + pools[lv] * payRatio(bet), 0) / segs.length;
  }
  /** 3+ JACKPOT 機率（精確，由轉軸帶） */
  function triggerProb(strips = STRIPS) {
    let dist = [1];
    for (const st of strips) {
      const d = [0, 0, 0, 0];
      for (let i = 0; i < st.length; i++) {
        let c = 0;
        for (let y = 0; y < 3; y++) if (st[(i + y) % st.length] === 'JP') c++;
        d[c] += 1 / st.length;
      }
      const nd = new Array(dist.length + 3).fill(0);
      dist.forEach((a, i) => d.forEach((b, j) => { nd[i + j] += a * b; }));
      dist = nd;
    }
    return dist.slice(TRIGGER).reduce((a, b) => a + b, 0);
  }
  function lineRTP(strips = STRIPS) {
    const freqs = strips.map((st) => {
      const m = {};
      st.forEach((x) => { m[x] = (m[x] || 0) + 1; });
      return Object.entries(m).map(([k, v]) => [k, v / st.length]);
    });
    let ev = 0;
    const g = [];
    const rec = (r, p) => {
      if (r === 5) { ev += p * slots.evalLines(g, [[0, 0, 0, 0, 0]], PAYTABLE, { wild: 'WILD', scatter: 'JP' }).total; return; }
      for (const [x, f] of freqs[r]) { g[r] = [x]; rec(r + 1, p * f); }
    };
    rec(0, 1);
    return ev;
  }
  /** 精確 RTP（獎池種子期望）→ {lines, wheel, total, trigger} */
  function exactRTP({ bet = MAX_BET, strips = STRIPS } = {}) {
    const lines = lineRTP(strips);
    const trigger = triggerProb(strips);
    const wheel = (trigger * wheelEV(bet)) / bet;
    return { lines, wheel, total: lines + wheel, trigger };
  }
  /** simulateRTP 設定：線獎實際模擬；觸發時輪盤以種子期望值計 */
  function rtpConfig({ bet = MAX_BET, strips = STRIPS } = {}) {
    const lineBet = bet / NLINES;
    const ev = wheelEV(bet);
    return {
      bet,
      strips,
      evaluate(grid) {
        return evalBase(grid, 1).mult * lineBet + (isTrigger(grid) ? ev : 0);
      },
    };
  }

  // ---------------------------------------------------------------- 示範盤面
  const DEMO_BASE = [['A', 'PHX', 'K'], ['Q', 'LANT', 'J'], ['KOI', 'T', 'A'], ['K', 'N', 'LION'], ['J', 'Q', 'T']];
  const DEMO_JP_CELLS = [[0, 2], [2, 0], [4, 1], [3, 2]];
  function demoGrid(n) {
    const g = DEMO_BASE.map((c) => c.slice());
    DEMO_JP_CELLS.slice(0, n).forEach(([r, y]) => { g[r][y] = 'JP'; });
    return g;
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: ID,
    category: 'slots',
    order: 4,
    name: T.name,
    summary: T.summary,
    houseEdge: [{ bet: { zh: '總體（最大注，RTP 92%）', en: 'Overall (max bet)' }, edge: 8.0, best: true }],
    limits: { real: { min: 2, max: 100 }, practice: { min: 2, max: 100 } },
    logic: {
      SYMS, PAYTABLE, STRIPS, STRIP_SPEC, LINES, SEEDS, GROWTH, WHEEL, MAX_BET, LINE_BETS, TRIGGER, LEVELS,
      interleave, buildStrip, isMaxBet, wheelSegments, payRatio, jackpotPrize, evalBase, jpCount, isTrigger, playSpin,
      jackpots, wheelEV, triggerProb, lineRTP, exactRTP, rtpConfig, demoGrid,
    },

    create(ctx) {
      const state = { rounds: 0, wheels: 0, busy: false, ready: false, last: null, pending: null, forced: null, forcedSegment: null, paytableOpened: false };
      let root, machine, view, panel, spinBtn, hintEl, winEl, noteEl, jpEls = {}, wheelModal = null, alive = true;

      function buildTable() {
        jpEls = {};
        const plaques = LEVELS.map((lv) => {
          const v = el('b.pg-jp__v', { dataset: { role: `jp-${lv}` } });
          jpEls[lv] = v;
          return el(`div.pg-jp.pg-jp--${lv}`, { dataset: { jp: lv } }, [
            el('span.pg-jp__k', { html: `${T.levels[lv].en} <i class="en">${T.levels[lv].zh}</i>` }), v,
            lv === 'grand' ? el('span.pg-jp__maxonly', { html: T.maxOnly }) : null,
          ]);
        });
        noteEl = el('div.pg-note', { dataset: { role: 'maxnote' } });
        const reels = el('div.pg-reels');
        winEl = el('b.pg-meter__win', { dataset: { role: 'win' }, text: cents(0) });
        machine = el('div.lg-table.pg-machine', [
          el('div.pg-jackpots', plaques),
          noteEl,
          reels,
          el('div.pg-meter', [el('span', { html: `${T.win} ` }), winEl, el('span.pg-meter__sep', { text: '·' }), el('span', { html: `3 個 ${term('JACKPOT', 'Wheel')} → 輪盤` })]),
        ]);
        hintEl = el('div.lg-hint.pg-hint', { hidden: true });
        const actions = el('div.lg-actions.pg-actions');
        const betHost = el('div.pg-bet');
        root.append(machine, hintEl, actions, betHost);

        view = slotView.create(reels, { reels: 5, rows: 3, symbols: SYMS, strips: STRIPS });
        view.setGrid(DEMO_BASE);
        const pt = slotView.paytableButton(actions, { render: renderPaytable });
        pt.addEventListener('click', () => { state.paytableOpened = true; });
        spinBtn = el('button', { type: 'button', class: 'lg-btn lg-btn--primary pg-spin', dataset: { action: 'spin' }, html: T.spin });
        spinBtn.addEventListener('click', () => { doSpin(); });
        actions.appendChild(spinBtn);
        panel = slotView.betPanel(betHost, { lines: [NLINES], lineBets: LINE_BETS, lineBet: 0.1, onChange: () => { paintJackpots(); paintHints(); } });
        paintJackpots();
      }

      function paintJackpots() {
        const j = jackpots.get();
        const bet = panel.bet(), isMax = isMaxBet(bet);
        LEVELS.forEach((lv) => { jpEls[lv].textContent = cents(j[lv]); });
        machine.querySelector('[data-jp="grand"]').classList.toggle('is-inactive', !isMax);
        machine.classList.toggle('is-max', isMax);
        noteEl.innerHTML = isMax
          ? '最大注 <i class="en">MAX BET</i>：四級獎金全額、有 GRAND 資格'
          : `非最大注：沒有 GRAND，獎金只付 ${Math.round(payRatio(bet) * 100)}%（總注 ${cents(bet)} ÷ RM 100）`;
      }
      const setWin = (n) => { winEl.textContent = cents(n); };
      const setBusy = (b) => { state.busy = b; spinBtn.disabled = b || !state.ready; panel.setEnabled(!b); };

      function paintHints() {
        if (!hintEl) return;
        hintEl.hidden = !ctx.hints;
        const bet = panel ? panel.bet() : 2;
        hintEl.innerHTML = isMaxBet(bet)
          ? `提示：最大注每轉 ${cents(bet)}。RM 500 只夠 5 轉——預算不夠最大注，就別玩累積獎金機。`
          : `提示：你每轉仍付總注 3%（${cents(bet * 0.03)}）養獎池，卻沒有 GRAND 資格、獎金只拿 ${Math.round(payRatio(bet) * 100)}%。要玩就最大注，否則換一台。`;
      }

      function renderPaytable() {
        const lb = panel.lineBet(), bet = panel.bet();
        const rows = PAY_ORDER.map((s) => {
          const p = PAYTABLE[s];
          return `<tr><td>${SYMS[s].zh} <i class="en">${SYMS[s].en}</i></td><td>${p[3] ?? '—'}</td><td>${p[4] ?? '—'}</td><td>${p[5] ?? '—'}</td></tr>`;
        }).join('');
        const j = jackpots.get();
        const jpRows = LEVELS.map((lv) => `<tr><td>${T.levels[lv].en} ${T.levels[lv].zh}</td><td>${cents(j[lv])}</td><td>${fmt(SEEDS[lv])}</td><td>${(GROWTH[lv] * 100).toFixed(1)}%</td><td>${WHEEL.filter((x) => x === lv).length}</td></tr>`).join('');
        return `<p>線獎倍數乘<b>每線注</b>（目前 ${cents(lb)}），不是總注。20 條固定線，由左至右連續。金龍 <i class="en">WILD</i> 只在第 2–4 軸。</p>
          <table class="lg-datatable"><thead><tr><th>符號</th><th>3 連</th><th>4 連</th><th>5 連</th></tr></thead><tbody>${rows}</tbody></table>
          <h3>獎金輪盤 <i class="en">Jackpot Wheel</i></h3>
          <ul class="lg-list"><li><b>3 個以上 JACKPOT</b>（任意位置）→ 轉獎金輪盤一次。JACKPOT 本身不賠線。</li>
          <li>輪盤 12 格：MINI 6、MINOR 4、MAJOR 1、GRAND 1。</li>
          <li><b>只有最大注（每線 RM 5 × 20 = RM 100）有 GRAND</b>；非最大注時 GRAND 格變 MAJOR，而且獎金按「總注 ÷ RM 100」比例支付。</li>
          <li>中獎後該級獎池回到種子值。</li></ul>
          <table class="lg-datatable"><thead><tr><th>級別</th><th>目前</th><th>種子</th><th>每轉成長（總注 ×）</th><th>輪盤格數</th></tr></thead><tbody>${jpRows}</tbody></table>
          <p class="lg-muted">獎池成長來自每一轉的總注（合計 3%），不論你押多少都照扣。RTP 92%（最大注，獎池以種子值計），莊家優勢 8%；非最大注約 ${(exactNonMax * 100).toFixed(1)}%。目前總注 ${cents(bet)}。</p>`;
      }

      // ---- 一轉
      async function doSpin() {
        if (state.busy || !state.ready || !alive) return;
        const bet = panel.bet(), lineBet = panel.lineBet();
        if (!ctx.bank.canAfford(bet)) { ui.toast(T.noMoney, { type: 'warn' }); ctx.checkBroke(); return; }
        setBusy(true);
        ctx.bank.debit(bet);
        const pools = jackpots.grow(bet);
        paintJackpots();
        const grid = state.forced || undefined;
        const segment = state.forced ? state.forcedSegment : null;
        state.forced = null; state.forcedSegment = null;
        const out = playSpin({ bet, lineBet, pools, grid, segment });
        state.pending = { win: out.win, claim: out.wheel ? out.wheel.level : null };
        ctx.dealer.say(...T.spinning);
        setWin(0);
        view.reset();
        await view.spin(out.grid);
        if (!alive) return;
        if (out.base.wins.length) {
          out.base.wins.forEach((w) => { view.showLine(LINES[w.line]); view.highlight(w.cells); });
          setWin(out.base.win);
        }
        if (out.wheel) {
          view.highlight(out.jp.cells);
          ctx.dealer.say(...T.wheel);
          await ctx.wait(700);
          if (!alive) return;
          await playWheel(out);
          if (!alive) return;
        } else if (out.base.wins.length) {
          await ctx.wait(300);
          if (!alive) return;
        }
        settle(out);
      }

      /** 輪盤 modal：旋轉 3 秒 → 指針停 → 中獎級別放大 → 按「收下」 */
      function playWheel(out) {
        const w = out.wheel;
        state.wheels += 1;
        return new Promise((resolve) => {
          const n = w.segs.length, deg = 360 / n;
          const colors = { mini: '#2e7d32', minor: '#1565c0', major: '#6a1b9a', grand: '#c62828' };
          const grad = w.segs.map((lv, i) => `${colors[lv]} ${i * deg}deg ${(i + 1) * deg}deg`).join(',');
          const labels = w.segs.map((lv, i) => el('span', {
            class: ['pg-wheel__label', `is-${lv}`, !w.isMax && WHEEL[i] === 'grand' ? 'is-swapped' : null],
            dataset: { seg: i, level: lv },
            style: `transform:translateX(-50%) rotate(${i * deg + deg / 2}deg)`,
          }, [el('b', { text: T.levels[lv].en })]));
          const disc = el('div.pg-wheel__disc', { style: `background:conic-gradient(${grad})` }, labels);
          const result = el('div.pg-wheel__result', { 'aria-live': 'polite', html: w.isMax ? '最大注：有 GRAND 格' : '非最大注：GRAND 格已換成 MAJOR' });
          const body = el('div.pg-wheelwrap', [
            el('div.pg-wheel', [el('div.pg-wheel__pointer', { 'aria-hidden': 'true' }), disc, el('div.pg-wheel__hub', { text: 'JACKPOT' })]),
            result,
          ]);
          let stopped = false;
          wheelModal = ui.modal({
            title: '獎金輪盤 <i class="en">Jackpot Wheel</i>',
            body,
            dismissable: false,
            className: 'pg-wheel-modal',
            actions: [{ id: 'wheel-collect', label: '收下 <i class="en">Collect</i>', primary: true, onClick: () => (stopped ? undefined : false) }],
            onClose: () => { wheelModal = null; resolve(); },
          });
          const btn = wheelModal.el.querySelector('[data-action="wheel-collect"]');
          if (btn) btn.disabled = true;
          const final = 360 * 5 + (360 - (w.idx * deg + deg / 2));
          disc.style.transition = `transform ${LG.ms(3000)}ms cubic-bezier(.12,.7,.2,1)`;
          requestAnimationFrame(() => requestAnimationFrame(() => { disc.style.transform = `rotate(${final}deg)`; }));
          ctx.wait(3000 + 80).then(() => {
            stopped = true;
            const lab = disc.querySelector(`[data-seg="${w.idx}"]`);
            if (lab) lab.classList.add('is-hit');
            body.classList.add('is-done');
            const ratioTxt = w.ratio < 1 ? ` × ${Math.round(w.ratio * 100)}%` : '';
            result.innerHTML = `<b class="pg-wheel__win is-${w.level}">${T.levels[w.level].en} ${T.levels[w.level].zh}</b><span>${cents(w.pool)}${ratioTxt} = <b>${cents(w.prize)}</b></span>`;
            setWin(round2(out.base.win + w.prize));
            if (btn) { btn.disabled = false; try { btn.focus({ preventScroll: true }); } catch { /* */ } }
          });
        });
      }

      function finalize() {
        const p = state.pending;
        if (!p) return null;
        state.pending = null;
        if (p.win > 0) ctx.bank.credit(p.win);
        if (p.claim) jackpots.claim(p.claim);
        return p;
      }

      function settle(out) {
        finalize();
        paintJackpots();
        setWin(out.win);
        const net = round2(out.win - out.bet);
        state.last = { bet: out.bet, win: out.win, net, wheel: out.wheel ? out.wheel.level : null, jp: out.jp.count };
        state.rounds += 1;
        if (out.win > 0) ctx.dealer.say(...T.paying); else ctx.dealer.say(...T.ready);
        ctx.recordRound({ wagered: out.bet, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' });
        ctx.explain(explainOf(out));
        setBusy(false);
        paintHints();
        ctx.checkBroke();
      }

      function explainOf(out) {
        const { bet, lineBet } = out;
        const lineTxt = out.base.wins.map((w) => `第 ${w.lineNo} 線：${SYMS[w.sym].zh} ×${w.count}`);
        const hand = `JACKPOT 符號 ${out.jp.count} 個${out.jp.count >= TRIGGER ? '（觸發輪盤）' : '（需 3 個）'}`
          + (lineTxt.length ? `<br>${lineTxt.join('；')}` : '<br>沒有連線');
        const result = out.win > 0 ? `中獎 <i class="en">WIN</i> ${cents(out.win)}${out.wheel ? `（${T.levels[out.wheel.level].en}）` : ''}` : `未中獎，本次投入 ${cents(bet)}`;
        const f = out.base.wins.map((w) => `第 ${w.lineNo} 線 ${SYMS[w.sym].zh}×${w.count}：${w.mult} × ${cents(lineBet)} = ${cents(w.mult * lineBet)}`);
        if (out.wheel) {
          const w = out.wheel;
          f.push(w.ratio < 1
            ? `輪盤 ${T.levels[w.level].en}：獎池 ${cents(w.pool)} × (${cents(bet)} ÷ RM 100) = ${cents(w.prize)}`
            : `輪盤 ${T.levels[w.level].en}：獎池 ${cents(w.pool)}（最大注全額）`);
        }
        f.push(`總贏 ${cents(out.win)} − 總注 ${cents(bet)} = 淨 <b>${money.fmtSigned(round2(out.win - bet))}</b>`);
        let why;
        if (out.wheel) {
          why = out.wheel.isMax
            ? `3 個以上 JACKPOT 觸發輪盤。最大注有 GRAND 格（12 格中 1 格）。中獎後 ${out.wheel.level.toUpperCase()} 獎池回到種子 ${fmt(SEEDS[out.wheel.level])}。`
            : `3 個以上 JACKPOT 觸發輪盤，但不是最大注：GRAND 格換成 MAJOR，獎金只付 ${Math.round(out.wheel.ratio * 100)}%。你每轉付的 3% 成長照樣進獎池。`;
        } else if (out.base.wins.length) {
          why = `線獎 = 賠付表倍數 × 每線注 ${cents(lineBet)}（不是總注）。JACKPOT 只有 ${out.jp.count} 個，要 3 個才轉輪盤。`;
        } else {
          why = `沒有任何一條線由左起連成 3 個相同符號；JACKPOT ${out.jp.count} 個不到 3 個。每轉總注的 3% 已經進了獎池。`;
        }
        return { hand, result, formula: f.join('<br>'), why };
      }

      const demo = {
        show(n) {
          if (state.busy) return;
          view.reset();
          const g = demoGrid(n);
          view.setGrid(g);
          if (n) view.highlight(jpCount(g).cells);
        },
        /** 下一轉固定出現 3 個 JACKPOT；segment 可指定輪盤格 */
        forceTrigger(segment = null) { state.forced = demoGrid(3); state.forcedSegment = segment; },
        setLineBet(v) { panel.set({ lineBet: v }); },
        showBanner(zh, en) { ctx.dealer.say(zh, en); },
        spin: () => doSpin(),
        /** 教學：把下方元素捲到畫面中間（避免被教學面板蓋住） */
        reveal(sel) {
          ctx.later(() => {
            const x = root && (root.querySelector(sel) || document.querySelector(sel));
            if (x && x.scrollIntoView) x.scrollIntoView({ block: 'center', behavior: 'auto' });
          }, 250);
        },
      };

      function tutorialSteps() {
        return [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：機台畫面',
            body: '<p>上面四塊獎金牌，中間 5 軸 × 3 列轉軸，下面是注額面板與旋轉鍵。</p>',
            highlight: ['.pg-machine'], setup: () => demo.show(0) },
          { id: 'layout-levels', section: 'layout', title: `四級獎金 <i class="en">Progressive jackpot</i>`,
            body: '<p>GRAND、MAJOR、MINOR、MINI 四個獎池。每轉都會從總注抽一點進去，所以一直長。</p>',
            highlight: ['.pg-jackpots'] },
          { id: 'layout-maxonly', section: 'layout', title: `僅最大注 <i class="en">MAX BET ONLY</i>`,
            body: '<p>GRAND 牌半透明、寫著「僅最大注」：現在不是最大注，你<b>沒有資格</b>中 GRAND。</p>',
            highlight: ['[data-jp="grand"]'], setup: () => demo.setLineBet(0.1) },
          { id: 'layout-symbol', section: 'layout', title: 'JACKPOT 符號',
            body: '<p>紅底的 JACKPOT 符號不賠線；<b>3 個以上</b>（任意位置）就轉獎金輪盤。</p>',
            highlight: ['.pg-reels .lg-slot__cell[data-sym="JP"]'], setup: () => demo.show(2) },
          { id: 'layout-paytable', section: 'layout', title: `賠付表 <i class="en">Pay Table</i>`,
            body: '<p>線獎倍數乘<b>每線注</b>。輪盤格數、種子、成長比例也都寫在裡面。</p>',
            highlight: ['.lg-paytable-btn'], setup: () => demo.reveal('.lg-paytable-btn'),
            action: { label: '打開「賠付表 Pay Table」看一下', check: () => state.paytableOpened || '按一下賠付表按鈕' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一轉怎麼進行',
            body: '<p>按旋轉 → 扣總注（其中 3% 進獎池）→ 轉軸停 → 算線獎 → 數 JACKPOT。</p>',
            highlight: ['.pg-spin'] },
          { id: 'flow-spin', section: 'flow', title: `旋轉 <i class="en">SPIN</i>`,
            body: '<p>每按一次扣一次總注，獎金牌同時變大一點點。</p>',
            highlight: ['.pg-spin', '.pg-jackpots'], setup: () => demo.reveal('.pg-spin'),
            action: { label: '按「旋轉 SPIN」轉一次', check: () => state.rounds > 0 || '按下旋轉鍵，等轉軸停下' } },
          { id: 'flow-locked', section: 'flow', title: '轉動中不能改注',
            body: '<p>按下旋轉後這一轉的注額就定了：轉動中不能改注、也不能取消。</p>',
            highlight: ['.lg-betpanel'], setup: () => demo.reveal('.lg-betpanel') },
          { id: 'flow-trigger', section: 'flow', title: '3 個 JACKPOT → 輪盤',
            body: '<p>畫面任意位置出現 3 個以上 JACKPOT，就轉一次獎金輪盤。</p>',
            highlight: ['.pg-reels .lg-slot__cell[data-sym="JP"]'], setup: () => demo.show(3) },
          { id: 'flow-wheel', section: 'flow', title: `獎金輪盤 <i class="en">Jackpot Wheel</i>`,
            body: '<p>12 格：MINI 6、MINOR 4、MAJOR 1、GRAND 1。指針停在哪格就中哪級。非最大注時 GRAND 格變 MAJOR。</p>',
            highlight: ['.pg-jackpots'] },
          { id: 'flow-try', section: 'flow', title: '轉一次輪盤',
            body: '<p>這次已安排 3 個 JACKPOT。看輪盤停下、派彩，再看該級獎池回到種子。</p>',
            highlight: ['.pg-spin', '.pg-machine'],
            setup: () => { if (!state.busy) demo.forceTrigger(); demo.reveal('.pg-spin'); },
            action: { label: '按「旋轉 SPIN」→ 輪盤停後按「收下」', check: () => (state.wheels > 0 && !state.busy) || '按旋轉，等輪盤停下再按收下' } },
          { id: 'flow-reset', section: 'flow', title: '中獎 → 獎池回種子',
            body: '<p>有人中了某一級，那一級就回到種子：MINI RM 20、MINOR RM 50、MAJOR RM 500、GRAND RM 10,000。</p>',
            highlight: ['.pg-jackpots'] },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：獎池的錢從哪來',
            body: '<p>獎池不是賭場送的：是<b>所有人每一轉總注的一部分</b>累積起來。</p>',
            highlight: ['.pg-jackpots'] },
          { id: 'payout-growth', section: 'payout', title: '每轉 3% 進獎池',
            body: '<p>最大注 RM 100 一轉：<br><b>RM 100 × 1.2% = RM 1.20</b> 進 GRAND<br>MINI 0.5% + MINOR 0.5% + MAJOR 0.8% + GRAND 1.2% = 3%。</p>',
            highlight: ['.pg-jackpots'] },
          { id: 'payout-nonmax', section: 'payout', title: '非最大注只拿一部分',
            body: '<p>總注 RM 2 中 MINI（RM 20）：<br><b>RM 20 × (RM 2 ÷ RM 100) = RM 0.40</b><br>但你每轉還是付了 RM 2 × 3% = RM 0.06 給獎池。</p>',
            highlight: ['.pg-note'], setup: () => demo.setLineBet(0.1) },
          { id: 'payout-line', section: 'payout', title: '線獎照賠付表',
            body: '<p>一線 3 個鳳凰 = <b>50 × 每線注</b>。每線 RM 0.10 → 50 × RM 0.10 = RM 5。</p>',
            highlight: ['.lg-paytable-btn'] },
          // ===== strategy
          { id: 'strategy-intro', section: 'strategy', title: '這段你會學到：該不該玩',
            body: `<table class="lg-datatable"><tr><th>注額</th><th>RTP</th><th>莊家優勢</th></tr><tr><td>最大注 RM 100</td><td>92%</td><td>8%</td></tr><tr><td>非最大注</td><td>≈${(exactNonMax * 100).toFixed(1)}%</td><td>≈${(100 - exactNonMax * 100).toFixed(1)}%</td></tr></table>`,
            highlight: null },
          { id: 'strategy-maxbet', section: 'strategy', title: '要玩就一定最大注',
            body: '<p><b>若要玩累積獎金機，就一定要最大注。</b>否則你照樣付成長貢獻，卻沒有 GRAND 資格——等於替別人養獎池。</p>',
            highlight: ['.lg-betpanel__max', '[data-jp="grand"]'], setup: () => demo.reveal('.lg-betpanel'),
            action: { label: '按「MAX BET」打開 GRAND 資格', check: () => panel.isMax() || '按注額面板的 MAX BET' } },
          { id: 'strategy-grand', section: 'strategy', title: 'GRAND 期望值極低',
            body: `<p>最大注平均約 ${grandOneIn.toLocaleString('en-US')} 轉才中一次 GRAND，等於先押約 ${fmt(grandOneIn * MAX_BET)}。獎池再大也不代表「快開了」。</p>`,
            highlight: ['[data-jp="grand"]'] },
          { id: 'strategy-dont', section: 'strategy', title: '該做 / 別做',
            body: '<p>該做：預算撐得住最大注才坐下。<br>別做：押小注玩累積獎金機，或看獎池大就加碼——這只是紀錄，不能預測。</p>',
            highlight: ['.lg-betpanel'], setup: () => demo.reveal('.lg-betpanel') },
          { id: 'strategy-budget', section: 'strategy', title: '預算',
            body: '<p>今晚只帶 RM 500，輸完就走。最大注 RM 100 一轉，RM 500 只夠 5 轉——不夠就別玩這台。</p>',
            highlight: ['.lg-topbar .lg-balance'] },
        ];
      }

      return {
        state,
        demo,
        view: () => view,
        panel: () => panel,
        mount(el0) {
          root = el0;
          root.classList.add('pg-root');
          buildTable();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) {
            ctx.strategyPanel(ui.table([
              ['注額', 'RTP', 'GRAND'], ['最大注 RM 100', '92%', '有'], ['非最大注', `≈${(exactNonMax * 100).toFixed(1)}%`, '沒有'],
            ], { caption: '要玩就最大注，否則換一台' }));
          }
          setBusy(false);
          ctx.ready.then(() => {
            if (!alive) return;
            state.ready = true;
            setBusy(false);
            ctx.dealer.say(...T.ready);
          });
          root.dataset.ready = '1';
        },
        unmount() {
          alive = false;
          finalize();
          if (wheelModal) { const m = wheelModal; wheelModal = null; m.close(); }
          if (view) view.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
