// LG.ui — DOM 元件庫。見 docs/02-architecture.md §3.1、docs/03-ui-spec.md
// 所有元件只用 vanilla DOM；動畫時長一律經過 LG.ms()（測試時 ×0.1）。
(() => {
  const LG = globalThis.LG;
  const doc = globalThis.document;
  const ui = (LG.ui = LG.ui || {});

  const SVG_TAGS = new Set(['svg', 'path', 'g', 'polyline', 'polygon', 'line', 'circle', 'rect', 'text', 'defs', 'use']);
  const isNode = (x) => !!x && typeof x === 'object' && (x.nodeType !== undefined || x.tagName !== undefined);
  const PROPS = new Set(['value', 'checked', 'disabled', 'selected', 'hidden']);

  /** HTML 跳脫 */
  function esc(s) {
    return String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  }
  /** 「中文 <i class="en">English</i>」 */
  function term(zh, en) { return en ? `${zh} <i class="en">${en}</i>` : String(zh); }

  function appendKids(e, kids) {
    if (kids === null || kids === undefined || kids === false) return;
    if (Array.isArray(kids)) { kids.forEach((k) => appendKids(e, k)); return; }
    if (isNode(kids)) { e.appendChild(kids); return; }
    e.appendChild(doc.createTextNode(String(kids)));
  }

  /**
   * 建立元素。tag 可寫成 'div.a.b'（附 class）。
   * attrs: class, dataset, on:{click:fn}, html, text, style(字串或物件), 其他屬性直接 setAttribute
   */
  function el(tag, attrs = {}, children = []) {
    if (typeof attrs === 'string' || Array.isArray(attrs) || isNode(attrs)) { children = attrs; attrs = {}; }
    attrs = attrs || {};
    const parts = String(tag || 'div').split('.');
    const name = parts[0] || 'div';
    const e = SVG_TAGS.has(name) ? doc.createElementNS('http://www.w3.org/2000/svg', name) : doc.createElement(name);
    const cls = [...parts.slice(1)];
    for (const [k, v] of Object.entries(attrs)) {
      if (v === undefined || v === null || v === false) continue;
      if (k === 'class' || k === 'className') { cls.push(...(Array.isArray(v) ? v : [v]).filter(Boolean)); }
      else if (k === 'dataset') { for (const [dk, dv] of Object.entries(v)) if (dv !== undefined && dv !== null) e.dataset[dk] = String(dv); }
      else if (k === 'on') { for (const [ev, fn] of Object.entries(v)) if (fn) e.addEventListener(ev, fn); }
      else if (k === 'html') { e.innerHTML = v; }
      else if (k === 'text') { e.textContent = String(v); }
      else if (k === 'style') {
        if (typeof v === 'string') e.setAttribute('style', v);
        else for (const [sk, sv] of Object.entries(v)) {
          if (sk.startsWith('--') && e.style.setProperty) e.style.setProperty(sk, sv); else e.style[sk] = sv;
        }
      }
      else if (PROPS.has(k) && !SVG_TAGS.has(name)) { e[k] = v; if (v === true) e.setAttribute(k, ''); }
      else e.setAttribute(k, v === true ? '' : String(v));
    }
    if (cls.length) e.setAttribute('class', cls.join(' '));
    appendKids(e, children);
    return e;
  }

  // ------------------------------------------------------------------ 撲克牌
  const SUIT = {
    S: { symbol: '♠', zh: '黑桃', en: 'Spades', color: 'black' },
    H: { symbol: '♥', zh: '紅心', en: 'Hearts', color: 'red' },
    D: { symbol: '♦', zh: '方塊', en: 'Diamonds', color: 'red' },
    C: { symbol: '♣', zh: '梅花', en: 'Clubs', color: 'black' },
    J: { symbol: '★', zh: '小丑', en: 'Joker', color: 'red' },
  };
  const rankText = (r) => (r === 'T' ? '10' : r === 'X' ? 'JK' : String(r));
  const cardData = new WeakMap();

  /** 更新既有 .lg-card 元素的牌面（不改變正/反面狀態） */
  function setCard(e, c) {
    if (!c) return e;
    cardData.set(e, c);
    const s = SUIT[c.suit] || SUIT.S;
    const joker = c.rank === 'X';
    e.dataset.id = c.id || (c.rank + c.suit);
    e.dataset.rank = c.rank; e.dataset.suit = c.suit;
    e.classList.remove('lg-card--red', 'lg-card--black');
    e.classList.add(s.color === 'red' ? 'lg-card--red' : 'lg-card--black');
    const r = rankText(c.rank);
    const face = e.querySelector ? e.querySelector('.lg-card__face') : null;
    const html = joker
      ? `<span class="lg-card__tl"><b>JK</b><span>${s.symbol}</span></span><span class="lg-card__pip lg-card__pip--joker">JOKER</span><span class="lg-card__br"><b>JK</b><span>${s.symbol}</span></span>`
      : `<span class="lg-card__tl"><b>${r}</b><span>${s.symbol}</span></span>`
        + `<span class="lg-card__pip${'JQK'.includes(c.rank) ? ' lg-card__pip--court' : ''}">${'JQK'.includes(c.rank) ? c.rank + s.symbol : s.symbol}</span>`
        + `<span class="lg-card__br"><b>${r}</b><span>${s.symbol}</span></span>`;
    if (face) face.innerHTML = html;
    e.setAttribute('aria-label', joker ? '小丑 Joker' : `${s.zh}${r}（${r}${s.symbol}）`);
    return e;
  }

  /** → .lg-card 元素（data-id）。size: 'sm'|'md'|'lg' */
  function card(c, { faceDown = false, size = 'md', dim = false } = {}) {
    const e = el('div', { class: ['lg-card', `lg-card--${size}`, faceDown && 'is-facedown', dim && 'is-dim'], role: 'img' }, [
      el('div.lg-card__face'),
      el('div.lg-card__back'),
    ]);
    if (c) setCard(e, c); else e.classList.add('is-facedown');
    if (faceDown) e.setAttribute('aria-label', '蓋著的牌 Face-down card');
    return e;
  }

  /**
   * 翻牌動畫（300ms）。蓋著 → 翻開；已翻開且給新牌 → 換牌面；已翻開沒給牌 → 蓋回。
   * @returns {Promise<Element>}
   */
  function flip(e, c) {
    const wasDown = e.classList.contains('is-facedown');
    const same = c && cardData.get(e) === c;
    if (c) setCard(e, c);
    const toggle = () => {
      if (wasDown) e.classList.remove('is-facedown');
      else if (!c || same) { e.classList.add('is-facedown'); e.setAttribute('aria-label', '蓋著的牌 Face-down card'); }
    };
    const half = LG.ms(150);
    return new Promise((res) => {
      if (!half) { toggle(); res(e); return; }
      e.style.transitionDuration = half + 'ms';
      e.classList.add('is-flipping');
      setTimeout(() => {
        toggle();
        e.classList.remove('is-flipping');
        setTimeout(() => { e.style.transitionDuration = ''; res(e); }, half);
      }, half);
    });
  }

  /**
   * 咪牌：拖曳（由上往下 / 由左往右）或按住不放逐步揭露；揭露 ≥ 70% 自動翻開並呼叫 onRevealed(card, el)。
   * @returns {{reveal():void, progress():number, destroy():void}}
   */
  function squeezeable(e, c, { onRevealed, threshold = 0.7 } = {}) {
    c = c || cardData.get(e);
    if (c) setCard(e, c);
    e.classList.add('is-facedown', 'is-squeeze');
    e.setAttribute('tabindex', '0');
    e.setAttribute('role', 'button');
    e.setAttribute('aria-label', '咪牌：向下或向右拖曳翻開 Squeeze');
    const face = e.querySelector('.lg-card__face');
    const hint = el('span.lg-card__hint', { text: '拖曳咪牌' });
    e.appendChild(hint);
    let p = 0, dir = 'top', start = null, done = false, holdT = 0, holdRaf = 0, lastT = 0;

    const paint = () => {
      const hide = ((1 - p) * 100).toFixed(1) + '%';
      if (face) face.style.clipPath = dir === 'left' ? `inset(0 ${hide} 0 0)` : `inset(0 0 ${hide} 0)`;
      e.dataset.squeeze = String(Math.round(p * 100));
    };
    const setP = (v) => {
      if (done) return;
      p = Math.max(p, Math.min(1, v));
      paint();
      if (p >= threshold) finish();
    };
    const stopHold = () => { clearTimeout(holdT); if (holdRaf) cancelAnimationFrame(holdRaf); holdRaf = 0; };
    const holdStep = (t) => {
      const dt = lastT ? t - lastT : 16; lastT = t;
      setP(p + dt / 1600);
      if (!done && start) holdRaf = requestAnimationFrame(holdStep);
    };
    const onDown = (ev) => {
      if (done || (ev.button !== undefined && ev.button !== 0)) return;
      start = { x: ev.clientX, y: ev.clientY, dir: null };
      try { e.setPointerCapture && e.setPointerCapture(ev.pointerId); } catch { /* ignore */ }
      stopHold();
      holdT = setTimeout(() => { if (start && !start.dir) { dir = 'top'; lastT = 0; holdRaf = requestAnimationFrame(holdStep); } }, 350);
      ev.preventDefault && ev.preventDefault();
    };
    const onMove = (ev) => {
      if (!start || done) return;
      const dx = ev.clientX - start.x, dy = ev.clientY - start.y;
      if (!start.dir && Math.hypot(dx, dy) > 6) { start.dir = Math.abs(dx) > Math.abs(dy) ? 'left' : 'top'; dir = start.dir; stopHold(); }
      if (!start.dir) return;
      const r = e.getBoundingClientRect();
      setP(dir === 'left' ? dx / (r.width || 1) : dy / (r.height || 1));
    };
    const onUp = () => { start = null; stopHold(); };
    const onKey = (ev) => { if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); finish(); } };

    function cleanup() {
      stopHold();
      e.removeEventListener('pointerdown', onDown);
      e.removeEventListener('pointermove', onMove);
      e.removeEventListener('pointerup', onUp);
      e.removeEventListener('pointercancel', onUp);
      e.removeEventListener('keydown', onKey);
      hint.remove();
      e.removeAttribute('tabindex');
    }
    function finish() {
      if (done) return;
      done = true; p = 1;
      cleanup();
      if (face) face.style.clipPath = '';
      e.classList.remove('is-facedown', 'is-squeeze');
      e.classList.add('is-revealed');
      e.setAttribute('role', 'img');
      if (c) setCard(e, c);
      delete e.dataset.squeeze;
      if (onRevealed) onRevealed(c, e);
    }
    e.addEventListener('pointerdown', onDown);
    e.addEventListener('pointermove', onMove);
    e.addEventListener('pointerup', onUp);
    e.addEventListener('pointercancel', onUp);
    e.addEventListener('keydown', onKey);
    paint();
    return { reveal: finish, progress: () => p, destroy: () => { done = true; cleanup(); } };
  }

  // ------------------------------------------------------------------ toast / modal
  function host(cls) {
    let h = doc.querySelector('.' + cls);
    if (!h) { h = el('div', { class: cls }); doc.body.appendChild(h); }
    return h;
  }

  /** 短暫提示（文字可含 <i class="en">）。時長不隨 LG.speed 縮短。 */
  function toast(text, { ms = 1800, type = '' } = {}) {
    if (!doc || !doc.body) return null;
    const h = host('lg-toasts');
    const t = el('div', { class: ['lg-toast', type && `lg-toast--${type}`], role: 'status', html: String(text) });
    h.appendChild(t);
    while (h.children.length > 3) h.firstChild.remove();
    setTimeout(() => { t.classList.add('is-out'); setTimeout(() => t.remove(), 250); }, ms);
    return t;
  }

  /**
   * 對話框。actions: [{label, onClick(ev, handle), primary, id, danger}]；onClick 回傳 false 則不關閉。
   * @returns {{close():void, el:Element}}
   */
  function modal({ title = '', body = '', actions, dismissable = true, onClose, className = '' } = {}) {
    const back = el('div.lg-modal-backdrop', { role: 'dialog', 'aria-modal': 'true' });
    const box = el('div', { class: ['lg-modal', className] });
    if (title) box.appendChild(el('h2.lg-modal__title', { html: title }));
    const b = el('div.lg-modal__body');
    if (isNode(body)) b.appendChild(body); else b.innerHTML = String(body ?? '');
    box.appendChild(b);
    const acts = el('div.lg-modal__actions');
    let closed = false;
    const handle = {
      el: back,
      close() {
        if (closed) return;
        closed = true;
        doc.removeEventListener('keydown', onKey);
        back.classList.add('is-out');
        setTimeout(() => back.remove(), LG.ms(160));
        if (onClose) onClose();
      },
    };
    (actions || [{ label: '關閉 <i class="en">Close</i>', primary: true }]).forEach((a) => {
      const btn = el('button', {
        type: 'button', class: ['lg-btn', a.primary && 'lg-btn--primary', a.danger && 'lg-btn--danger'],
        dataset: { action: a.id }, html: a.label,
      });
      btn.addEventListener('click', (ev) => {
        const r = a.onClick ? a.onClick(ev, handle) : undefined;
        if (r !== false) handle.close();
      });
      acts.appendChild(btn);
    });
    box.appendChild(acts);
    back.appendChild(box);
    const onKey = (ev) => { if (ev.key === 'Escape' && dismissable) handle.close(); };
    doc.addEventListener('keydown', onKey);
    back.addEventListener('click', (ev) => { if (ev.target === back && dismissable) handle.close(); });
    doc.body.appendChild(back);
    const pri = acts.querySelector('.lg-btn--primary') || acts.querySelector('button');
    if (pri && pri.focus) setTimeout(() => { try { pri.focus({ preventScroll: true }); } catch { /* ignore */ } }, 0);
    return handle;
  }

  /** → Promise<boolean> */
  function confirm(text, { title = '確認 <i class="en">Confirm</i>', okLabel = '確定 <i class="en">OK</i>', cancelLabel = '取消 <i class="en">Cancel</i>', danger = false } = {}) {
    return new Promise((resolve) => {
      let v = false;
      modal({
        title, body: `<p>${text}</p>`,
        actions: [
          { id: 'cancel', label: cancelLabel },
          { id: 'ok', label: okLabel, primary: true, danger, onClick: () => { v = true; } },
        ],
        onClose: () => resolve(v),
      });
    });
  }

  // ------------------------------------------------------------------ 籌碼
  const CHIP_COLOR = [[1000, 'yellow'], [500, 'purple'], [100, 'black'], [50, 'orange'], [25, 'green'], [10, 'blue']];
  function chipColor(d) {
    for (const [v, c] of CHIP_COLOR) if (d >= v) return c;
    return 'gray';
  }
  function chipText(d) {
    if (d >= 1000) return (d / 1000) + 'K';
    return String(d);
  }

  /**
   * 籌碼盤（面額 10 藍、25 綠、50 橙、100 黑、500 紫、1000 黃）。
   * @returns {{selected():number, select(d):void, setEnabled(b):void, setAffordable(balance):void, el:Element}}
   */
  function chipTray(container, { denoms = [10, 25, 50, 100, 500, 1000], onSelect, selected } = {}) {
    container.classList.add('lg-chips');
    container.setAttribute('role', 'radiogroup');
    container.setAttribute('aria-label', '籌碼面額 Chips');
    container.innerHTML = '';
    let sel = denoms.includes(selected) ? selected : denoms[0];
    let enabled = true;
    const btns = denoms.map((d) => {
      const b = el('button', {
        type: 'button', class: ['lg-chip', `lg-chip--${chipColor(d)}`], dataset: { denom: d },
        role: 'radio', 'aria-label': LG.money.fmt(d), title: LG.money.fmt(d),
      }, [el('span.lg-chip__v', { text: chipText(d) })]);
      b.addEventListener('click', () => {
        if (!enabled) return;
        if (b.classList.contains('is-unaffordable')) toast('籌碼不足 <i class="en">Insufficient chips</i>', { type: 'warn' });
        api.select(d);
      });
      container.appendChild(b);
      return b;
    });
    const paint = () => btns.forEach((b) => {
      const on = Number(b.dataset.denom) === sel;
      b.classList.toggle('is-selected', on);
      b.setAttribute('aria-checked', on ? 'true' : 'false');
    });
    const api = {
      el: container,
      denoms: [...denoms],
      selected: () => sel,
      select(d) {
        d = Number(d);
        if (!denoms.includes(d)) return;
        sel = d; paint();
        if (onSelect) onSelect(d);
      },
      setEnabled(b) {
        enabled = !!b;
        container.classList.toggle('is-disabled', !enabled);
        btns.forEach((x) => { x.disabled = !enabled; });
      },
      /** 把買不起的面額灰掉（balance = 可用餘額） */
      setAffordable(balance) {
        btns.forEach((b) => b.classList.toggle('is-unaffordable', Number(b.dataset.denom) > balance + 1e-9));
      },
    };
    paint();
    return api;
  }

  /** 小籌碼堆 + 金額文字（下注格上顯示） */
  function chipStack(amount) {
    amount = LG.money.round2(amount);
    const discs = [];
    let rest = amount;
    for (const [v, c] of CHIP_COLOR) {
      while (rest >= v - 1e-9 && discs.length < 6) { discs.push(c); rest = LG.money.round2(rest - v); }
    }
    if (rest > 0 && discs.length < 6) discs.push('gray');
    if (!discs.length) discs.push('gray');
    const s = el('div.lg-chipstack', { dataset: { amount }, title: LG.money.fmt(amount) });
    discs.reverse().forEach((c, i) => s.appendChild(el('span', { class: ['lg-chipstack__chip', `lg-chip--${c}`], style: `--i:${i}` })));
    s.appendChild(el('span.lg-chipstack__amt', { text: LG.money.fmt(amount) }));
    return s;
  }

  // ------------------------------------------------------------------ 荷官口令 / 倒數
  function banner() {
    let b = doc.querySelector('.lg-dealer-banner');
    if (!b && doc.body) { b = el('div.lg-dealer-banner.is-floating'); doc.body.appendChild(b); }
    return b;
  }
  const dealer = {
    /** 荷官口令橫幅（中/英兩行）；speak=true 時用 speechSynthesis 念英文 */
    say(zh, en = '', { speak = false } = {}) {
      const b = banner();
      if (!b) return;
      b.innerHTML = `<span class="lg-dealer-banner__zh">${zh}</span>${en ? `<span class="lg-dealer-banner__en">${en}</span>` : ''}`;
      b.dataset.zh = String(zh).replace(/<[^>]+>/g, '');
      b.dataset.en = String(en).replace(/<[^>]+>/g, '');
      b.classList.add('is-active');
      b.classList.remove('is-pulse');
      void b.offsetWidth; // 重新觸發動畫
      b.classList.add('is-pulse');
      const ss = globalThis.speechSynthesis;
      if (speak && en && ss && globalThis.SpeechSynthesisUtterance) {
        try {
          ss.cancel();
          const u = new globalThis.SpeechSynthesisUtterance(b.dataset.en);
          u.lang = 'en-US'; u.rate = 1;
          ss.speak(u);
        } catch { /* 沒有語音也沒關係 */ }
      }
    },
    clear() {
      const b = doc.querySelector('.lg-dealer-banner');
      if (!b) return;
      b.classList.remove('is-active', 'is-pulse');
      b.innerHTML = '<span class="lg-dealer-banner__zh">荷官 <i class="en">Dealer</i></span>';
      delete b.dataset.zh; delete b.dataset.en;
    },
  };

  let activeCd = null;
  /**
   * 倒數（顯示於 .lg-countdown）。每秒 = LG.ms(1000)。onTick(剩餘秒數)、onDone()。
   * 同時只會有一個倒數；新倒數會取消舊的。
   * @returns {{cancel():void, remaining():number}}
   */
  function countdown(seconds, { onTick, onDone } = {}) {
    if (activeCd) activeCd.cancel();
    let n = Math.max(0, Math.round(seconds));
    let timer = 0, dead = false;
    let h = doc.querySelector('.lg-countdown');
    if (!h && doc.body) { h = el('div.lg-countdown.is-floating'); doc.body.appendChild(h); }
    const paint = () => {
      if (!h) return;
      h.classList.add('is-active');
      h.classList.toggle('is-urgent', n <= 5);
      h.dataset.remaining = String(n);
      h.innerHTML = `<span class="lg-countdown__n">${n}</span><span class="lg-countdown__bar"><span style="width:${seconds ? (n / seconds) * 100 : 0}%"></span></span>`;
    };
    const hide = () => { if (h) { h.classList.remove('is-active', 'is-urgent'); h.innerHTML = ''; delete h.dataset.remaining; } };
    const handle = {
      cancel() { if (dead) return; dead = true; clearTimeout(timer); hide(); if (activeCd === handle) activeCd = null; },
      remaining: () => n,
    };
    const step = () => {
      if (dead) return;
      if (n <= 0) {
        dead = true; hide();
        if (activeCd === handle) activeCd = null;
        if (onDone) onDone();
        return;
      }
      timer = setTimeout(() => { n -= 1; paint(); if (onTick && n > 0) onTick(n); step(); }, LG.ms(1000));
    };
    activeCd = handle;
    paint();
    if (onTick) onTick(n);
    step();
    return handle;
  }

  // ------------------------------------------------------------------ 結果面板 / 派彩閃示
  let activeResult = null;
  const setContent = (node, v) => { if (isNode(v)) node.appendChild(v); else node.innerHTML = String(v); };

  /**
   * 練習/教學模式結果面板（四段：牌型 → 結果 → 賠付計算式 → 為什麼），由底部滑入，可下滑收起。
   * @param {{title?, hand?, result?, formula?, why?, net?:number, tone?:'win'|'lose'|'push', actions?:Array, onClose?}} o
   * @returns {{close():void, el:Element}}
   */
  function resultPanel(o = {}) {
    if (activeResult) activeResult.close(true);
    const tone = o.tone || (typeof o.net === 'number' ? (o.net > 0 ? 'win' : o.net < 0 ? 'lose' : 'push') : '');
    const p = el('div', { class: ['lg-result', tone && `is-${tone}`], role: 'dialog', 'aria-label': '本局結果 Result' });
    const head = el('div.lg-result__head', [
      el('span.lg-result__grip', { 'aria-hidden': 'true' }),
      el('strong.lg-result__title', { html: o.title || '本局結果 <i class="en">Result</i>' }),
      typeof o.net === 'number' ? el('span.lg-result__net', { text: LG.money.fmtSigned(o.net) }) : null,
      el('button.lg-result__x', { type: 'button', 'aria-label': '收起 Close', text: '×', on: { click: () => h.close() } }),
    ]);
    p.appendChild(head);
    const rows = el('div.lg-result__rows');
    [['hand', '牌型', 'Hand'], ['result', '結果', 'Result'], ['formula', '賠付', 'Payout'], ['why', '為什麼', 'Why']].forEach(([k, zh, en]) => {
      if (o[k] === undefined || o[k] === null || o[k] === '') return;
      const v = el('div.lg-result__v', { dataset: { k } });
      setContent(v, o[k]);
      rows.appendChild(el('div.lg-result__row', [el('div.lg-result__k', { html: term(zh, en) }), v]));
    });
    p.appendChild(rows);
    const acts = el('div.lg-result__actions');
    (o.actions || [{ label: '再來一局 <i class="en">Next round</i>', primary: true }]).forEach((a) => {
      const b = el('button', { type: 'button', class: ['lg-btn', a.primary && 'lg-btn--primary'], dataset: { action: a.id || 'result-next' }, html: a.label });
      b.addEventListener('click', (ev) => { const r = a.onClick ? a.onClick(ev, h) : undefined; if (r !== false) h.close(); });
      acts.appendChild(b);
    });
    p.appendChild(acts);

    // 下滑收起
    let sy = null;
    head.addEventListener('pointerdown', (ev) => { if (ev.target.closest && ev.target.closest('button')) return; sy = ev.clientY; try { head.setPointerCapture(ev.pointerId); } catch { /* */ } });
    head.addEventListener('pointermove', (ev) => { if (sy === null) return; const dy = Math.max(0, ev.clientY - sy); p.style.translate = `0 ${dy}px`; });
    const end = (ev) => { if (sy === null) return; const dy = ev.clientY - sy; sy = null; p.style.translate = ''; if (dy > 60) h.close(); };
    head.addEventListener('pointerup', end);
    head.addEventListener('pointercancel', end);

    let closed = false;
    const h = {
      el: p,
      close(silent) {
        if (closed) return;
        closed = true;
        if (activeResult === h) activeResult = null;
        p.classList.add('is-out');
        setTimeout(() => p.remove(), LG.ms(200));
        if (!silent && o.onClose) o.onClose();
      },
    };
    (doc.querySelector('.lg-overlay-host') || doc.body).appendChild(p);
    activeResult = h;
    return h;
  }

  /** 真實模式：桌面中央閃示 +RM 95 / −RM 50，1.2 秒淡出 */
  function payoutFlash(net, { text } = {}) {
    if (!doc || !doc.body) return null;
    net = LG.money.round2(net || 0);
    const f = el('div', {
      class: ['lg-flash', net > 0 ? 'is-win' : net < 0 ? 'is-lose' : 'is-push'],
      dataset: { net }, role: 'status',
      text: text || (net === 0 ? 'RM 0' : LG.money.fmtSigned(net)),
    });
    f.style.animationDuration = LG.ms(1200) + 'ms';
    ui.flashCount = (ui.flashCount || 0) + 1;   // 測試用：e2e waitFlash 以計數判斷
    ui.lastFlash = { net, at: Date.now() };
    (doc.querySelector('.lg-overlay-host') || doc.body).appendChild(f);
    setTimeout(() => f.remove(), LG.ms(1200) + 50);
    return f;
  }

  // ------------------------------------------------------------------ 教學高亮
  /**
   * spotlight：符合的元素加 .lg-spot--hl（金框呼吸），同一範圍（.lg-stage）其餘區塊加 .lg-dimmed（opacity .35）。
   * null / [] 清除。回傳被高亮的元素陣列。
   */
  function highlight(sels, { scope } = {}) {
    doc.querySelectorAll('.lg-spot--hl').forEach((x) => x.classList.remove('lg-spot--hl'));
    doc.querySelectorAll('.lg-dimmed').forEach((x) => x.classList.remove('lg-dimmed'));
    doc.querySelectorAll('.lg-hl-on').forEach((x) => x.classList.remove('lg-hl-on'));
    if (!sels || (Array.isArray(sels) && !sels.length)) return [];
    const list = Array.isArray(sels) ? sels : [sels];
    const root = scope || doc.querySelector('.lg-stage') || doc.body;
    const targets = [];
    for (const s of list) {
      let found = [];
      try { found = [...root.querySelectorAll(s)]; if (!found.length) found = [...doc.querySelectorAll(s)]; }
      catch { LG.debug('bad selector', s); }
      found.forEach((x) => { if (!targets.includes(x)) targets.push(x); });
    }
    if (!targets.length) return [];
    targets.forEach((t) => t.classList.add('lg-spot--hl'));
    const inRoot = targets.filter((t) => root.contains(t));
    if (inRoot.length) {
      const keep = new Set();
      inRoot.forEach((t) => { let n = t; while (n && n !== root) { keep.add(n); n = n.parentElement; } });
      const walk = (parent) => {
        for (const ch of parent.children) {
          if (targets.includes(ch)) continue;
          if (keep.has(ch)) walk(ch);
          else if (!/^(SCRIPT|STYLE)$/.test(ch.tagName)) ch.classList.add('lg-dimmed');
        }
      };
      walk(root);
      root.classList.add('lg-hl-on');
    }
    try { targets[0].scrollIntoView({ block: 'nearest', behavior: LG.speed < 1 ? 'auto' : 'smooth' }); } catch { /* */ }
    return targets;
  }

  // ------------------------------------------------------------------ 表格 / 分頁 / 動作列
  /**
   * 策略表 / 賠付表。data 可為 HTML 字串（<tr>… 或完整 <table>）或二維陣列（第一列為表頭）。
   */
  function table(data, { caption, header = true, className = '' } = {}) {
    const wrap = el('div', { class: ['lg-tablewrap', className] });
    if (Array.isArray(data)) {
      const t = el('table.lg-datatable');
      if (caption) t.appendChild(el('caption', { html: caption }));
      const rows = [...data];
      if (header && rows.length) {
        const hr = rows.shift();
        t.appendChild(el('thead', [el('tr', hr.map((c) => el('th', { html: String(c) })))]));
      }
      t.appendChild(el('tbody', rows.map((r) => el('tr', r.map((c) => el('td', { html: String(c) }))))));
      wrap.appendChild(t);
    } else {
      const s = String(data ?? '');
      wrap.innerHTML = /<table/i.test(s) ? s : `<table>${caption ? `<caption>${caption}</caption>` : ''}${s}</table>`;
      const t = wrap.querySelector('table');
      if (t) { t.classList.add('lg-datatable'); if (caption && !t.querySelector('caption')) t.prepend(el('caption', { html: caption })); }
    }
    return wrap;
  }

  /** 分頁：items=[{id,label,render(panel)}] → {select(id), current()} */
  function tabs(container, items, { active } = {}) {
    container.classList.add('lg-tabs');
    container.innerHTML = '';
    const bar = el('div.lg-tabs__bar', { role: 'tablist' });
    const panel = el('div.lg-tabs__panel', { role: 'tabpanel' });
    let cur = null;
    const btns = items.map((it) => {
      const b = el('button', { type: 'button', class: 'lg-tabs__btn', role: 'tab', dataset: { tab: it.id }, html: it.label });
      b.addEventListener('click', () => api.select(it.id));
      bar.appendChild(b);
      return b;
    });
    container.append(bar, panel);
    const api = {
      select(id) {
        const it = items.find((x) => x.id === id) || items[0];
        if (!it) return;
        cur = it.id;
        btns.forEach((b) => { const on = b.dataset.tab === cur; b.classList.toggle('is-active', on); b.setAttribute('aria-selected', on ? 'true' : 'false'); });
        panel.innerHTML = '';
        const r = it.render ? it.render(panel) : null;
        if (r !== undefined && r !== null && r !== panel) setContent(panel, r);
      },
      current: () => cur,
      el: container,
    };
    api.select(active || (items[0] && items[0].id));
    return api;
  }

  /**
   * 動作列：[{id, label, en, onClick, disabled, primary, hidden}] → {set(id, patch), clear(), add(items), button(id)}
   * 按鈕有 data-action=id。
   */
  function actionBar(container, items = []) {
    container.classList.add('lg-actions');
    const map = new Map();
    const paint = (b, it) => {
      b.innerHTML = it.en ? term(it.label, it.en) : String(it.label ?? '');
      b.disabled = !!it.disabled;
      b.hidden = !!it.hidden;
      b.className = ['lg-btn', it.primary && 'lg-btn--primary', it.danger && 'lg-btn--danger', it.className].filter(Boolean).join(' ');
    };
    const api = {
      el: container,
      add(list) {
        (Array.isArray(list) ? list : [list]).forEach((raw) => {
          const it = { ...raw };
          const b = el('button', { type: 'button', dataset: { action: it.id } });
          b.addEventListener('click', (ev) => { const cur = map.get(it.id); if (!cur || b.disabled) return; if (cur.it.onClick) cur.it.onClick(ev); });
          paint(b, it);
          map.set(it.id, { b, it });
          container.appendChild(b);
        });
        return api;
      },
      set(id, patch = {}) {
        const cur = map.get(id);
        if (!cur) return;
        Object.assign(cur.it, patch);
        paint(cur.b, cur.it);
      },
      button: (id) => (map.get(id) || {}).b || null,
      /** 移除這個動作列建立的所有按鈕 */
      clear() { map.forEach(({ b }) => b.remove()); map.clear(); },
    };
    api.add(items);
    return api;
  }

  /** 關閉結果面板、倒數、高亮（模式切換時由框架呼叫） */
  function clearOverlays() {
    if (activeResult) activeResult.close(true);
    if (activeCd) activeCd.cancel();
    highlight(null);
    doc.querySelectorAll('.lg-flash').forEach((x) => x.remove());
  }

  Object.assign(ui, {
    el, esc, term, card, setCard, flip, squeezeable, toast, modal, confirm,
    chipTray, chipStack, chipColor, dealer, countdown, resultPanel, payoutFlash, highlight,
    table, tabs, actionBar, clearOverlays, SUIT,
    /** 取得 .lg-card 元素對應的牌物件 */
    cardOf: (e) => cardData.get(e) || null,
  });
})();
