// LG.bank — 虛擬籌碼餘額。見 docs/02-architecture.md §2.5
(() => {
  const LG = globalThis.LG;
  const { round2 } = LG.money;

  function balance() { return round2(LG.store.peek().bank); }

  function check(amount) {
    const a = round2(amount);
    if (!Number.isFinite(Number(amount)) || a < 0) throw Error('BAD_AMOUNT');
    return a;
  }

  function set(v, delta) {
    LG.store.update((s) => { s.bank = round2(v); });
    LG.events.emit('bank:change', { balance: balance(), delta });
  }

  LG.bank = {
    balance,
    canAfford(amount) { return round2(amount) <= balance() + 1e-9; },
    /** 扣款；餘額不足 throw Error('INSUFFICIENT') */
    debit(amount) {
      const a = check(amount);
      if (a === 0) return balance();
      if (a > balance() + 1e-9) throw Error('INSUFFICIENT');
      set(balance() - a, -a);
      return balance();
    },
    /** 入帳（派彩含本金） */
    credit(amount) {
      const a = check(amount);
      if (a === 0) return balance();
      set(balance() + a, a);
      return balance();
    },
    /** 只把餘額設回 RM 1,000（不清進度與統計） */
    reset() {
      const before = balance();
      set(LG.store.START_BANK, round2(LG.store.START_BANK - before));
      return balance();
    },
  };
})();
