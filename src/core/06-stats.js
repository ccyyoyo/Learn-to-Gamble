// LG.stats / LG.progress — 統計與教學進度。見 docs/02-architecture.md §2.6、docs/04-data-model.md
(() => {
  const LG = globalThis.LG;
  const { round2 } = LG.money;
  const EMPTY = () => ({ rounds: 0, wagered: 0, net: 0, wins: 0, losses: 0, pushes: 0 });

  function outcomeOf(o, net) {
    if (o === 'win' || o === 'lose' || o === 'push') return o;
    return net > 0 ? 'win' : net < 0 ? 'lose' : 'push';
  }

  function apply(t, { wagered = 0, net = 0, outcome }) {
    const o = outcomeOf(outcome, net);
    t.rounds += 1;
    t.wagered = round2(t.wagered + Number(wagered || 0));
    t.net = round2(t.net + Number(net || 0));
    if (o === 'win') t.wins += 1; else if (o === 'lose') t.losses += 1; else t.pushes += 1;
  }

  // ---- 真實模式 session（記憶體；end() 時寫入 store.sessions，最多 20 筆）----
  let cur = null;
  const session = {
    start(gameId) {
      cur = { gameId, startedAt: Date.now(), endedAt: 0, rounds: 0, wagered: 0, net: 0,
        maxWin: 0, maxLoss: 0, wins: 0, losses: 0, pushes: 0, broke: false, startBalance: LG.bank.balance() };
      return { ...cur };
    },
    record(r) {
      if (!cur) return null;
      apply(cur, r);
      const net = round2(r.net || 0);
      if (net > cur.maxWin) cur.maxWin = net;
      if (net < cur.maxLoss) cur.maxLoss = net;
      return { ...cur };
    },
    markBroke() { if (cur) cur.broke = true; },
    /** 結束並寫入歷史；回傳摘要（無 session → null） */
    end() {
      if (!cur) return null;
      cur.endedAt = Date.now();
      const done = { ...cur };
      const rec = { gameId: done.gameId, startedAt: done.startedAt, endedAt: done.endedAt, rounds: done.rounds,
        wagered: done.wagered, net: done.net, maxWin: done.maxWin, maxLoss: done.maxLoss, broke: done.broke };
      LG.store.update((s) => { s.sessions.push(rec); if (s.sessions.length > 20) s.sessions = s.sessions.slice(-20); });
      cur = null;
      return done;
    },
    current() { return cur ? { ...cur } : null; },
  };

  LG.stats = {
    /** outcome: 'win'|'lose'|'push'（省略則依 net 判斷） */
    record(gameId, r) {
      LG.store.update((s) => { apply(s.stats[gameId] || (s.stats[gameId] = EMPTY()), r); });
      LG.events.emit('stats:change', { gameId });
      return LG.stats.get(gameId);
    },
    get(gameId) { return { ...EMPTY(), ...(LG.store.peek().stats[gameId] || {}) }; },
    session,
  };

  LG.progress = {
    /** 標記教學第 stepIndex 步（0 起算）已完成；全部完成時寫 completedAt */
    markStep(gameId, stepIndex, totalSteps) {
      LG.store.update((s) => {
        const p = s.progress[gameId] || (s.progress[gameId] = { steps: [], total: totalSteps, completedAt: null });
        if (totalSteps) p.total = totalSteps;
        if (!p.steps.includes(stepIndex)) p.steps.push(stepIndex);
        p.steps.sort((a, b) => a - b);
        const n = p.steps.filter((i) => i >= 0 && i < p.total).length;
        if (!p.completedAt && p.total > 0 && n >= p.total) p.completedAt = Date.now();
      });
      LG.events.emit('progress:change', { gameId });
    },
    /** 0–100 整數 */
    pct(gameId) {
      const p = LG.store.peek().progress[gameId];
      if (!p || !p.total) return 0;
      if (p.completedAt) return 100;
      const n = p.steps.filter((i) => i >= 0 && i < p.total).length;
      return Math.min(100, Math.round((n / p.total) * 100));
    },
    isComplete(gameId) {
      const p = LG.store.peek().progress[gameId];
      return !!(p && p.completedAt);
    },
    get(gameId) {
      const p = LG.store.peek().progress[gameId];
      return p ? JSON.parse(JSON.stringify(p)) : { steps: [], total: 0, completedAt: null };
    },
  };
})();
