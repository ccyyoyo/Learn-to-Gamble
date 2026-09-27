// LG.Bets（下注模型，純邏輯）+ LG.ui.betLayer（桌面點擊放籌碼）+ LG.ui.betBar（清除/重複上注/總注）
// 見 docs/02-architecture.md §3.2
//
// 金流約定（所有遊戲一致）：
//   下注階段「不扣款」；籌碼只是放在 Bets 模型上。可用餘額 = bank.balance() − bets.total()。
//   No more bets（bettingWindow 的 onClose）後由遊戲 ctx.bank.debit(bets.total())，
//   結算時 ctx.bank.credit(拿回金額含本金)。見 src/games/sicbo.js。
(() => {
  const LG = globalThis.LG;
  const { round2, fmt } = LG.money;
  const ui = (LG.ui = LG.ui || {});

  class Bets {
    /**
     * @param {{min?:number, max?:number, perSpotMin?:number, perSpotMax?:number,
     *          spotRules?:Object<string,{min?:number,max?:number,label?:string}>, labels?:Object<string,string>}} o
     *  min/max：整桌總注下限/上限；perSpotMin/perSpotMax：每格預設限額（省略時沿用 min/max）；
     *  spotRules：個別格覆寫（例：{tie:{min:10,max:500}}）。
     */
    constructor(o = {}) {
      this.min = o.min ?? 0;
      this.max = o.max ?? Infinity;
      this.perSpotMin = o.perSpotMin ?? this.min;
      this.perSpotMax = o.perSpotMax ?? this.max;
      this.spotRules = { ...(o.spotRules || {}) };
      this.labels = { ...(o.labels || {}) };
      this._amts = new Map();
      this._locked = false;
      this._subs = new Set();
      /** 最近一次 lock() 時的下注（供重複上注 Rebet） */
      this.last = null;
    }
    get locked() { return this._locked; }
    _notify() { for (const fn of [...this._subs]) { try { fn(this); } catch (e) { console.error('[LG.Bets]', e); } } }
    /** 訂閱任何變動（place/remove/clear/restore/lock/unlock）→ 取消訂閱函式 */
    subscribe(fn) { this._subs.add(fn); return () => this._subs.delete(fn); }
    labelOf(spot) { return (this.spotRules[spot] && this.spotRules[spot].label) || this.labels[spot] || spot; }
    /** 該格限額 {min,max} */
    limitFor(spot) {
      const r = this.spotRules[spot] || {};
      return { min: r.min ?? this.perSpotMin, max: r.max ?? this.perSpotMax };
    }
    /** 加注。檢查上限（不檢查餘額 — 呼叫端先 canAfford）。→ {ok, reason?, zh?, amount?} */
    place(spot, amount) {
      amount = round2(amount);
      if (!(amount > 0)) return { ok: false, reason: 'BAD_AMOUNT', zh: '金額不正確' };
      if (this._locked) return { ok: false, reason: 'LOCKED', zh: '已停止下注 <i class="en">No more bets</i>' };
      const next = round2(this.get(spot) + amount);
      const lim = this.limitFor(spot);
      if (next > lim.max + 1e-9) return { ok: false, reason: 'ABOVE_MAX', max: lim.max, zh: `此注上限 ${fmt(lim.max)}` };
      if (round2(this.total() + amount) > this.max + 1e-9) return { ok: false, reason: 'ABOVE_TABLE_MAX', max: this.max, zh: `本桌總注上限 ${fmt(this.max)}` };
      this._amts.set(spot, next);
      this._notify();
      return { ok: true, amount: next };
    }
    /** 移除 amount（省略 = 全部）。→ {ok, removed, amount} */
    remove(spot, amount) {
      if (this._locked) return { ok: false, reason: 'LOCKED', zh: '已停止下注 <i class="en">No more bets</i>' };
      const cur = this.get(spot);
      if (!cur) return { ok: false, reason: 'EMPTY', removed: 0, amount: 0 };
      const r = amount === undefined || amount === null ? cur : Math.min(cur, round2(amount));
      const left = round2(cur - r);
      if (left > 0) this._amts.set(spot, left); else this._amts.delete(spot);
      this._notify();
      return { ok: true, removed: r, amount: left };
    }
    /** 直接設定金額（不檢查限額、不管鎖定）— 給教學 setup / 遊戲內部加注（如 Play、Double）用 */
    set(spot, amount) {
      amount = round2(amount);
      if (amount > 0) this._amts.set(spot, amount); else this._amts.delete(spot);
      this._notify();
    }
    /** 清空（不管鎖定；結算後由遊戲呼叫） */
    clear() { if (this._amts.size) { this._amts.clear(); this._notify(); } }
    total() { let t = 0; for (const v of this._amts.values()) t += v; return round2(t); }
    get(spot) { return this._amts.get(spot) || 0; }
    /** [[spotId, amt]]（只含 > 0） */
    entries() { return [...this._amts.entries()]; }
    snapshot() { return Object.fromEntries(this._amts); }
    restore(snap) {
      if (this._locked) return { ok: false, reason: 'LOCKED' };
      this._amts = new Map(Object.entries(snap || {}).map(([k, v]) => [k, round2(v)]).filter(([, v]) => v > 0));
      this._notify();
      return { ok: true };
    }
    lock() { if (this.total() > 0) this.last = this.snapshot(); this._locked = true; this._notify(); }
    unlock() { this._locked = false; this._notify(); }
    /** → {ok, errors:[{spot, reason:'BELOW_MIN'|'ABOVE_MAX'|'EMPTY', limit}], zh} */
    validate() {
      const errors = [];
      if (this.total() <= 0) return { ok: false, errors: [{ spot: null, reason: 'EMPTY' }], zh: '請先下注 <i class="en">Place a bet</i>' };
      for (const [spot, amt] of this._amts) {
        const lim = this.limitFor(spot);
        if (amt < lim.min - 1e-9) errors.push({ spot, reason: 'BELOW_MIN', limit: lim.min, zh: `「${this.labelOf(spot)}」最低 ${fmt(lim.min)}` });
        else if (amt > lim.max + 1e-9) errors.push({ spot, reason: 'ABOVE_MAX', limit: lim.max, zh: `「${this.labelOf(spot)}」最高 ${fmt(lim.max)}` });
      }
      const t = this.total();
      if (!errors.length && t < this.min - 1e-9) errors.push({ spot: null, reason: 'BELOW_MIN', limit: this.min, zh: `總注最低 ${fmt(this.min)}` });
      if (t > this.max + 1e-9) errors.push({ spot: null, reason: 'ABOVE_MAX', limit: this.max, zh: `總注最高 ${fmt(this.max)}` });
      return { ok: errors.length === 0, errors, zh: errors.map((e) => e.zh).join('；') };
    }
  }
  LG.Bets = Bets;

  const LONG_PRESS = 500;

  /**
   * 桌面下注層：tableEl 內所有 [data-bet="spotId"] 可點。
   *  點一下 → 放 chipTray 目前面額；長按 500ms / 右鍵 → 移除一枚；鍵盤 Enter 放、Delete 移除。
   *  格子加 .is-disabled 或 data-bet-disabled 時不可下注（toast data-disabled-msg）。
   * @param {{bets:Bets, chipTray, bank?, onChange?(bets, info), disabledMsg?:string, gameId?:string,
   *          canPlace?(spotId, amount):true|string|false}} o
   * @returns {{refresh(), destroy(), clear(), rebet(), available():number}}
   */
  function betLayer(tableEl, o) {
    const { bets, chipTray, onChange, disabledMsg, gameId, canPlace } = o;
    const bank = o.bank || LG.bank;
    const toast = (t) => ui.toast(t, { type: 'warn' });
    const available = () => round2(bank.balance() - bets.total());
    const lockedMsg = () => disabledMsg || '停止下注後不能再碰籌碼 <i class="en">No more bets</i>';
    const findSpot = (t) => {
      const s = t && t.closest ? t.closest('[data-bet]') : null;
      return s && tableEl.contains(s) ? s : null;
    };
    const changed = (info) => { if (onChange) onChange(bets, info); };

    function add(spotEl) {
      const id = spotEl.dataset.bet;
      if (bets.locked) { toast(lockedMsg()); return; }
      if (spotEl.classList.contains('is-disabled') || spotEl.hasAttribute('data-bet-disabled')) {
        toast(spotEl.dataset.disabledMsg || '這一格目前不能下注'); return;
      }
      const amount = chipTray ? chipTray.selected() : 0;
      if (!amount) return;
      if (canPlace) {
        const r = canPlace(id, amount);
        if (r !== true && r !== undefined) { if (typeof r === 'string') toast(r); return; }
      }
      if (!bank.canAfford(round2(bets.total() + amount))) { toast('籌碼不足 <i class="en">Insufficient chips</i>'); return; }
      const res = bets.place(id, amount);
      if (!res.ok) { toast(res.zh || '不能下注'); return; }
      spotEl.classList.remove('is-bump'); void spotEl.offsetWidth; spotEl.classList.add('is-bump');
      changed({ spot: id, delta: amount });
    }
    function removeOne(spotEl) {
      const id = spotEl.dataset.bet;
      if (bets.locked) { toast(lockedMsg()); return; }
      const cur = bets.get(id);
      if (!cur) return;
      const d = chipTray ? chipTray.selected() : cur;
      const r = bets.remove(id, Math.min(cur, d || cur));
      if (r.ok) changed({ spot: id, delta: -r.removed });
    }

    let press = null;
    const cancelPress = () => { if (press) clearTimeout(press.timer); press = null; };
    const onDown = (ev) => {
      if (ev.button !== undefined && ev.button !== 0) return;
      const spot = findSpot(ev.target);
      if (!spot) return;
      cancelPress();
      press = { spot, x: ev.clientX, y: ev.clientY, fired: false };
      press.timer = setTimeout(() => { if (press) { press.fired = true; removeOne(spot); } }, LONG_PRESS);
    };
    const onMove = (ev) => { if (press && Math.hypot(ev.clientX - press.x, ev.clientY - press.y) > 10) cancelPress(); };
    const onUp = (ev) => {
      if (!press) return;
      const p = press; cancelPress();
      if (p.fired) return;
      const spot = findSpot(ev.target) || p.spot;
      if (spot === p.spot) add(spot);
    };
    const onCtx = (ev) => { const spot = findSpot(ev.target); if (!spot) return; ev.preventDefault(); cancelPress(); removeOne(spot); };
    const onKey = (ev) => {
      const spot = findSpot(ev.target);
      if (!spot || ev.target !== spot) return;
      if (ev.key === 'Enter' || ev.key === ' ') { ev.preventDefault(); add(spot); }
      else if (ev.key === 'Delete' || ev.key === 'Backspace') { ev.preventDefault(); removeOne(spot); }
    };
    tableEl.addEventListener('pointerdown', onDown);
    tableEl.addEventListener('pointermove', onMove);
    tableEl.addEventListener('pointerup', onUp);
    tableEl.addEventListener('pointercancel', cancelPress);
    tableEl.addEventListener('contextmenu', onCtx);
    tableEl.addEventListener('keydown', onKey);

    let persisted = null;
    function refresh() {
      tableEl.querySelectorAll('[data-bet]').forEach((spot) => {
        if (!spot.hasAttribute('tabindex')) spot.setAttribute('tabindex', '0');
        if (!spot.hasAttribute('role')) spot.setAttribute('role', 'button');
        const amt = bets.get(spot.dataset.bet);
        let h = null;
        for (const ch of spot.children) if (ch.classList && ch.classList.contains('lg-spot__stack')) h = ch;
        if (!h) { h = ui.el('div.lg-spot__stack'); spot.appendChild(h); }
        const prev = Number(spot.dataset.amount || 0);
        if (prev !== amt || (amt > 0) !== !!h.firstChild) {
          h.innerHTML = '';
          if (amt > 0) h.appendChild(ui.chipStack(amt));
        }
        spot.dataset.amount = String(amt);
        spot.classList.toggle('has-bet', amt > 0);
      });
      tableEl.classList.toggle('is-bets-locked', bets.locked);
      if (chipTray) chipTray.setAffordable(available());
      if (gameId && bets.last && bets.last !== persisted) {
        persisted = bets.last;
        LG.store.update((s) => { s.lastBets[gameId] = { ...persisted }; });
      }
    }
    const unsub = bets.subscribe(refresh);
    const offBank = LG.events.on('bank:change', refresh);
    refresh();

    return {
      refresh,
      available,
      /** 清除所有下注（鎖定時提示） */
      clear() {
        if (bets.locked) { toast(lockedMsg()); return false; }
        bets.clear(); changed({ clear: true }); return true;
      },
      /** 重複上一局下注（Rebet） */
      rebet() {
        if (bets.locked) { toast(lockedMsg()); return false; }
        const snap = bets.last || (gameId && LG.store.peek().lastBets[gameId]);
        const total = snap ? round2(Object.values(snap).reduce((a, b) => a + b, 0)) : 0;
        if (!total) { ui.toast('還沒有上一局的下注 <i class="en">No previous bet</i>'); return false; }
        if (!bank.canAfford(total)) { toast('籌碼不足 <i class="en">Insufficient chips</i>'); return false; }
        bets.restore(snap); changed({ rebet: true }); return true;
      },
      destroy() {
        cancelPress(); unsub(); offBank();
        tableEl.removeEventListener('pointerdown', onDown);
        tableEl.removeEventListener('pointermove', onMove);
        tableEl.removeEventListener('pointerup', onUp);
        tableEl.removeEventListener('pointercancel', cancelPress);
        tableEl.removeEventListener('contextmenu', onCtx);
        tableEl.removeEventListener('keydown', onKey);
        tableEl.querySelectorAll('.lg-spot__stack').forEach((x) => x.remove());
      },
    };
  }

  /**
   * （擴充）籌碼盤下方一列：[清除 Clear] [重複上注 Rebet]  總注 RM x
   * @returns {{destroy()}}
   */
  function betBar(container, { bets, layer }) {
    container.classList.add('lg-betbar');
    container.innerHTML = '';
    const clearB = ui.el('button', { type: 'button', class: 'lg-btn lg-btn--ghost lg-btn--sm', dataset: { action: 'clear' }, html: '清除 <i class="en">Clear</i>' });
    const rebetB = ui.el('button', { type: 'button', class: 'lg-btn lg-btn--ghost lg-btn--sm', dataset: { action: 'rebet' }, html: '重複上注 <i class="en">Rebet</i>' });
    const total = ui.el('span.lg-betbar__total', { dataset: { role: 'total' } });
    clearB.addEventListener('click', () => layer.clear());
    rebetB.addEventListener('click', () => layer.rebet());
    container.append(clearB, rebetB, ui.el('span.lg-betbar__sp'), total);
    const paint = () => {
      total.innerHTML = `總注 <i class="en">Total</i> <b>${fmt(bets.total())}</b>`;
      total.dataset.total = String(bets.total());
      clearB.disabled = bets.locked || bets.total() === 0;
      rebetB.disabled = bets.locked;
    };
    const unsub = bets.subscribe(paint);
    paint();
    return { destroy: unsub, refresh: paint };
  }

  ui.betLayer = betLayer;
  ui.betBar = betBar;
})();
