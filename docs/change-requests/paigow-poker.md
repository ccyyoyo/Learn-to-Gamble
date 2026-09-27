# paigow-poker 變更請求與實作假設

## CR-1 Fortune 旁注限注（規格未寫）
- 需要：在 `docs/05-game-rules/paigow-poker.md` §6 / `00-common.md` §3 補上 Fortune Bonus 限注。
- 原因：規格只寫主注 RM 50–3,000，Fortune 旁注沒有限額。
- 暫時做法：真實模式 Fortune **RM 10–500**（比照其他撲克桌遊旁注級距）；練習/教學沿用 RM 10–100,000。
  Fortune 不能單獨押：練習按「發牌」時擋下並提示；真實模式倒數結束若只押 Fortune，這局不發牌、提示後保留籌碼到下一局。
  常數在 `src/games/paigow-poker.js` 的 `FORTUNE_REAL`。

## CR-2 Fortune 旁注的莊家優勢（排行榜表未列）
- 需要：`00-common.md` §4 的 paigow-poker 備註欄補「Fortune 旁注 ≈ 8.6%（模擬）」。
- 原因：教學 strategy 段「每注優勢表」與「別押」步需要數字，規格只說「Fortune 旁注貴」。
- 暫時做法：以 Monte Carlo（240 萬手，規格 §3 賠付表、7 張最佳牌型）估得 ≈ 8.6%，在教學與提示中標「≈ 8.6%（模擬）」；
  `houseEdge` 陣列仍只放規格的「玩家不做莊 2.84%（best）」，沒有自行加列。`[slow]` 測試驗證 6%–11%。

## CR-3 `LG.ui.actionBar().set()` 會洗掉教學高亮（核心 A）
- 需要：`actionBar` 的 `paint()` 重設 `className` 時保留非 `lg-btn*` 的 class（至少 `lg-spot--hl`）。
- 原因：教學步驟高亮「確認 Set」按鈕後，只要呼叫 `set('set', {disabled})`，`.lg-spot--hl` 就被移除，金框消失。
- 暫時做法：遊戲內用 `bar.button(id)` 直接改 `disabled` / `hidden` 屬性，不呼叫 `set()`。

## 實作備註（無需處理）
- 三條 A 含小丑時，`LG.paigow.houseWay` 把**小丑**拆到低手（當 A），與「拆一張 A 放低」等值；單元測試照 lib 行為寫。
- 規格優勢 2.84% 保持不變；雙方都用房規的 Monte Carlo 約 2.3%、push 約 40.7%（lib 備註），落在驗收區間 2–4% / 38–44%。
- 真實模式排牌 60 秒用 `LG.ui.countdown`（與下注倒數共用同一個顯示位），逾時自動套房規並送出，toast「排牌逾時」。
