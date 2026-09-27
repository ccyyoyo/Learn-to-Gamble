# slot-classic 變更請求與實作備註（遊戲代理 G8）

## CR-1 真實模式進場 modal 寫「倒數 N 秒」，老虎機沒有倒數
- 需要：`LG.modes` 進場說明依 def 決定倒數文字，例如 def 擴充 `countdown: 0` 或 `noCountdown: true` 時改寫為「沒有倒數，按 SPIN 就轉」。
- 原因：老虎機不用 `ctx.bettingWindow`（玩家自己按 SPIN），但進場 modal 固定顯示 `倒數 ${def.countdown ?? 15} 秒`。
- 暫時做法：`mount()` 後以 microtask 找到 `[data-action="real-start"]` 所在 modal，改寫第一段 `<p>` 為「每轉 RM 0.10 – RM 25.00，沒有倒數，按 SPIN 就轉」。核心修正後可刪掉這段。

## CR-2 老虎機不適用 bettingWindow / nextRound
- 下注：用 `LG.slotView.betPanel`（面額 = lineBets `[0.1,0.2,0.5,1,2,5]`，注數 = lines `[1..5]`），不用籌碼盤與 betLayer，def 省略 `denoms`。
- 每轉：`bank.debit(押注)` → 轉 → `bank.credit(贏分)` → `ctx.recordRound` → `ctx.explain` → `ctx.checkBroke()`（最低注 RM 0.10）。
- 真實模式：`ctx.ready` resolve 前 SPIN 停用；不倒數、不自動下一局，所以不呼叫 `ctx.nextRound`。
- 餘額付不起目前押注時 SPIN 停用，並提示一次「餘額不足」toast。
- 轉到一半離開（unmount）：退回已扣未結算的押注（照 CR-A1）。

## 假設（規格未明寫）
- 練習模式限注 `{min: 0.10, max: 25}`（00-common 的練習 RM 10 起不適用於 RM 0.10 起的老虎機；否則餘額 < RM 10 就會跳破產提示）。
- 「任意一個發 1×」= 拿回押注、淨 0，統計記為 push。
- `LG.slotView.create` 的 `symbols[k].svg` 欄位實際是 innerHTML，本遊戲拿來放「發 + 顏色小字」的 HTML（色弱也能分辨金/紅/藍）。

## 轉軸帶調整結果（RTP 目標 90% ± 0.5%）
起點（每軸 32 停：金 1、紅 2、藍 4、空白 25）精確 RTP = 88.42%，偏低。以精確計算搜尋每軸組成（軸長 32–36），選定：

| 軸 | 停點 | 金 | 紅 | 藍 | 空白 | 序列 |
|---|---|---|---|---|---|---|
| 1 | 32 | 1 | 1 | 6 | 24 | `XXGXXXBXXXBXXXRXXXBXXXBXXXBXXXBX` |
| 2 | 35 | 2 | 2 | 5 | 26 | `XRXXXBXXXGXXXBXXXBXXXRXXXBXXXGXXXBX` |
| 3 | 32 | 1 | 1 | 3 | 27 | `XXXBXXXXXRXXXXXXBXXXXXGXXXXXBXXX` |

- 精確 RTP（35,840 種停點組合全列舉）= **90.0000%**；命中率（含 1×）53.0%。
  - 各組合貢獻：金金金 5.58%、紅紅紅 1.12%、藍藍藍 12.56%、混色三發 7.42%、兩發 22.68%、一發 40.65%。
- `LG.slots.simulateRTP`：seed 4、500,000 轉 = **90.135%**（單元測試 `[slow]`）；seed 123、4,000,000 轉 = 89.787%。
- 注意：1000× 頭獎使每轉標準差約 8 倍押注，500k 轉標準誤約 1.1%——不同 seed 的 500k 結果可能落在 88–92%。因此測試同時驗「精確值 = 90% ± 0.5%」（快測試）與「固定 seed 模擬在 89.5–90.5%」（慢測試）。
