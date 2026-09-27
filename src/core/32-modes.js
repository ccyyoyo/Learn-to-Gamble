// LG.modes — 三模式框架：建立遊戲頁（topbar/modebar/variantbar/stage）、ctx、真實模式進場/離場、破產覆蓋層。
// 見 docs/02-architecture.md §4.1–4.2、docs/03-ui-spec.md §2、§7
(() => {
  const LG = globalThis.LG;
  const { el, term, toast } = LG.ui;
  const { fmt, round2 } = LG.money;

  const MODE_INFO = {
    tutorial: { zh: '教學', en: 'Tutorial' },
    practice: { zh: '練習', en: 'Practice' },
    real: { zh: '真實', en: 'Real' },
  };

  let cur = null;

  const balText = (b) => fmt(b, { cents: Math.round(b * 100) % 100 !== 0 });
  const limitsText = (l) => `${fmt(l.min, { cents: l.min < 1 })} – ${fmt(l.max).replace('RM ', '')}`;

  function sessionHtml(s) {
    const mins = s.endedAt && s.startedAt ? Math.max(1, Math.round((s.endedAt - s.startedAt) / 60000)) : null;
    const cls = s.net > 0 ? 'lg-win' : s.net < 0 ? 'lg-lose' : '';
    return `<dl class="lg-kv">
      <dt>局數 <i class="en">Rounds</i></dt><dd>${s.rounds}</dd>
      <dt>總下注 <i class="en">Wagered</i></dt><dd>${fmt(s.wagered)}</dd>
      <dt>淨輸贏 <i class="en">Net</i></dt><dd class="${cls}">${LG.money.fmtSigned(s.net)}</dd>
      <dt>最大單局贏 <i class="en">Biggest win</i></dt><dd>${LG.money.fmtSigned(s.maxWin)}</dd>
      <dt>最大單局輸 <i class="en">Biggest loss</i></dt><dd>${LG.money.fmtSigned(s.maxLoss)}</dd>
      ${mins ? `<dt>時間 <i class="en">Time</i></dt><dd>${mins} 分鐘</dd>` : ''}
    </dl>`;
  }

  function showSummary(s) {
    LG.ui.modal({
      title: '本次真實模式摘要 <i class="en">Session summary</i>',
      body: sessionHtml(s) + '<p class="lg-muted">真實模式的輸贏已寫入統計。記得：設好預算，輸完就走。</p>',
      className: 'lg-modal--summary',
    });
  }

  /** 建立 ctx 並掛載遊戲頁 */
  function open(gameId, mode, variant, app) {
    const def = LG.games[gameId];
    if (!def) throw Error('unknown game ' + gameId);
    if (cur && cur.gameId === gameId && cur.mode === mode && cur.variant === variant && cur.page.isConnected) return cur.ctx;
    const continuing = !!(cur && cur.mode === 'real' && mode === 'real' && cur.gameId === gameId);
    const summary = teardown({ keepSession: continuing });
    app = app || document.getElementById('app');

    const isReal = mode === 'real', isPractice = mode === 'practice', isTutorial = mode === 'tutorial';
    const variants = def.variants || [];
    const vDef = variants.find((v) => v.id === variant) || null;
    const limits = LG.limitsFor(def, mode, variant);
    const R = LG.router;

    // ---------------------------------------------------------- 版面
    const balance = el('div.lg-balance', { 'aria-label': '餘額 Balance' });
    const menuB = el('button', { type: 'button', class: 'lg-topbar__menu', 'aria-label': '選單 Menu', dataset: { action: 'menu' }, text: '⋯' });
    const topbar = el('header.lg-topbar', [
      el('a.lg-topbar__back', { href: '#/', 'aria-label': '回首頁', html: '← 首頁' }),
      el('div.lg-topbar__title', { html: `<b>${def.name.zh}</b> <i class="en">${def.name.en}</i>` }),
      balance, menuB,
    ]);
    const seg = el('nav.lg-seg', { 'aria-label': '模式 Mode' }, ['tutorial', 'practice', 'real'].map((m) =>
      el('a', { class: ['lg-seg__btn', m === mode && 'is-active'], href: R.href(gameId, m, variant), dataset: { mode: m }, 'aria-current': m === mode ? 'page' : null, html: term(MODE_INFO[m].zh, MODE_INFO[m].en) })));
    const hintB = el('button', { type: 'button', class: 'lg-switch', role: 'switch', dataset: { action: 'hints' }, html: '<span class="lg-switch__knob"></span>提示 <i class="en">Hints</i>' });
    const modebar = el('div.lg-modebar', [seg, isPractice ? hintB : null,
      isReal ? el('span.lg-modebar__limits', { html: `限注 ${limitsText(limits)}` }) : null]);
    const variantbar = variants.length > 1 ? el('nav.lg-variantbar', { 'aria-label': '變體 Variant' }, [
      el('span.lg-variantbar__k', { text: '變體' }),
      ...variants.map((v) => el('a', { class: ['lg-variantbar__btn', v.id === variant && 'is-active'], href: R.href(gameId, mode, v.id), dataset: { variant: v.id }, html: term(v.name.zh, v.name.en) })),
    ]) : null;
    const bannerEl = el('div.lg-dealer-banner', { 'aria-live': 'polite' });
    const cdEl = el('div.lg-countdown', { 'aria-live': 'off' });
    const pauseB = isReal ? el('button', { type: 'button', class: 'lg-btn lg-btn--sm lg-btn--ghost lg-pause', dataset: { action: 'pause' }, html: '暫停 <i class="en">Pause</i>' }) : null;
    const section = el('section.lg-game', { dataset: { game: gameId, mode, variant: variant || '' } });
    const windowBar = el('div.lg-window-bar');
    const stage = el('div.lg-stage', [el('div.lg-stage-top', [bannerEl, cdEl, pauseB]), section, windowBar]);
    const strategy = el('aside.lg-strategy', { hidden: true, 'aria-label': '提示 Hints' });
    const tutorSlot = el('div.lg-tutor-slot');
    const page = el('div', { class: ['lg-page', 'lg-page--game', `is-${mode}`], dataset: { game: gameId, mode } },
      [topbar, modebar, variantbar, el('div.lg-game-wrap', [stage, strategy]), tutorSlot]);
    app.replaceChildren(page);
    document.title = `${def.name.zh} ${def.name.en} · 賭場遊戲練習場`;
    window.scrollTo && window.scrollTo(0, 0);
    LG.ui.dealer.clear();

    // ---------------------------------------------------------- 狀態
    const st = {
      gameId, mode, variant, def, page, section, alive: true, timers: new Set(), offs: [],
      win: null, pending: null, paused: false, broke: false, lastNet: null, strategyHtml: null, practiceWarned: false,
    };
    let readyResolve;
    const ready = new Promise((r) => { readyResolve = r; });

    const paintBalance = () => {
      const b = LG.bank.balance();
      balance.textContent = balText(b);
      balance.dataset.balance = String(b);
    };
    paintBalance();
    st.offs.push(LG.events.on('bank:change', paintBalance));

    const hintsOn = () => isPractice && !!LG.store.peek().settings.hints;
    const paintHints = () => {
      hintB.setAttribute('aria-checked', hintsOn() ? 'true' : 'false');
      hintB.classList.toggle('is-on', hintsOn());
      const show = hintsOn() && st.strategyHtml !== null && st.strategyHtml !== '';
      strategy.hidden = !show;
      page.classList.toggle('has-strategy', show);
    };
    hintB.addEventListener('click', () => {
      LG.store.update((s) => { s.settings.hints = !s.settings.hints; });
      paintHints();
      LG.events.emit('hints:change', { gameId, hints: hintsOn() });
    });

    const later = (fn, ms) => {
      const id = setTimeout(() => { st.timers.delete(id); if (st.alive) fn(); }, LG.ms(ms));
      st.timers.add(id);
      return id;
    };

    // ---------------------------------------------------------- 真實模式：暫停 / 破產
    function runPending() {
      if (!st.alive || st.paused || st.broke || !st.pending) return;
      const f = st.pending; st.pending = null;
      f();
    }
    if (pauseB) {
      pauseB.addEventListener('click', () => {
        st.paused = !st.paused;
        pauseB.innerHTML = st.paused ? '繼續 <i class="en">Resume</i>' : '暫停 <i class="en">Pause</i>';
        pauseB.classList.toggle('is-on', st.paused);
        if (st.paused) toast('已暫停：本局結束後不會自動開下一局');
        else later(runPending, 300);
      });
    }

    function brokeOverlay() {
      LG.stats.session.markBroke();
      const s = LG.stats.session.current() || { rounds: 0, wagered: 0, net: 0, maxWin: 0, maxLoss: 0 };
      const ov = el('div.lg-broke', { role: 'dialog', 'aria-modal': 'true' }, [
        el('div.lg-broke__box', [
          el('h2', { html: '籌碼用完 <i class="en">Out of chips</i>' }),
          el('p', { html: `餘額 ${balText(LG.bank.balance())} 低於本桌最低注 ${fmt(limits.min)}。` }),
          el('div', { html: sessionHtml(s) }),
          el('p.lg-muted', { text: '真實賭場裡，這就是今晚結束的時候。' }),
          el('div.lg-broke__actions', [
            el('a', { class: 'lg-btn lg-btn--ghost', href: '#/', html: '回首頁 <i class="en">Home</i>' }),
            el('button', {
              type: 'button', class: 'lg-btn lg-btn--primary', dataset: { action: 'reset-bank' }, html: '重置籌碼 RM 1,000',
              on: { click: () => { LG.bank.reset(); ov.remove(); st.broke = false; toast('籌碼已重置為 RM 1,000'); later(runPending, 300); } },
            }),
          ]),
        ]),
      ]);
      page.appendChild(ov);
    }

    // ---------------------------------------------------------- ctx
    const ctx = {
      gameId, def, mode, variant, variantDef: vDef,
      bank: LG.bank, stats: LG.stats,
      limits, denoms: def.denoms || [10, 25, 50, 100, 500, 1000],
      limitsText: limitsText(limits),
      get hints() { return hintsOn(); },
      isReal, isPractice, isTutorial,
      root: section,
      /** 真實模式進場 modal 按「開始」後 resolve（其他模式立即 resolve） */
      ready,
      /** 此 instance 仍掛載中？（非同步流程中用來提早結束） */
      alive: () => st.alive,

      /** 練習/教學：resultPanel；真實：只 payoutFlash(net)。net 省略時用最近一次 recordRound 的 net */
      explain(o = {}) {
        if (!st.alive) return null;
        const net = typeof o.net === 'number' ? o.net : st.lastNet;
        if (isReal) { LG.ui.payoutFlash(net ?? 0); return null; }
        return LG.ui.resultPanel({ ...o, net: typeof net === 'number' ? net : undefined });
      },

      dealer: {
        say(zh, en) { if (st.alive) LG.ui.dealer.say(zh, en, { speak: isReal && !!LG.store.peek().settings.speak }); },
        clear() { LG.ui.dealer.clear(); },
      },

      /**
       * 下注時段。真實：「請下注」→ 倒數 seconds 秒 →「停止下注」→ bets.lock() → onClose。
       * 練習/教學：「請下注」+ 顯示「發牌 Deal」按鈕（放在 [data-deal-slot] 或 .lg-actions，否則桌面下方），按下 → onClose。
       * @param {{seconds?:number, onClose:Function, bets?:LG.Bets, label?:string, validate?:() => true|string, onTick?:Function}} o
       *  bets：練習模式按「發牌」前先 bets.validate()；兩種模式關閉時自動 bets.lock()。
       *  onClose({auto, ok, validation})：真實模式倒數結束 auto=true；ok=false 代表下注不合法（遊戲自行處理）。
       * @returns {{cancel(), close(), isOpen():boolean}}
       */
      bettingWindow(o = {}) {
        if (st.win) st.win.cancel();
        const seconds = o.seconds ?? def.countdown ?? 15;
        let closed = false, cd = null, btn = null;
        const h = {
          cancel() { closed = true; if (cd) cd.cancel(); if (btn) btn.remove(); if (st.win === h) st.win = null; },
          close() { fire(false); },
          isOpen: () => !closed,
        };
        const fire = (auto) => {
          if (closed || !st.alive) return;
          const validation = o.bets ? o.bets.validate() : { ok: true, errors: [], zh: '' };
          h.cancel();
          ctx.dealer.say('停止下注', 'No more bets');
          if (o.bets) o.bets.lock();
          if (o.onClose) o.onClose({ auto, ok: validation.ok, validation });
        };
        st.win = h;
        if (isReal) {
          ready.then(() => {
            if (closed || !st.alive) return;
            ctx.dealer.say('請下注', 'Place your bets');
            cd = LG.ui.countdown(seconds, { onTick: o.onTick, onDone: () => fire(true) });
          });
        } else {
          ctx.dealer.say('請下注', 'Place your bets');
          btn = el('button', { type: 'button', class: 'lg-btn lg-btn--primary lg-deal', dataset: { action: 'deal' }, html: o.label || '發牌 <i class="en">Deal</i>' });
          btn.addEventListener('click', () => {
            if (o.validate) { const r = o.validate(); if (r !== true) { toast(typeof r === 'string' ? r : '還不能發牌', { type: 'warn' }); return; } }
            if (o.bets) { const v = o.bets.validate(); if (!v.ok) { toast(v.zh, { type: 'warn' }); return; } }
            fire(false);
          });
          const slot = section.querySelector('[data-deal-slot]') || section.querySelector('.lg-actions') || windowBar;
          slot.prepend(btn);
        }
        return h;
      },

      /** 統一寫統計：教學不記；練習記 stats；真實記 stats + session */
      recordRound(r = {}) {
        st.lastNet = round2(r.net || 0);
        if (isTutorial || !st.alive) return;
        LG.stats.record(gameId, r);
        if (isReal) LG.stats.session.record(r);
      },

      /** 餘額 < 最低注：真實 → 「籌碼用完」覆蓋層（暫停自動下一局）；練習 → 提示可重置。回傳是否破產 */
      checkBroke() {
        if (isTutorial || !st.alive) return false;
        if (LG.bank.balance() >= limits.min - 1e-9) { st.practiceWarned = false; return false; }
        if (isReal) {
          if (!st.broke) { st.broke = true; brokeOverlay(); }
          return true;
        }
        if (!st.practiceWarned) {
          st.practiceWarned = true;
          LG.ui.modal({
            title: '籌碼不足 <i class="en">Low balance</i>',
            body: `<p>餘額 ${balText(LG.bank.balance())} 低於最低注 ${fmt(limits.min)}。練習模式可以隨時重置。</p>`,
            actions: [
              { label: '稍後', id: 'later' },
              { label: '重置籌碼 RM 1,000', id: 'reset-bank', primary: true, onClick: () => { LG.bank.reset(); st.practiceWarned = false; } },
            ],
          });
        }
        return true;
      },

      /** 下一局：真實 → 3 秒後自動（暫停/破產時延後）；練習/教學 → 立即呼叫 */
      nextRound(fn) {
        if (!st.alive) return;
        if (!isReal) { fn(); return; }
        st.pending = fn;
        if (st.paused || st.broke) return;
        later(runPending, 3000);
      },

      setVariant(id) { LG.router.go(R.href(gameId, mode, id)); },

      /** 練習模式提示面板（策略表等）；提示關閉或非練習模式時隱藏。null 清除 */
      strategyPanel(html) {
        st.strategyHtml = html ?? null;
        strategy.innerHTML = '';
        if (html !== null && html !== undefined) {
          strategy.appendChild(el('h3.lg-strategy__title', { html: '提示 <i class="en">Hints</i>' }));
          const body = el('div.lg-strategy__body');
          if (typeof html === 'string') body.innerHTML = html; else body.appendChild(html);
          strategy.appendChild(body);
        }
        paintHints();
      },

      /** Promise：LG.ms(ms) 後 resolve；instance 卸載後永不 resolve（流程自然停止） */
      wait(ms) { return new Promise((res) => { later(res, ms); }); },
      /** setTimeout(fn, LG.ms(ms))，卸載時自動清除 */
      later,
      /** LG.events.on，卸載時自動解除 */
      on(name, fn) { const off = LG.events.on(name, fn); st.offs.push(off); return off; },
    };
    st.ctx = ctx;
    cur = st;
    paintHints();

    // 選單
    menuB.addEventListener('click', () => {
      const s = LG.stats.get(gameId);
      const speak = !!LG.store.peek().settings.speak;
      LG.ui.modal({
        title: '選單 <i class="en">Menu</i>',
        body: `<h3>${def.name.zh}統計 <i class="en">Stats</i></h3>
          <dl class="lg-kv"><dt>局數</dt><dd>${s.rounds}</dd><dt>總下注</dt><dd>${fmt(s.wagered)}</dd>
          <dt>淨輸贏</dt><dd>${LG.money.fmtSigned(s.net)}</dd><dt>贏 / 輸 / 和</dt><dd>${s.wins} / ${s.losses} / ${s.pushes}</dd></dl>`,
        actions: [
          { id: 'speak', label: speak ? '關閉語音口令' : '開啟語音口令（真實模式）', onClick: () => { LG.store.update((x) => { x.settings.speak = !x.settings.speak; }); toast(LG.store.peek().settings.speak ? '已開啟語音口令' : '已關閉語音口令'); } },
          { id: 'reset-bank', label: '重置籌碼', onClick: () => { LG.ui.confirm('把籌碼重置為 RM 1,000？進度與統計不受影響。').then((ok) => { if (ok) { LG.bank.reset(); toast('籌碼已重置為 RM 1,000'); } }); } },
          { id: 'close', label: '關閉', primary: true },
        ],
      });
    });

    // ---------------------------------------------------------- 建立遊戲
    try {
      st.instance = def.create(ctx) || {};
      st.instance.mount && st.instance.mount(section);
      if (!section.dataset.ready) section.dataset.ready = '1';
      st.instance.onModeChange && st.instance.onModeChange(mode);
      if (variant && st.instance.onVariantChange) st.instance.onVariantChange(variant);
    } catch (e) {
      console.error('[LG.modes] 建立遊戲失敗', gameId, e);
      section.appendChild(el('div.lg-error', { text: '遊戲載入失敗：' + (e && e.message) }));
    }

    if (isTutorial && st.instance) {
      let steps = [];
      try { steps = (st.instance.tutorialSteps && st.instance.tutorialSteps()) || []; } catch (e) { console.error('[LG.modes] tutorialSteps', e); }
      LG.tutorial.run({
        gameId, steps, root: section, instance: st.instance, mount: tutorSlot,
        onFinish: () => LG.router.go(R.href(gameId, 'practice', variant)),
      });
    }

    if (isReal) {
      if (!continuing) LG.stats.session.start(gameId);
      if (continuing) readyResolve();
      else {
        st.entry = LG.ui.modal({
          title: '真實模式 <i class="en">Real mode</i>',
          body: `<p>真實模式：限注 <b>${limitsText(limits)}</b>，倒數 <b>${def.countdown ?? 15} 秒</b>，不會有解說。</p>
            <ul class="lg-list"><li>荷官說 <b>No more bets</b> 後，籌碼不能再碰。</li><li>結果只顯示輸贏金額。</li><li>籌碼用完就結束（可手動重置）。</li></ul>`,
          dismissable: false,
          actions: [
            { id: 'real-back', label: '回練習', onClick: () => { LG.router.go(R.href(gameId, 'practice', variant)); } },
            { id: 'real-start', label: '開始 <i class="en">Start</i>', primary: true, onClick: () => { readyResolve(); } },
          ],
        });
      }
    } else readyResolve();

    LG.events.emit('mode:change', { gameId, mode, variant });
    if (summary && summary.rounds > 0) showSummary(summary);
    return ctx;
  }

  /** 卸載目前遊戲；回傳真實模式 session 摘要（若有） */
  function teardown({ keepSession = false } = {}) {
    if (!cur) return null;
    const c = cur;
    cur = null;
    c.alive = false;
    c.timers.forEach((t) => clearTimeout(t));
    c.offs.forEach((off) => off());
    if (c.win) c.win.cancel();
    if (c.entry) c.entry.close();
    LG.tutorial.stop();
    try { c.instance && c.instance.unmount && c.instance.unmount(); } catch (e) { console.error('[LG.modes] unmount', c.gameId, e); }
    LG.ui.clearOverlays();
    if (c.mode === 'real' && !keepSession) return LG.stats.session.end();
    return null;
  }

  /** 離開遊戲頁（回首頁）；離開真實模式時顯示 session 摘要 */
  function close() {
    const s = teardown();
    if (s && s.rounds > 0) showSummary(s);
  }

  LG.modes = {
    MODE_INFO,
    open,
    close,
    current: () => (cur ? { gameId: cur.gameId, mode: cur.mode, variant: cur.variant } : null),
    ctx: () => (cur ? cur.ctx : null),
    instance: () => (cur ? cur.instance : null),
  };
})();
