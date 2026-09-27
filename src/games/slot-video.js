// ============================================================================
// 5 軸 20 線影片機（財神 / 龍）id: slot-video — 規格 docs/05-game-rules/slot-video.md
//
// 5×3、20 條固定線（LG.slots.LINES_20）、線由左至右、一線只取最高、倍數乘「每線注」。
// WILD 龍（只出現在軸 2–4）替代所有非 Scatter 符號。SCATTER 金幣任意位置：
//   3 / 4 / 5 個 → 10 / 15 / 20 次免費轉 + 即時獎「總注 × 2」；免費轉中可再觸發（同樣加次數與即時獎）。
//   免費轉沿用觸發時的線數與每線注，不扣款，自動連續轉。
//
// 轉軸帶（最終版；符號代碼 W 龍 / CS 財神 / GI 金元寶 / RP 紅包 / KO 鯉魚 / A K Q J / T=10 / N=9 / SC 金幣）
//   每軸組成：CS2 GI2 RP3 KO3 A3 K3 Q4 J4 T4 N4（軸 3 的 T 為 3、軸 5 的 N 為 3）
//   軸 1（34）：+ SC2            軸 2（38）：+ SC1 W5     軸 3（37）：+ SC1 W5
//   軸 4（38）：+ SC1 W5（軸 2 反序）   軸 5（33）：+ SC2
//   每軸 Scatter 間距 ≥ 3，一個畫面每軸最多 1 個金幣。完整序列見下方 STRIPS。
// 精確 RTP（逐軸符號機率解析計算，含免費轉：RTP = V / (1 − q·m)）= 94.047%
//   線獎 79.20% + 金幣即時獎 2.54% = 單轉 V 81.74%；觸發率 q = 1/78.6；平均給 m = 10.29 次；免費轉貢獻 12.31%。
// simulateRTP（含免費轉期望，LG.rng.seed(123)，500,000 轉）= 93.884%（命中率 45.4%）；每轉標準差約 2.7 倍總注（500k 標準誤 ≈ 0.38%）。
// ============================================================================
(() => {
  const { ui, money } = LG;
  const { el } = ui;
  const { fmt, round2 } = money;
  const cents = (n) => fmt(n, { cents: true });

  // ---------------------------------------------------------------- 文案
  const T = {
    credit: { zh: '餘額', en: 'CREDIT' },
    bet: { zh: '總注', en: 'BET' },
    win: { zh: '贏分', en: 'WIN' },
    spin: 'SPIN 轉',
    lines: '線數 <i class="en">Lines</i>',
    lineBet: '每線注 <i class="en">Bet/Line</i>',
    freeLeft: (n) => `FREE SPINS ${n} LEFT`,
    freeZh: (n, w) => `免費轉剩 ${n} 次 · 已贏 ${cents(w)}`,
    freeStart: (n) => `觸發免費轉 ${n} 次！<i class="en">Free spins</i>`,
    retrigger: (n) => `再觸發！+${n} 次免費轉`,
    noMoney: '餘額不足，降低每線注或線數',
    overMax: (max) => `每轉最高 ${cents(max)}`,
    underMin: (min) => `每轉最低 ${cents(min)}`,
    realIntro: (lim) => `真實模式：每轉 <b>${lim}</b>（固定 20 線），<b>沒有倒數</b>，按 SPIN 就轉，只顯示輸贏金額。`,
    noWin: (bet) => `未中獎，本次投入 ${cents(bet)}`,
  };

  // ---------------------------------------------------------------- 符號、賠付、轉軸帶
  const SYMBOLS = {
    W: { zh: '龍', en: 'WILD', note: '百搭' },
    CS: { zh: '財神', en: 'Fortune God' },
    GI: { zh: '元寶', en: 'Gold Ingot' },
    RP: { zh: '紅包', en: 'Red Packet' },
    KO: { zh: '鯉魚', en: 'Koi' },
    A: { zh: 'A', en: 'A' },
    K: { zh: 'K', en: 'K' },
    Q: { zh: 'Q', en: 'Q' },
    J: { zh: 'J', en: 'J' },
    T: { zh: '10', en: '10' },
    N: { zh: '9', en: '9' },
    SC: { zh: '金幣', en: 'SCATTER', note: '分散' },
  };
  /** 倍數 × 每線注 */
  const PAYTABLE = {
    W: { 5: 1000 },
    CS: { 3: 50, 4: 200, 5: 1000 },
    GI: { 3: 25, 4: 100, 5: 400 },
    RP: { 3: 20, 4: 60, 5: 200 },
    KO: { 3: 15, 4: 40, 5: 120 },
    A: { 3: 10, 4: 25, 5: 75 },
    K: { 3: 10, 4: 25, 5: 75 },
    Q: { 3: 5, 4: 15, 5: 50 },
    J: { 3: 5, 4: 15, 5: 50 },
    T: { 3: 5, 4: 10, 5: 40 },
    N: { 3: 5, 4: 10, 5: 40 },
  };
  const WILD = 'W', SCATTER = 'SC';
  const FREE_SPINS = { 3: 10, 4: 15, 5: 20 };
  const SCATTER_MULT = 2;               // 觸發時即時獎 = 總注 × 2
  const LINE_BETS = [0.1, 0.2, 0.5, 1, 2, 5];
  const LINE_OPTS = [1, 5, 10, 20];
  const LINES = LG.slots.LINES_20;

  const S = (s) => Object.freeze(s.trim().split(/\s+/));
  const R2 = 'SC T A CS Q K GI J T RP N N KO Q W A J W K T W RP CS Q KO GI J T A N N K Q W RP J W KO';
  const STRIPS = Object.freeze([
    S('CS KO GI A Q SC K J RP T T KO Q N A J N CS K GI RP Q SC KO J T A T N K Q RP J N'),
    S(R2),
    S('SC J CS A N GI K Q RP T J KO N W A Q W K J W T CS RP Q GI KO J A N N K W W RP T Q KO'),
    S(R2.split(' ').reverse().join(' ')),
    S('CS KO GI A J SC K Q RP N J KO T T A Q CS K J GI RP N SC KO Q A J T K T RP N Q'),
  ]);

  /**
   * 評一個畫面。
   * @param {string[][]} grid grid[reel][row]
   * @param {number} [nLines=20] 啟用線數（取 LINES_20 前 n 條）
   * @param {number} [lineBet=1]
   * @returns {{wins:Array<{line,lineNo,sym,count,mult,cells,amount}>, lineWin, scatter:{count,cells}, scatterWin, freeSpins, win, bet}}
   */
  function evalSpin(grid, nLines = 20, lineBet = 1) {
    const r = LG.slots.evalLines(grid, LINES.slice(0, nLines), PAYTABLE, { wild: WILD, scatter: SCATTER });
    const sc = LG.slots.countScatter(grid, SCATTER);
    const bet = round2(nLines * lineBet);
    const trig = sc.count >= 3;
    const wins = r.wins.map((w) => ({ ...w, amount: round2(w.mult * lineBet) }));
    const lineWin = round2(wins.reduce((s, w) => s + w.amount, 0));
    const scatterWin = trig ? round2(bet * SCATTER_MULT) : 0;
    return { wins, lineWin, scatter: sc, scatterWin, freeSpins: trig ? FREE_SPINS[Math.min(5, sc.count)] : 0, win: round2(lineWin + scatterWin), bet };
  }

  /** 一次付費轉（含其觸發的所有免費轉）的總贏，以「總注」為單位——給 simulateRTP 用 */
  function spinValue(grid) {
    let r = evalSpin(grid, 20, 1);
    let win = r.win, left = r.freeSpins;
    while (left > 0) {
      left -= 1;
      r = evalSpin(LG.slots.spin(STRIPS, 3), 20, 1);
      win += r.win;
      left += r.freeSpins;
    }
    return win / 20;
  }

  function simulate(spins = 500000, seed = 123) {
    if (seed !== null && seed !== undefined) LG.rng.seed(seed);
    const r = LG.slots.simulateRTP({ strips: STRIPS, rows: 3, evaluate: spinValue, bet: 1 }, spins);
    if (seed !== null && seed !== undefined) LG.rng.seed(null);
    return r;
  }

  /**
   * 精確 RTP（解析）。每條線各格的邊際分布 = 該軸符號頻率，且各軸獨立 → 單線期望可直接算；
   * Scatter 用每軸「視窗內金幣數」分布做卷積。免費轉：RTP = V / (1 − q·m)。需要軸 1 沒有 Wild。
   */
  function exactRTP(strips = STRIPS) {
    if (strips[0].includes(WILD)) throw Error('exactRTP 假設軸 1 沒有 Wild');
    const P = strips.map((s) => { const f = {}; s.forEach((x) => { f[x] = (f[x] || 0) + 1 / s.length; }); return f; });
    const p = (i, s) => P[i][s] || 0;
    let line = 0;
    for (const s of Object.keys(PAYTABLE)) {
      if (s === WILD || !p(0, s)) continue;
      const m = [1, 2, 3, 4].map((i) => p(i, s) + p(i, WILD));
      const pay = PAYTABLE[s];
      line += p(0, s) * (m[0] * m[1] * (1 - m[2]) * (pay[3] || 0)
        + m[0] * m[1] * m[2] * (1 - m[3]) * (pay[4] || 0)
        + m[0] * m[1] * m[2] * m[3] * (pay[5] || 0));
    }
    let dist = [1];
    strips.forEach((s) => {
      const d = [0, 0, 0, 0];
      for (let st = 0; st < s.length; st++) { let k = 0; for (let r = 0; r < 3; r++) if (s[(st + r) % s.length] === SCATTER) k++; d[k] += 1 / s.length; }
      const nd = Array(dist.length + 3).fill(0);
      dist.forEach((v, a) => d.forEach((w, b) => { nd[a + b] += v * w; }));
      dist = nd;
    });
    let q = 0, qm = 0;
    dist.forEach((v, k) => { if (k >= 3) { q += v; qm += v * FREE_SPINS[Math.min(5, k)]; } });
    const scatter = q * SCATTER_MULT;
    const V = line + scatter;
    const rtp = V / (1 - qm);
    return { rtp, line, scatter, V, q, m: qm / q, triggerEvery: 1 / q, free: rtp - V };
  }

  const symName = (s) => SYMBOLS[s].zh;
  const lineColor = (n) => `hsl(${(n * 47) % 360} 85% 60%)`;

  function paytableHtml(lineBet = 0.1) {
    const syms = Object.keys(PAYTABLE).filter((s) => s !== WILD);
    const rows = syms.map((s) => `<tr><td>${symName(s)} <i class="en">${SYMBOLS[s].en === SYMBOLS[s].zh ? '' : SYMBOLS[s].en}</i></td>${[3, 4, 5].map((n) => `<td class="sv-pt__m">${PAYTABLE[s][n]}×</td>`).join('')}</tr>`).join('');
    const mini = LINES.map((ln, i) => `<div class="sv-mini" title="第 ${i + 1} 線"><span class="sv-mini__n" style="color:${lineColor(i + 1)}">${i + 1}</span><div class="sv-mini__g">${[0, 1, 2].map((r) => ln.map((y) => `<i class="${y === r ? 'on' : ''}" style="${y === r ? `background:${lineColor(i + 1)}` : ''}"></i>`).join('')).join('')}</div></div>`).join('');
    return `<div class="sv-pt">
      <p class="sv-pt__key"><b>倍數 × 每線注</b>（不是總注！）。每線注 ${cents(lineBet)} 時，3 個財神 = 50 × ${cents(lineBet)} = <b>${cents(50 * lineBet)}</b>。</p>
      <table class="lg-datatable"><thead><tr><th>符號</th><th>3 連</th><th>4 連</th><th>5 連</th></tr></thead><tbody>${rows}</tbody></table>
      <ul class="lg-list">
        <li><b>WILD 龍</b> 百搭 <i class="en">Wild</i>：只出現在第 2–4 軸，替代所有符號（金幣除外）。5 連龍 1000× 是賠付表上的數字，但因為第 1、5 軸沒有龍，實際不會出現。</li>
        <li><b>SCATTER 金幣</b> 分散符號 <i class="en">Scatter</i>：任意位置 3 / 4 / 5 個 → <b>10 / 15 / 20 次免費轉 <i class="en">Free spins</i></b>，並即時贏「總注 × 2」。免費轉中可再觸發。金幣不算線。</li>
        <li>線由<b>最左邊第 1 軸</b>開始連續 3 個以上才算；一條線只算最高的一種；多條線中獎就加總。</li>
        <li>RTP <i class="en">Return to Player</i> 94%（其中約 12% 來自免費轉）。</li>
      </ul>
      <h3>20 條線 <i class="en">Paylines</i></h3><div class="sv-minis">${mini}</div></div>`;
  }

  // ---------------------------------------------------------------- 註冊
  LG.registerGame({
    id: 'slot-video',
    category: 'slots',
    order: 2,
    name: { zh: '5 軸 20 線影片機', en: 'Video Slot 5×3 · 20 Lines' },
    summary: '財神與龍：20 條線、百搭、金幣免費轉——現代老虎機的標準配備。',
    houseEdge: [{ bet: { zh: '總體', en: 'Overall' }, edge: 6.0, best: true }],
    limits: { real: { min: 2, max: 100 }, practice: { min: 0.1, max: 100 } },
    logic: { STRIPS, SYMBOLS, PAYTABLE, FREE_SPINS, SCATTER_MULT, LINE_BETS, LINE_OPTS, WILD, SCATTER, evalSpin, spinValue, simulate, exactRTP },

    create(ctx) {
      const state = {
        phase: 'idle', staked: 0, spins: 0, freeSpinsPlayed: 0, free: null, shownLine: null, paytableOpened: false,
        wagered: 0, won: 0, lastResult: null,
      };
      let root, view, panel, spinB, freeEl, hintEl, meters = {}, labels = {}, winAnim = 0;
      let ready = !ctx.isReal;
      const exact = exactRTP();

      const symView = Object.fromEntries(Object.entries(SYMBOLS).map(([k, s]) => [k, {
        label: s.zh,
        svg: `<span class="sv-s sv-s--${k}"><b>${s.zh}</b>${k === WILD || k === SCATTER ? `<small>${s.en}</small>` : ''}</span>`,
      }]));

      function meter(key, t) {
        const v = el('b.sv-meter__v', { dataset: { role: key } });
        meters[key] = v;
        return el('div', { class: ['sv-meter', `sv-meter--${key}`] }, [el('span.sv-meter__k', { html: `${t.en} <i class="en">${t.zh}</i>` }), v]);
      }

      function labelCol(side) {
        const col = el('div', { class: ['sv-linenos', `sv-linenos--${side}`] });
        const rows = [0, 1, 2].map(() => el('div.sv-linenos__row'));
        rows.forEach((r) => col.appendChild(r));
        for (let n = side === 'l' ? 1 : 11; n <= (side === 'l' ? 10 : 20); n++) {
          const row = LINES[n - 1][side === 'l' ? 0 : 4];
          const b = el('button', { type: 'button', class: 'sv-lineno', dataset: { line: n }, 'aria-label': `第 ${n} 線`, style: `--c:${lineColor(n)}`, text: String(n) });
          b.addEventListener('click', () => toggleLine(n));
          labels[n] = b;
          rows[row].appendChild(b);
        }
        return col;
      }

      function build() {
        freeEl = el('div.sv-free', { 'aria-live': 'polite' }, [el('b.sv-free__en'), el('span.sv-free__zh')]);
        const head = el('div.sv-head', [el('div.sv-logo', { html: '財神到 <i class="en">FORTUNE DRAGON</i>' })]);
        const legend = el('div.sv-legend', [
          el('span.sv-legend__i', { dataset: { sym: 'W' }, html: `${symView.W.svg}<em>百搭 <i class="en">Wild</i>・軸 2–4</em>` }),
          el('span.sv-legend__i', { dataset: { sym: 'SC' }, html: `${symView.SC.svg}<em>分散 <i class="en">Scatter</i>・3 個免費轉</em>` }),
        ]);
        const reels = el('div.sv-reels');
        const board = el('div.sv-board', [labelCol('l'), reels, labelCol('r')]);
        const meterRow = el('div.sv-meters', [meter('credit', T.credit), meter('bet', T.bet), meter('win', T.win)]);
        const machine = el('div.sv-machine', [head, freeEl, legend, board, meterRow]);
        const ctrl = el('div.sv-controls');
        spinB = el('button', { type: 'button', class: 'lg-btn lg-btn--primary sv-spin', dataset: { action: 'spin' }, html: T.spin });
        hintEl = el('div.lg-hint.sv-hint', { hidden: true });
        root.append(machine, ctrl, el('div.sv-spinrow', [spinB]), hintEl);

        view = LG.slotView.create(reels, { reels: 5, rows: 3, symbols: symView, strips: STRIPS });
        view.setGrid(LG.slots.gridAt(STRIPS, [3, 8, 14, 20, 26]));
        const pb = LG.slotView.paytableButton(head, { render: () => paytableHtml(panel ? panel.lineBet() : 0.1) });
        pb.addEventListener('click', () => { state.paytableOpened = true; });
        panel = LG.slotView.betPanel(ctrl, {
          lines: ctx.isReal ? [20] : LINE_OPTS, lineBets: LINE_BETS, linesLabel: T.lines, lineBetLabel: T.lineBet,
          onChange: () => { paintMeters(); paintSpin(); paintLabels(); },
        });
        panel.el.children[0].classList.add('sv-linebet');
        panel.el.children[1].classList.add('sv-lines');
        spinB.addEventListener('click', () => { spinPaid(); });
        ctx.on('bank:change', () => { paintMeters(); paintSpin(); });
        paintMeters(); setWin(0); paintSpin(); paintLabels(); paintFree();
      }

      // ---- 畫面更新
      function paintMeters() {
        if (!meters.credit) return;
        meters.credit.textContent = cents(ctx.bank.balance());
        meters.bet.textContent = cents(state.free ? state.free.bet : panel.bet());
      }
      function setWin(n) { if (meters.win) { meters.win.textContent = cents(n); meters.win.dataset.win = String(n); } }
      function rollWin(from, to) {
        cancelAnimationFrame(winAnim);
        const dur = LG.ms(to > from ? 600 : 0);
        if (!dur || typeof requestAnimationFrame !== 'function') { setWin(to); return; }
        const t0 = performance.now();
        const step = (t) => {
          if (!ctx.alive()) return;
          const k = Math.min(1, (t - t0) / dur);
          setWin(k >= 1 ? to : round2(from + (to - from) * k));
          if (k < 1) winAnim = requestAnimationFrame(step);
        };
        winAnim = requestAnimationFrame(step);
      }
      const canSpin = () => ready && state.phase === 'idle' && ctx.bank.canAfford(panel.bet());
      function paintSpin() {
        if (!spinB) return;
        spinB.disabled = !canSpin();
        // 餘額付不起目前押注：SPIN 灰掉 + 提示一次（恢復可付後重置）
        const broke = ready && state.phase === 'idle' && !ctx.bank.canAfford(panel.bet());
        if (broke && !state.warnedAfford) ui.toast(T.noMoney, { type: 'warn' });
        state.warnedAfford = broke;
        spinB.classList.toggle('is-spinning', state.phase !== 'idle');
        if (panel) panel.setEnabled(state.phase === 'idle');
      }
      function paintLabels() {
        const n = state.free ? state.free.lines : panel.lines();
        Object.entries(labels).forEach(([k, b]) => b.classList.toggle('is-off', Number(k) > n));
      }
      function paintFree(demoN) {
        if (!freeEl) return;
        const f = state.free;
        const n = f ? f.left : demoN;
        const on = n !== undefined && n !== null;
        freeEl.hidden = !on;
        root.classList.toggle('is-free', on);
        if (on) {
          freeEl.firstChild.textContent = T.freeLeft(n);
          freeEl.lastChild.textContent = T.freeZh(n, f ? f.win : 0);
        }
      }
      function paintHints() {
        if (!hintEl) return;
        hintEl.hidden = !ctx.hints;
        const ret = state.wagered ? `本次已押 ${cents(state.wagered)}，拿回 ${cents(state.won)}（${((state.won / state.wagered) * 100).toFixed(1)}%）。` : '';
        hintEl.textContent = `提示：RTP 94%。免費轉平均每 ${Math.round(exact.triggerEvery)} 轉觸發一次，它的獎金本來就算在 94% 裡面，不是額外賺的。${ret}短期亂跳，沒有「快出了」。`;
      }

      /** 點線號：顯示該線路徑（再點一次收起） */
      function toggleLine(n) {
        if (state.phase !== 'idle') return;
        const same = state.shownLine === n;
        view.clear();
        Object.values(labels).forEach((b) => b.classList.remove('is-on', 'is-win'));
        if (same) { state.shownLine = null; return; }
        state.shownLine = n;
        view.showLine(LINES[n - 1], { color: lineColor(n) });
        labels[n].classList.add('is-on');
      }

      function showResult(r) {
        view.clear();
        Object.values(labels).forEach((b) => b.classList.remove('is-on', 'is-win'));
        state.shownLine = null;
        const cells = [];
        r.wins.forEach((w) => {
          view.showLine(LINES[w.line], { color: lineColor(w.lineNo) });
          labels[w.lineNo].classList.add('is-win');
          cells.push(...w.cells);
        });
        if (r.freeSpins) cells.push(...r.scatter.cells);
        if (cells.length) view.highlight(cells);
      }

      // ---- 一轉
      async function doSpin(nLines, lineBet) {
        const grid = LG.slots.spin(STRIPS, 3);
        const r = evalSpin(grid, nLines, lineBet);
        r.grid = grid;
        await view.spin(grid);
        if (ctx.alive()) showResult(r);
        return r;
      }

      async function spinPaid() {
        if (state.phase !== 'idle' || !ready) return;
        const nLines = panel.lines(), lineBet = panel.lineBet(), bet = panel.bet();
        if (bet < ctx.limits.min - 1e-9) { ui.toast(T.underMin(ctx.limits.min), { type: 'warn' }); return; }
        if (bet > ctx.limits.max + 1e-9) { ui.toast(T.overMax(ctx.limits.max), { type: 'warn' }); return; }
        if (!ctx.bank.canAfford(bet)) { ui.toast(T.noMoney, { type: 'warn' }); paintSpin(); return; }
        state.phase = 'spinning';
        ctx.bank.debit(bet);
        state.staked = bet;
        setWin(0);
        paintSpin();
        const r = await doSpin(nLines, lineBet);
        if (!ctx.alive()) return;
        if (r.win > 0) ctx.bank.credit(r.win);
        state.staked = 0;
        state.spins += 1;
        state.lastResult = r;
        const net = round2(r.win - bet);
        ctx.recordRound({ wagered: bet, net, outcome: net > 0 ? 'win' : net < 0 ? 'lose' : 'push' });
        rollWin(0, r.win);
        let fs = null;
        if (r.freeSpins) {
          state.phase = 'free';
          paintSpin();
          fs = await runFree(r.freeSpins, nLines, lineBet, bet, r.win);
          if (!ctx.alive() || !fs) return;
        }
        const total = round2(r.win + (fs ? fs.win : 0));
        state.wagered = round2(state.wagered + bet);
        state.won = round2(state.won + total);
        explain(r, fs, bet, nLines, lineBet, round2(total - bet));
        state.phase = 'idle';
        paintSpin();
        paintHints();
        ctx.checkBroke();
      }

      async function runFree(n, nLines, lineBet, bet, baseWin) {
        state.free = { left: n, total: n, win: 0, spins: 0, retriggers: 0, lines: nLines, lineBet, bet, best: null };
        paintFree(); paintMeters(); paintLabels();
        ui.toast(T.freeStart(n));
        await ctx.wait(900);
        while (state.free.left > 0) {
          if (!ctx.alive()) return null;
          state.free.left -= 1;
          state.free.spins += 1;
          paintFree();
          const r = await doSpin(nLines, lineBet);
          if (!ctx.alive()) return null;
          const f = state.free;
          if (r.win > 0) ctx.bank.credit(r.win);
          const before = round2(baseWin + f.win);
          f.win = round2(f.win + r.win);
          if (!f.best || r.win > f.best.win) f.best = r;
          state.freeSpinsPlayed += 1;
          ctx.recordRound({ wagered: 0, net: r.win, outcome: r.win > 0 ? 'win' : 'push' });
          rollWin(before, round2(baseWin + f.win));
          if (r.freeSpins) {
            f.left += r.freeSpins; f.total += r.freeSpins; f.retriggers += 1;
            ui.toast(T.retrigger(r.freeSpins));
          }
          paintFree();
          await ctx.wait(r.win > 0 ? 900 : 450);
        }
        const done = state.free;
        state.free = null;
        paintFree(); paintMeters(); paintLabels();
        return done;
      }

      function winLine(w, lineBet) {
        const name = w.sym === WILD ? 'WILD 龍' : symName(w.sym);
        const wilds = w.cells.filter(([rr, yy]) => state.lastGrid && state.lastGrid[rr][yy] === WILD).length;
        return `第 ${w.lineNo} 線 ${name} ×${w.count}${wilds ? `（含 ${wilds} 個龍）` : ''}：${w.mult} × ${cents(lineBet)} = ${cents(w.amount)}`;
      }

      function explain(r, fs, bet, nLines, lineBet, net) {
        state.lastGrid = r.grid;
        const parts = r.wins.map((w) => winLine(w, lineBet));
        if (r.scatterWin) parts.push(`金幣 ×${r.scatter.count}：總注 ${cents(bet)} × ${SCATTER_MULT} = ${cents(r.scatterWin)}（即時獎）`);
        if (fs) parts.push(`免費轉 ${fs.spins} 次${fs.retriggers ? `（再觸發 ${fs.retriggers} 次）` : ''}：共贏 ${cents(fs.win)}（不扣注）`);
        const total = round2(r.win + (fs ? fs.win : 0));
        const betText = `${nLines} 線 × ${cents(lineBet)} = ${cents(bet)}`;
        const hand = r.wins.length || r.scatter.count
          ? [r.wins.length ? `中獎線：${r.wins.map((w) => `<b>${w.lineNo}</b>`).join('、')}` : '', r.scatter.count ? `金幣 ${r.scatter.count} 個` : ''].filter(Boolean).join('；')
          : `${nLines} 條線都沒有從第 1 軸連 3 個以上`;
        let result;
        if (fs) result = `觸發免費轉 <i class="en">Free spins</i> ${fs.total} 次，總贏 <b>${cents(total)}</b>`;
        else if (total > 0) result = `中 ${r.wins.length} 線${r.scatterWin ? ' + 金幣' : ''}，總贏 <b>${cents(total)}</b>`;
        else result = '未中獎 <i class="en">No win</i>';
        const formula = total > 0
          ? `${parts.join('<br>')}<br>總贏 ${cents(total)} − 總注 ${cents(bet)}（${betText}）= 淨 <b>${money.fmtSigned(net)}</b>`
          : `${T.noWin(bet)}（${betText}）<br>淨 <b>${money.fmtSigned(net)}</b>`;
        let why;
        if (fs) why = `3 個以上金幣出現在任意位置就觸發，不用在線上。免費轉用同一組線與每線注自動轉，不扣錢；它的獎金本來就算在 RTP 94% 裡。`;
        else if (r.wins.length) why = `倍數乘的是<b>每線注</b>（${cents(lineBet)}），不是總注。線要從最左邊第 1 軸開始連續；龍可以替代其他符號。${r.wins.length > 1 ? '多條線同時中就加總。' : ''}${net < 0 ? '贏分少於總注，所以淨額還是輸——燈亮不等於賺。' : ''}`;
        else if (r.scatter.count) why = `金幣只有 ${r.scatter.count} 個，要 3 個才觸發免費轉。每一轉都是獨立的，沒有「快出了」。`;
        else why = '這一轉沒有任何線從第 1 軸連 3 個以上。每一轉都是獨立的，上一轉輸了不會讓下一轉更容易中。';
        ctx.explain({ net, hand, result, formula, why });
      }

      // ---- 教學示範
      const demo = {
        /** rows = [上列, 中列, 下列]，每列 5 個符號代碼（空白分隔） */
        setGrid(rows, nLines = 20, lineBet = 0.1) {
          if (state.phase !== 'idle') return;
          const R = rows.map((x) => x.trim().split(/\s+/));
          const grid = [0, 1, 2, 3, 4].map((c) => [R[0][c], R[1][c], R[2][c]]);
          view.reset();
          view.setGrid(grid);
          const r = evalSpin(grid, nLines, lineBet);
          showResult(r);
          return r;
        },
        showFree(n) { if (!state.free) paintFree(n); },
        clear() {
          if (!view || state.phase !== 'idle') return;
          view.clear();
          Object.values(labels).forEach((b) => b.classList.remove('is-on', 'is-win'));
          state.shownLine = null;
          if (!state.free) paintFree();
        },
      };
      const G_CS3 = ['A K Q J T', 'CS CS CS N Q', 'KO RP J A N'];
      const G_TWO = ['A A A K Q', 'CS CS CS N Q', 'KO RP J T N'];
      const G_WILD = ['Q N K J T', 'GI W GI A Q', 'KO RP J T N'];
      const G_SC = ['SC K Q N T', 'A J SC Q K', 'KO RP J A SC'];

      function tutorialSteps() {
        const steps = [
          // ===== layout
          { id: 'layout-intro', section: 'layout', title: '這段你會學到：5 軸 20 線',
            body: '<p>5 個轉軸 × 3 列，有 20 條<b>賠付線 <i class="en">Paylines</i></b>。先看懂畫面，再轉。</p>',
            highlight: ['.sv-machine'] },
          { id: 'layout-lines', section: 'layout', title: `賠付線 <i class="en">Payline</i>`,
            body: '<p>兩側數字是線號。點一下就會畫出那條線怎麼走——不一定是直線。</p>',
            highlight: ['.sv-lineno[data-line="4"]', '.sv-reels'],
            action: { label: '點線號「4」看它的路徑（V 字形）', check: () => state.shownLine === 4 || '點左上方的「4」' } },
          { id: 'layout-linebet', section: 'layout', title: `每線注 <i class="en">Bet per line</i>`,
            body: '<p>每一條線押多少：RM 0.10 到 RM 5。<b>賠付表的倍數就是乘這個數</b>。</p>',
            highlight: ['.sv-linebet'] },
          { id: 'layout-total', section: 'layout', title: `總注 <i class="en">Total bet</i>`,
            body: '<p>總注 = 線數 × 每線注。例：20 × RM 0.10 = <b>RM 2.00</b>，每轉從餘額扣這麼多。</p>',
            highlight: ['.sv-lines', '.lg-betpanel__total'] },
          { id: 'layout-wild', section: 'layout', title: `百搭 <i class="en">Wild</i>：龍`,
            body: '<p>龍只出現在第 2–4 軸，可以<b>替代任何符號</b>（金幣除外）幫你連線。</p>',
            highlight: ['.sv-legend [data-sym="W"]'] },
          { id: 'layout-scatter', section: 'layout', title: `分散符號 <i class="en">Scatter</i>：金幣`,
            body: '<p>金幣不用在線上：<b>任意位置 3 個</b>就觸發免費轉。</p>',
            highlight: ['.sv-legend [data-sym="SC"]'] },
          { id: 'layout-paytable', section: 'layout', title: `怎麼讀賠付表 <i class="en">Pay Table</i>`,
            body: '<p>表上「50×」是 <b>× 每線注</b>，不是 × 總注！先打開看一次。</p>',
            highlight: ['[data-action="paytable"]'],
            action: { label: '按「賠付表 Pay Table」', check: () => state.paytableOpened || '按上方的「賠付表」' } },
          // ===== flow
          { id: 'flow-intro', section: 'flow', title: '這段你會學到：一轉的流程',
            body: '<p>SPIN → 五軸依序停 → 中獎線亮起 → 贏分加總進餘額。沒有荷官、沒有倒數。</p>',
            highlight: ['.sv-spinrow'] },
          { id: 'flow-spin', section: 'flow', title: `轉 <i class="en">SPIN</i>`,
            body: '<p>按 SPIN，總注立刻從 CREDIT 扣掉。</p>',
            highlight: ['[data-action="spin"]', '.sv-meters'],
            action: { label: '按「SPIN 轉」轉一次', check: () => state.spins > 0 || '按下方的 SPIN 轉' } },
          { id: 'flow-lines', section: 'flow', title: '停輪後線路亮起',
            body: '<p>中獎的線會畫出來、兩側線號發亮，中獎格會閃。</p>',
            highlight: ['.sv-board'], setup: () => demo.setGrid(G_TWO) },
          { id: 'flow-sum', section: 'flow', title: '贏分加總',
            body: '<p>所有中獎線的贏分<b>加起來</b>顯示在 WIN，再自動加進 CREDIT。</p>',
            highlight: ['.sv-meters'] },
          { id: 'flow-free', section: 'flow', title: `免費轉 <i class="en">Free spins</i> 怎麼觸發`,
            body: '<p>3 / 4 / 5 個金幣 → 10 / 15 / 20 次。背景變色、顯示剩餘次數，機器<b>自動連轉</b>，不扣錢。</p>',
            highlight: ['.sv-free', '.sv-reels'], setup: () => { demo.setGrid(G_SC); demo.showFree(10); } },
          // ===== payout
          { id: 'payout-intro', section: 'payout', title: '這段你會學到：怎麼算贏多少',
            body: '<p>一條線贏 = <b>倍數 × 每線注</b>；全部中獎線加起來才是這轉贏分。</p>',
            highlight: ['[data-action="paytable"]'] },
          { id: 'payout-one', section: 'payout', title: '一條線的例子',
            body: '<p>每線 RM 0.10，第 1 線 3 個財神：<br><b>50 × RM 0.10 = RM 5.00</b>。<br>總注 RM 2.00 → 淨贏 RM 3.00。</p>',
            highlight: ['.sv-reels', '.sv-lineno[data-line="1"]'], setup: () => demo.setGrid(G_CS3) },
          { id: 'payout-two', section: 'payout', title: '兩條線同時中（財神 + A）',
            body: '<p>線 1：50 × RM 0.10 = RM 5.00<br>線 2：10 × RM 0.10 = RM 1.00<br>加總 <b>RM 6.00</b>（淨贏 RM 4.00）。</p>',
            highlight: ['.sv-reels', '.sv-lineno[data-line="1"]', '.sv-lineno[data-line="2"]'], setup: () => demo.setGrid(G_TWO) },
          { id: 'payout-wild', section: 'payout', title: '龍幫忙連線',
            body: '<p>中線 元寶・龍・元寶 = 3 個元寶：<br><b>25 × RM 0.10 = RM 2.50</b>。龍不會另外賠。</p>',
            highlight: ['.sv-reels'], setup: () => demo.setGrid(G_WILD) },
          // ===== strategy
          { id: 'strategy-rtp', section: 'strategy', title: `RTP 是什麼 <i class="en">Return to Player</i>`,
            body: '<table class="lg-datatable"><tr><th>RTP</th><th>莊家優勢</th></tr><tr><td>94%</td><td>6%</td></tr></table><p>每押 RM 100，長期平均拿回 RM 94。</p>',
            highlight: null, setup: () => demo.clear() },
          { id: 'strategy-volatility', section: 'strategy', title: `波動 <i class="en">Volatility</i>`,
            body: '<p>大多數轉是小輸，偶爾一次大獎。短期結果亂跳，<b>只有長期才接近 94%</b>。</p>',
            highlight: ['.sv-meters'] },
          { id: 'strategy-free', section: 'strategy', title: '免費轉不是「賺」',
            body: `<p>免費轉約佔 RTP 的 ${Math.round((exact.free / exact.rtp) * 100)}%，本來就算在 94% 裡。它是「延後發的獎金」，不是送你的錢。</p>`,
            highlight: ['.sv-legend [data-sym="SC"]'] },
          { id: 'strategy-size', section: 'strategy', title: '押大不改變比例',
            body: '<p>總注 RM 2 平均每轉輸 RM 0.12；總注 RM 100 平均輸 RM 6。<b>都是 6%</b>，押大只是輸得快。</p>',
            highlight: ['.lg-betpanel'] },
          { id: 'strategy-due', section: 'strategy', title: '沒有「快出了」',
            body: '<p>很久沒開免費轉，下一轉的機率還是一樣。<b>這只是紀錄，不能預測</b>。</p>',
            highlight: ['.sv-reels'] },
          { id: 'strategy-dont', section: 'strategy', title: '別押：追損',
            body: '<p>輸了就加大每線注想翻本？損失只會來得更快。別追損 <i class="en">Don\'t chase losses</i>。</p>',
            highlight: ['.sv-linebet'] },
          { id: 'strategy-budget', section: 'strategy', title: '該押：小注＋預算',
            body: '<p>用最小每線注慢慢玩。今晚只帶 RM 500，輸完就走。</p>',
            highlight: ['.sv-meter--credit'] },
        ];
        // 每步先清掉上一步的示範畫面（demo.clear 不會影響進行中的真實轉動/免費轉）
        return steps.map((s) => ({ ...s, setup: (inst) => { demo.clear(); if (s.setup) s.setup(inst); } }));
      }

      return {
        state,
        demo,
        panel: () => panel,
        view: () => view,
        spin: spinPaid,
        mount(el0) {
          root = el0;
          root.classList.add('sv-root');
          build();
          paintHints();
          ctx.on('hints:change', paintHints);
          if (ctx.isPractice) {
            ctx.strategyPanel(ui.table([
              ['來源', '佔 RTP'],
              ['線獎 <i class="en">Line wins</i>', `${(exact.line * 100).toFixed(1)}%`],
              ['金幣即時獎', `${(exact.scatter * 100).toFixed(1)}%`],
              ['免費轉 <i class="en">Free spins</i>', `${(exact.free * 100).toFixed(1)}%`],
              ['合計 RTP', `${(exact.rtp * 100).toFixed(1)}%`],
            ], { caption: `免費轉平均每 ${Math.round(exact.triggerEvery)} 轉觸發一次` }));
          }
          if (ctx.isReal) {
            Promise.resolve().then(() => {
              const b = document.querySelector('[data-action="real-start"]');
              const p = b && b.closest('.lg-modal') && b.closest('.lg-modal').querySelector('.lg-modal__body p');
              if (p) p.innerHTML = T.realIntro(`${cents(ctx.limits.min)} – ${cents(ctx.limits.max)}`);
            });
            ctx.ready.then(() => { ready = true; paintSpin(); });
          }
          root.dataset.ready = '1';
        },
        unmount() {
          cancelAnimationFrame(winAnim);
          if (state.staked > 0) { ctx.bank.credit(state.staked); state.staked = 0; }
          if (view) view.destroy();
        },
        tutorialSteps,
      };
    },
  });
})();
