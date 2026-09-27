# slot-holdspin 變更請求與實作備註

## CR-1 真實模式進場說明寫「倒數 15 秒」（核心 32-modes.js）
- 需要：老虎機（`category === 'slots'`）的真實模式進場 modal 不提倒數，改寫「每轉按旋轉、只顯示輸贏金額」；或 def 可設 `countdown: 0` 時隱藏該句。
- 原因：老虎機依派工要求真實模式不倒數（不用 `ctx.bettingWindow`），但 modal 文字固定為 `倒數 ${def.countdown ?? 15} 秒`。
- 暫時做法：不處理（文字小瑕疵，不影響流程）。

## CR-2 規格矛盾：MINOR（總注 × 50）在總注 > RM 10 時大於固定 RM 500 的 MAJOR，且固定金額獎池讓 RTP 隨注額劇烈變動
- 規格：MINOR = 總注 × 50（以總注換算）；MAJOR 種子 RM 500、GRAND 種子 RM 5,000（固定金額）；RTP 94.5%。
- 問題：特色中每格 8% 落球 + 3 次重置規則，使約 2% 的特色會填滿 15 格。若 GRAND 為固定 RM 5,000，總注 RM 2 時 GRAND 約佔 RTP 17%，總注 RM 100 時只佔 0.3%——同一台機器 RTP 會從約 95% 掉到約 78%；而且總注 RM 100 時 MINOR（RM 5,000）遠大於 MAJOR（RM 500）。
- 我的決定（沒有改任何數字）：比照規格對 MINOR 的「以總注換算」，**MAJOR / GRAND 也以總注 RM 2 為基準等比換算**：
  - `store.jackpots['slot-holdspin'] = {major, grand}` 存的是「總注 RM 2 時」的金額，種子 500 / 5,000（與 `LG.store` 預設相同）。
  - 顯示與派彩 = 儲存值 × 總注 ÷ RM 2（總注 RM 2 時就是 RM 500 / RM 5,000）。
  - 每轉成長：在該注額下看到的金額 +總注 × 0.5%（MAJOR）/ × 1%（GRAND），即儲存值每轉 +0.01 / +0.02。
  - 結果：任何注額 RTP 都是 94.5%，且 MINOR < MAJOR < GRAND（50× / 250× / 2,500× 總注）永遠成立。賠付表有文字說明。
- 若協調者要「固定 RM」版本：改 `jackpots.at()` / `grow()` 與 `exactRTP` 的 GRAND/MAJOR 單位即可（約 10 行），但須同時改規格 RTP 說明。

## 實作備註
- 20 線（規格允許以 `LINES_20` 簡化）；總注 = 20 × 每線注（RM 0.10–5），限注 RM 2–100（練習/真實同）。
- 基礎符號與賠付表同 slot-video（財神 50/200/1000…、龍 WILD 只在第 2–4 軸），**不含 Scatter 免費轉**：本機的特色就是 Hold & Spin，金球取代 Scatter 的角色。
- 規格 §5 寫「四個獎金牌」，但 §4 只有 MINOR / MAJOR / GRAND 三級 → 畫三塊。
- 金球以「2 連方塊 + 兩顆單球」放在每軸帶上（必須能疊，否則一軸最多 1 顆、永遠湊不到 6 顆）。觸發約 1/298 轉；15 格全滿約 1/15,025 轉。
- 基礎盤面金球面額用同一分佈（規格只寫特色中的分佈）。
- 結果在按下旋轉時就全部決定（含整段 Hold & Spin）；動畫中離開頁面會照樣入帳並把中獎的獎池回種子（`unmount` → `finalize`），但該轉不寫 stats（ctx 已卸載）。
- 老虎機不用 `ctx.bettingWindow` / `ctx.nextRound`：旋轉鍵在結算後立即可按（真實模式不倒數、不自動開局）。每轉 `bank.debit(總注)` → 結算 `bank.credit(總贏)` → `ctx.recordRound` → `ctx.explain` → `ctx.checkBroke()`。
- RTP 驗證：`logic.exactRTP()` 用轉軸帶精確算線獎、金球數分佈，並把特色視為「已鎖 k 顆、剩 l 次」的馬可夫鏈精確計算 → **94.57%**（單元測試要求 94.5 ± 0.1）。`[slow]` 測試跑 `simulateRTP` 20 萬轉（seed 8）：線獎、再轉、數字球 / MINOR 都實際模擬，MAJOR / GRAND 以種子期望計（GRAND 1/15,000 轉、2,500 倍總注，照抽的話 20 萬轉的結果會上下跳 ±4%）。
