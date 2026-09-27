// LG.slotView — 老虎機轉軸畫面（rAF 滾動動畫、逐軸停）、賠付表按鈕、下注面板。
// 見 docs/02-architecture.md §3.3。網格座標一律 grid[reel][row]，cell = [reel,row] 或 {reel,row}。
(() => {
  const LG = globalThis.LG;
  const ui = LG.ui;
  const { el } = ui;
  const { round2, fmt } = LG.money;

  const reduced = () => !!(LG.reducedMotion
    || (globalThis.matchMedia && globalThis.matchMedia('(prefers-reduced-motion: reduce)').matches));
  const cellRC = (c) => (Array.isArray(c) ? [c[0], c[1]] : [c.reel ?? c.r ?? c.x, c.row ?? c.y]);

  /**
   * @param {Element} container
   * @param {{reels?:number, rows?:number, symbols?:Object<string,{label?:string,color?:string,bg?:string,emoji?:string,svg?:string}>,
   *          strips?:string[][], spinMs?:number, stepMs?:number}} o
   */
  function create(container, o = {}) {
    const reels = o.reels ?? 5, rows = o.rows ?? 3;
    const symbols = o.symbols || {};
    let strips = o.strips || null;
    const spinMs = o.spinMs ?? 700, stepMs = o.stepMs ?? 150;
    const symKeys = Object.keys(symbols);
    const randSym = (r) => {
      const s = strips && strips[r] && strips[r].length ? strips[r] : symKeys;
      return s.length ? LG.rng.pick(s) : '?';
    };

    const root = el('div.lg-slot', { style: `--reels:${reels};--rows:${rows}` });
    const gridEl = el('div.lg-slot__grid');
    const svg = el('svg', { class: 'lg-slot__lines', viewBox: `0 0 ${reels} ${rows}`, preserveAspectRatio: 'none', 'aria-hidden': 'true' });
    const cells = [];
    for (let r = 0; r < reels; r++) {
      const col = el('div.lg-reel', { dataset: { reel: r } });
      cells[r] = [];
      for (let y = 0; y < rows; y++) {
        const inner = el('div.lg-slot__sym');
        const c = el('div.lg-slot__cell', { dataset: { reel: r, row: y } }, [inner]);
        col.appendChild(c);
        cells[r][y] = { el: c, inner, sym: null, locked: false, value: null };
      }
      gridEl.appendChild(col);
    }
    root.append(gridEl, svg);
    container.appendChild(root);

    function paintSym(cell, sym) {
      cell.sym = sym;
      const s = symbols[sym] || { label: sym };
      cell.inner.dataset.sym = sym;
      cell.el.dataset.sym = sym;
      if (s.svg) cell.inner.innerHTML = s.svg;
      else cell.inner.textContent = s.emoji || s.label || sym;
      cell.inner.classList.toggle('is-long', !s.svg && !s.emoji && String(s.label || sym).length > 2);
      cell.inner.style.color = s.color || '';
      cell.el.style.background = s.bg || '';
      cell.el.setAttribute('aria-label', s.label || sym);
    }
    function setGrid(grid) {
      for (let r = 0; r < reels; r++) for (let y = 0; y < rows; y++) {
        const s = grid && grid[r] ? grid[r][y] : undefined;
        if (s !== undefined) paintSym(cells[r][y], s);
      }
    }
    // 初始畫面
    for (let r = 0; r < reels; r++) for (let y = 0; y < rows; y++) paintSym(cells[r][y], randSym(r));

    let spinning = null;
    /**
     * 轉動到 targetGrid。每軸比前一軸晚 stepMs（×LG.speed）停下。鎖定格不轉。
     * @returns {Promise<void>}
     */
    function spin(target) {
      if (spinning) spinning.finish();
      clear();
      root.classList.add('is-spinning');
      return new Promise((resolve) => {
        const base = LG.ms(spinMs), step = LG.ms(stepMs);
        const state = Array.from({ length: reels }, (_, r) => ({ stopAt: base + r * step, stopped: false, off: 0 }));
        let t0 = 0, raf = 0, guard = 0, done = false;
        const stopReel = (r) => {
          const st = state[r];
          if (st.stopped) return;
          st.stopped = true;
          for (let y = 0; y < rows; y++) {
            const c = cells[r][y];
            if (c.locked) continue;
            c.inner.style.transform = '';
            c.el.classList.remove('is-blur');
            paintSym(c, target && target[r] ? target[r][y] : c.sym);
          }
          const col = gridEl.children[r];
          if (col) { col.classList.remove('is-stop'); void col.offsetWidth; col.classList.add('is-stop'); }
        };
        const finish = () => {
          if (done) return;
          done = true;
          cancelAnimationFrame(raf); clearTimeout(guard);
          for (let r = 0; r < reels; r++) stopReel(r);
          root.classList.remove('is-spinning');
          spinning = null;
          resolve();
        };
        spinning = { finish };
        if (!base || reduced()) { finish(); return; }
        const frame = (t) => {
          if (done) return;
          if (!t0) t0 = t;
          const el2 = t - t0;
          let all = true;
          for (let r = 0; r < reels; r++) {
            const st = state[r];
            if (st.stopped) continue;
            if (el2 >= st.stopAt) { stopReel(r); continue; }
            all = false;
            const prev = st.off;
            st.off = el2 * 0.02; // 每秒約 20 格
            const frac = st.off % 1;
            const flipped = Math.floor(st.off) !== Math.floor(prev);
            for (let y = 0; y < rows; y++) {
              const c = cells[r][y];
              if (c.locked) continue;
              if (flipped) paintSym(c, randSym(r));
              c.el.classList.add('is-blur');
              c.inner.style.transform = `translateY(${(frac * 100 - 50).toFixed(1)}%)`;
            }
          }
          if (all) finish(); else raf = requestAnimationFrame(frame);
        };
        raf = requestAnimationFrame(frame);
        guard = setTimeout(finish, base + reels * step + 400); // 分頁在背景時 rAF 會暫停
      });
    }

    function clear() {
      root.querySelectorAll('.is-win').forEach((x) => x.classList.remove('is-win'));
      root.classList.remove('has-win');
      svg.innerHTML = '';
    }
    const at = (c) => { const [r, y] = cellRC(c); return cells[r] && cells[r][y]; };

    const view = {
      el: root,
      spin,
      setGrid,
      /** 目前畫面 grid[reel][row] */
      grid: () => cells.map((col) => col.map((c) => c.sym)),
      cell: (r, y) => (cells[r] && cells[r][y] ? cells[r][y].el : null),
      /** 中獎格發光 */
      highlight(list) {
        (list || []).forEach((c) => { const x = at(c); if (x) x.el.classList.add('is-win'); });
        if (list && list.length) root.classList.add('has-win');
      },
      /** 畫一條賠付線：rowsPerReel = [row of reel0, row of reel1, …] */
      showLine(rowsPerReel, { color = 'var(--gold)' } = {}) {
        const pts = rowsPerReel.map((y, r) => `${r + 0.5},${y + 0.5}`).join(' ');
        svg.appendChild(el('polyline', { points: pts, fill: 'none', stroke: color, 'stroke-width': '0.06', 'stroke-linejoin': 'round', 'vector-effect': 'non-scaling-stroke', style: 'stroke-width:3px' }));
      },
      /** 清除高亮與賠付線（不清鎖定與面額） */
      clear,
      /** Hold & Spin：鎖定格（累加）。lock(null) 解除全部 */
      lock(list) {
        if (list === null) { view.unlock(); return; }
        (list || []).forEach((c) => { const x = at(c); if (x) { x.locked = true; x.el.classList.add('is-locked'); } });
      },
      unlock(list) {
        const all = list ? list.map(at).filter(Boolean) : cells.flat();
        all.forEach((x) => { x.locked = false; x.el.classList.remove('is-locked'); });
      },
      isLocked: (c) => !!(at(c) && at(c).locked),
      /** 金球面額等：在格子上疊文字；text=null 移除 */
      setSymbolValue(c, text) {
        const x = at(c);
        if (!x) return;
        let v = x.el.querySelector('.lg-slot__value');
        if (text === null || text === undefined || text === '') { if (v) v.remove(); x.value = null; return; }
        if (!v) { v = el('span.lg-slot__value'); x.el.appendChild(v); }
        v.textContent = String(text);
        x.value = text;
      },
      /** 全部重置：高亮、線、鎖定、面額 */
      reset() {
        clear(); view.unlock();
        root.querySelectorAll('.lg-slot__value').forEach((x) => x.remove());
      },
      setStrips(s) { strips = s; },
      destroy() { if (spinning) spinning.finish(); root.remove(); },
    };
    return view;
  }

  /** 「賠付表 Pay Table」按鈕 → modal(render()) */
  function paytableButton(container, { render, label = '賠付表 <i class="en">Pay Table</i>', title = '賠付表 <i class="en">Pay Table</i>' } = {}) {
    const b = el('button', { type: 'button', class: 'lg-btn lg-btn--ghost lg-btn--sm lg-paytable-btn', dataset: { action: 'paytable' }, html: label });
    b.addEventListener('click', () => {
      const body = render ? render() : '';
      ui.modal({ title, body: body ?? '', className: 'lg-modal--wide' });
    });
    container.appendChild(b);
    return b;
  }

  /**
   * 下注面板：每線注（− 值 +）、線數（− 值 +）、MAX BET、總注。
   * @param {{lines?:number|number[], lineBets?:number[], onChange?({bet,lines,lineBet}), lineBet?:number,
   *          linesLabel?:string, lineBetLabel?:string}} o
   *  lines 為數字 N → 選項 [1,5,10,…,N]；為陣列 → 直接當選項；1 → 隱藏線數。
   * @returns {{bet(), lines(), lineBet(), setMax(), set({lines,lineBet}), setEnabled(b), el}}
   */
  function betPanel(container, o = {}) {
    const lineBets = o.lineBets || [0.1, 0.2, 0.5, 1, 2, 5];
    const lineOpts = Array.isArray(o.lines) ? [...o.lines]
      : (() => { const n = o.lines ?? 20; return n <= 1 ? [1] : [...new Set([1, 5, 10, 15, 20, 25, 30, 40, 50].filter((x) => x < n).concat(n))]; })();
    let li = lineOpts.length - 1;
    let bi = Math.max(0, lineBets.indexOf(o.lineBet ?? lineBets[0]));
    let enabled = true;
    const panel = el('div.lg-betpanel');
    const mkStep = (key, label, onMinus, onPlus) => {
      const v = el('span.lg-betpanel__v', { dataset: { role: key } });
      const minus = el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-betpanel__btn', dataset: { action: `${key}-down` }, 'aria-label': '減少', text: '−' });
      const plus = el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-betpanel__btn', dataset: { action: `${key}-up` }, 'aria-label': '增加', text: '+' });
      minus.addEventListener('click', () => { if (enabled) { onMinus(); changed(); } });
      plus.addEventListener('click', () => { if (enabled) { onPlus(); changed(); } });
      const g = el('div.lg-betpanel__group', [el('span.lg-betpanel__k', { html: label }), el('div.lg-betpanel__stepper', [minus, v, plus])]);
      return { g, v, minus, plus };
    };
    const lb = mkStep('linebet', o.lineBetLabel || '每線注 <i class="en">Bet/Line</i>', () => { bi = Math.max(0, bi - 1); }, () => { bi = Math.min(lineBets.length - 1, bi + 1); });
    const ln = mkStep('lines', o.linesLabel || '線數 <i class="en">Lines</i>', () => { li = Math.max(0, li - 1); }, () => { li = Math.min(lineOpts.length - 1, li + 1); });
    if (lineOpts.length <= 1) ln.g.hidden = true;
    const maxB = el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-betpanel__max', dataset: { action: 'maxbet' }, html: 'MAX BET' });
    maxB.addEventListener('click', () => { if (enabled) { api.setMax(); } });
    const tot = el('div.lg-betpanel__total', { dataset: { role: 'total' } });
    panel.append(lb.g, ln.g, maxB, tot);
    container.appendChild(panel);

    const paint = () => {
      lb.v.textContent = fmt(lineBets[bi], { cents: true });
      ln.v.textContent = String(lineOpts[li]);
      tot.innerHTML = `總注 <i class="en">Total bet</i> <b>${fmt(api.bet(), { cents: true })}</b>`;
      tot.dataset.totalBet = String(api.bet());
      lb.minus.disabled = !enabled || bi === 0; lb.plus.disabled = !enabled || bi === lineBets.length - 1;
      ln.minus.disabled = !enabled || li === 0; ln.plus.disabled = !enabled || li === lineOpts.length - 1;
      maxB.disabled = !enabled;
      panel.classList.toggle('is-max', bi === lineBets.length - 1 && li === lineOpts.length - 1);
    };
    const changed = () => { paint(); if (o.onChange) o.onChange({ bet: api.bet(), lines: api.lines(), lineBet: api.lineBet() }); };
    const api = {
      el: panel,
      bet: () => round2(lineOpts[li] * lineBets[bi]),
      lines: () => lineOpts[li],
      lineBet: () => lineBets[bi],
      isMax: () => bi === lineBets.length - 1 && li === lineOpts.length - 1,
      setMax() { li = lineOpts.length - 1; bi = lineBets.length - 1; changed(); },
      set({ lines, lineBet } = {}) {
        if (lines !== undefined && lineOpts.includes(lines)) li = lineOpts.indexOf(lines);
        if (lineBet !== undefined && lineBets.includes(lineBet)) bi = lineBets.indexOf(lineBet);
        changed();
      },
      setEnabled(b) { enabled = !!b; panel.classList.toggle('is-disabled', !enabled); paint(); },
    };
    paint();
    return api;
  }

  LG.slotView = { create, paytableButton, betPanel };
})();
