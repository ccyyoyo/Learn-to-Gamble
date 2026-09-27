// LG.tutorial — 教學步驟引擎（底部工作表）。見 docs/02-architecture.md §5、docs/06-tutorial-guide.md
//
// step = { id, section:'layout'|'flow'|'payout'|'strategy', title, body(html), highlight:[selector]|null,
//          setup(instance)?, action:{label, check(instance) → true | false | '提示字串'}? }
// 有 action 的步驟：check 通過前「下一步」鎖住（點了會顯示提示）。
// 前進時 progress.markStep；最後一步按鈕「完成！去練習模式」→ onFinish()。
(() => {
  const LG = globalThis.LG;
  const { el, term } = LG.ui;

  const SECTIONS = [
    { id: 'layout', zh: '桌面', en: 'Layout' },
    { id: 'flow', zh: '流程', en: 'Flow' },
    { id: 'payout', zh: '賠率', en: 'Payout' },
    { id: 'strategy', zh: '策略', en: 'Strategy' },
  ];

  let active = null;

  /**
   * @param {{gameId:string, steps:Array, root?:Element, instance?:object, onFinish?:Function, mount?:Element}} o
   * @returns {{go(i), next(), prev(), index():number, stop(), el:Element}}
   */
  function run({ gameId, steps, root, instance, onFinish, mount }) {
    stop();
    steps = (steps || []).filter(Boolean);
    const N = steps.length;
    const host = mount || document.querySelector('.lg-tutor-slot') || document.body;
    let i = 0, timer = 0, passed = false, dead = false;

    const tabs = el('div.lg-tutor__tabs', { role: 'tablist' });
    const secBtns = SECTIONS.map((s) => {
      const first = steps.findIndex((st) => st.section === s.id);
      const b = el('button', { type: 'button', class: 'lg-tutor__tab', dataset: { tutorSection: s.id }, html: term(s.zh, s.en), disabled: first < 0 });
      b.addEventListener('click', () => { if (first >= 0) go(first); });
      tabs.appendChild(b);
      return b;
    });
    const count = el('span.lg-tutor__count');
    const bar = el('div.lg-tutor__bar', [el('span')]);
    const title = el('h3.lg-tutor__title');
    const body = el('div.lg-tutor__body');
    const action = el('div.lg-tutor__action');
    const prevB = el('button', { type: 'button', class: 'lg-btn lg-btn--ghost', dataset: { tutor: 'prev' }, html: '上一步 <i class="en">Back</i>' });
    const nextB = el('button', { type: 'button', class: 'lg-btn lg-btn--primary', dataset: { tutor: 'next' } });
    const minB = el('button', { type: 'button', class: 'lg-tutor__min', 'aria-label': '收起/展開教學', text: '▾' });
    const sheet = el('div.lg-tutor', { role: 'region', 'aria-label': '教學 Tutorial' }, [
      el('div.lg-tutor__top', [tabs, minB]),
      el('div.lg-tutor__head', [title, count]),
      bar,
      el('div.lg-tutor__scroll', [body, action]),
      el('div.lg-tutor__nav', [prevB, nextB]),
    ]);
    prevB.addEventListener('click', () => prev());
    nextB.addEventListener('click', () => next());
    minB.addEventListener('click', () => {
      sheet.classList.toggle('is-min');
      minB.textContent = sheet.classList.contains('is-min') ? '▴' : '▾';
    });
    host.appendChild(sheet);
    document.body.classList.add('lg-has-tutor');

    function evalCheck() {
      const st = steps[i];
      if (!st || !st.action) return true;
      let r;
      try { r = st.action.check ? st.action.check(instance) : true; }
      catch (e) { console.error('[tutorial] check', st.id, e); r = false; }
      return r;
    }

    function paintAction() {
      const st = steps[i];
      if (!st.action) { action.hidden = true; action.innerHTML = ''; nextB.classList.remove('is-locked'); nextB.removeAttribute('aria-disabled'); return; }
      action.hidden = false;
      const r = evalCheck();
      if (r === true) passed = true;
      action.classList.toggle('is-done', passed);
      const hint = passed ? '✓ 完成！<i class="en">Done</i>' : (typeof r === 'string' ? r : '完成上面的動作後即可下一步');
      action.innerHTML = `<div class="lg-tutor__todo"><span class="lg-tutor__badge">${passed ? '✓' : '試試看'}</span> ${st.action.label}</div><div class="lg-tutor__hint">${hint}</div>`;
      nextB.classList.toggle('is-locked', !passed);
      if (passed) nextB.removeAttribute('aria-disabled'); else nextB.setAttribute('aria-disabled', 'true');
    }

    function paint() {
      const st = steps[i];
      sheet.dataset.step = st.id || String(i);
      sheet.dataset.index = String(i);
      sheet.dataset.section = st.section || '';
      title.innerHTML = st.title || '';
      body.innerHTML = st.body || '';
      count.textContent = `${i + 1} / ${N}`;
      bar.firstChild.style.width = `${((i + 1) / N) * 100}%`;
      secBtns.forEach((b, k) => b.classList.toggle('is-active', SECTIONS[k].id === st.section));
      prevB.disabled = i === 0;
      nextB.innerHTML = i === N - 1 ? '完成！去練習模式 <i class="en">Practice</i>' : '下一步 <i class="en">Next</i>';
      nextB.dataset.last = i === N - 1 ? '1' : '0';
      paintAction();
    }

    function go(k) {
      if (dead || !N) return;
      i = Math.max(0, Math.min(N - 1, k));
      passed = false;
      clearInterval(timer);
      const st = steps[i];
      LG.ui.highlight(null);
      if (st.setup) {
        try { st.setup(instance); } catch (e) { console.error('[tutorial] setup', st.id, e); }
      }
      paint();
      // 等 DOM 更新後再高亮
      requestAnimationFrame(() => { if (!dead && steps[i] === st) LG.ui.highlight(st.highlight || null); });
      if (st.action) timer = setInterval(() => { if (!passed) paintAction(); }, 250);
      const sc = sheet.querySelector('.lg-tutor__scroll');
      if (sc) sc.scrollTop = 0;
    }

    function next() {
      if (dead) return;
      const st = steps[i];
      if (st.action && !passed) {
        paintAction();
        if (!passed) {
          nextB.classList.remove('is-shake'); void nextB.offsetWidth; nextB.classList.add('is-shake');
          const r = evalCheck();
          LG.ui.toast(typeof r === 'string' ? r : `先完成：${st.action.label}`, { type: 'warn' });
          return;
        }
      }
      LG.progress.markStep(gameId, i, N);
      if (i === N - 1) {
        LG.ui.toast('教學完成！<i class="en">Tutorial complete</i>');
        const fin = onFinish;
        stop();
        if (fin) fin();
        return;
      }
      go(i + 1);
    }
    function prev() { if (i > 0) go(i - 1); }

    const onKey = (ev) => {
      if (ev.target && /INPUT|TEXTAREA|SELECT/.test(ev.target.tagName)) return;
      if (document.querySelector('.lg-modal-backdrop')) return;
      if (ev.key === 'ArrowRight') next(); else if (ev.key === 'ArrowLeft') prev();
    };
    document.addEventListener('keydown', onKey);

    function stopThis() {
      if (dead) return;
      dead = true;
      clearInterval(timer);
      document.removeEventListener('keydown', onKey);
      LG.ui.highlight(null);
      sheet.remove();
      document.body.classList.remove('lg-has-tutor');
      if (active === ctl) active = null;
    }

    const ctl = { go, next, prev, index: () => i, steps, el: sheet, stop: stopThis, root };
    active = ctl;
    if (N) go(0);
    return ctl;
  }

  function stop() { if (active) active.stop(); }

  /** 檢查步驟是否符合寫作規範（≥12 步、四段、≥3 action）→ {ok, problems[]}；遊戲測試可用 */
  function lint(steps, { minSteps = 12, minActions = 3 } = {}) {
    const problems = [];
    if (steps.length < minSteps) problems.push(`步數 ${steps.length} < ${minSteps}`);
    SECTIONS.forEach((s) => { if (!steps.some((x) => x.section === s.id)) problems.push(`缺少段落 ${s.id}`); });
    const acts = steps.filter((x) => x.action).length;
    if (acts < minActions) problems.push(`action 步 ${acts} < ${minActions}`);
    steps.forEach((x, k) => {
      if (!x.title) problems.push(`第 ${k + 1} 步缺 title`);
      if (!('highlight' in x)) problems.push(`第 ${k + 1} 步（${x.id}）未設定 highlight（無高亮請寫 null）`);
    });
    // 段落順序必須 layout → flow → payout → strategy
    const order = steps.map((x) => SECTIONS.findIndex((s) => s.id === x.section));
    for (let k = 1; k < order.length; k++) if (order[k] < order[k - 1]) { problems.push('段落順序應為 layout → flow → payout → strategy'); break; }
    return { ok: problems.length === 0, problems };
  }

  LG.tutorial = { run, stop, lint, SECTIONS, current: () => active };
})();
