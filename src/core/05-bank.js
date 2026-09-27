// LG.bank — 虛擬籌碼餘額。見 docs/02-architecture.md §2.5
(() => {
  const LG = globalThis.LG;
  const { round2 } = LG.money;

  // 教學沙盒：教學模式用記憶體裡的示範籌碼（不寫 store、不動真實餘額）。LG.modes 進出教學時切換。
  let sandbox = null;
  function balance() { return sandbox ? sandbox.value : round2(LG.store.peek().bank); }

  function check(amount) {
    const a = round2(amount);
    if (!Number.isFinite(Number(amount)) || a < 0) throw Error('BAD_AMOUNT');
    return a;
  }

  function set(v, delta) {
    if (sandbox) sandbox.value = round2(v);
    else LG.store.update((s) => { s.bank = round2(v); });
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
    /** 只把餘額設回 RM 1,000（不清進度與統計）；沙盒中只重置示範籌碼 */
    reset() {
      const before = balance();
      set(LG.store.START_BANK, round2(LG.store.START_BANK - before));
      return balance();
    },
    /**
     * 教學沙盒。sandbox(1000) → 之後 balance/debit/credit 只作用在記憶體裡的示範籌碼；sandbox(null) → 回到真實餘額。
     * 切換時 emit 'bank:change'。
     */
    sandbox(amount) {
      const was = !!sandbox;
      sandbox = amount === null || amount === undefined ? null : { value: round2(amount) };
      if (was || sandbox) LG.events.emit('bank:change', { balance: balance(), delta: 0 });
      return balance();
    },
    /** 目前是否在教學沙盒 */
    isSandbox: () => !!sandbox,
  };
})();
