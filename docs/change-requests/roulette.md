# 輪盤 Roulette（G3）— 假設、規格差異與給核心的建議

## R1 規格數字不一致：「157 種內注」與「3 首三」
規格 §8 寫「157 種內注：37 直 + 60 分（含 0）+ 12 街 + 3 首三 + 22 角 + 1 首四 + 11 線 + 外注」。
- 歐式單零桌只有 **2 個三數（Trio）**：0-1-2、0-2-3（沒有第三個與 0 相鄰的三號組合）。
- 實作：**內注 145 種**（37 + 60 + 12 + 2 + 22 + 1 + 11）+ **外注 12 種**（紅黑、單雙、大小、3 打、3 列）= **157 個 `data-bet`**。
  「157」正好是內注 + 外注的總數，推測規格原意如此；單元測試與 e2e 以 157 / 145 / 2 驗證。
- 規格未給三數的 spotId：採用 `trio-0-1-2`、`trio-0-2-3`（賠 11:1）。首四照規格用 `corner-0`。
- 建議：規格 §8 改為「157 個下注格：145 內注（…+ 2 三數 …）+ 12 外注」。

## R2 真實模式限注的補充假設
規格只給：外注 RM 25–3,000、內注每格 RM 10、內注合計 ≥ RM 25、直注上限 RM 500。
- 其他內注（分、街、三數、角、首四、線）每格上限未規定 → 採 **RM 3,000（本桌上限）**，不另創數字。
- 「內注合計 ≥ RM 25」在混合下注（有外注也有內注）時同樣適用。
- 實作：真實模式的 `LG.Bets` 用 `spotRules` 設每格上下限，並在 instance 上覆寫 `bets.validate()` 加入「內注合計」檢查（框架的 `bettingWindow` 會呼叫它）。
- `def.limits.real = {min: 25, max: 3000}`（進場說明、破產判斷用；最低可成立的一局 = RM 25）。
- 建議（核心）：`LG.Bets` 增加 `validateExtra(bets) → errors[]` 選項，免得各遊戲覆寫 `validate`。

## R3 真實模式倒數與「最後 5 秒喊 No more bets」
框架的 `bettingWindow` 只在倒數歸零時喊 No more bets。輪盤規格要「倒數 20 秒、球在轉時仍可下注、末 5 秒喊 No more bets」，實作：
1. `bettingWindow({seconds: 20, onTick})`；剩 10 秒時發球（球在外軌自轉，仍可下注）。
2. 剩 5 秒：遊戲自己 `dealer.say('停止下注','No more bets')` + `bets.lock()`，球開始 3 秒（× LG.speed）減速落格。
3. 倒數歸零：框架照常 `validate → onClose`（此時再喊一次 No more bets，隨即被報號覆蓋，看不出來）→ 扣款、結算、派彩。
- 建議（核心）：`bettingWindow` 增加 `closeAt`（剩 N 秒時鎖注並喊口令，倒數繼續跑到 0 才 onClose）。

## R4 桌面標示
- 號碼格內顯示「號碼 + 35:1」；37 個號碼格若都塞中英文會擠爆手機寬度，改為桌面上方一行圖例
  「點號碼正中 = 直注 Straight 35:1；點格線上的小圓點 = 分注 Split 17:1、街注…」。
- 熱區（24px 圓點）不放文字，`title` / `aria-label` 帶「中文 英文 賠率」。外注格皆有中文 + 英文 + 賠率。

## R5 核心 CSS：`.lg-spot--hl` 會把元素設成 `position: relative`
格線熱區是 `position:absolute`，被教學高亮時會跑位。已在 `roulette.css` 用較高權重選擇器蓋回（`.rl-board .rl-hs.lg-spot--hl { position:absolute }`）。
- 建議（核心）：`.lg-spot--hl` 只在元素原本是 `static` 時才需要 relative；可改成 `:where(.lg-spot--hl)` 降低權重，或不設定 position。

## R6 流程細節（設計決定）
- 練習/教學：結算後延遲 1.5 秒（× LG.speed）才開下一局，讓荷官報號（「17 黑 單 / Seventeen black odd」）停留在橫幅上。
- Dolly：真實模式在下一局開始（3 秒後）才拿走，期間籌碼維持鎖定（「dolly 沒拿走不能碰籌碼」）；練習/教學則在玩家一碰桌面（改注）時拿走。
- 真實模式倒數結束時下注不合法（例：紅 RM 10、內注合計不足）：球照轉、號碼照記錄，但該注不成立、不扣款，toast 說明原因（`validation.zh`）。
- 派彩順序（結果面板計算式）：外注 → 內注。
- `prefers-reduced-motion`：不播球的 3 秒動畫，直接顯示結果。

## R7 測試備註
- 其他遊戲代理同時 `node build.mjs` 會覆寫共用的 `index.html`（且可能含未完成的遊戲），造成 e2e 在「等 data-ready」時偶發逾時。
  本遊戲的 e2e 另以「只含 core + roulette」的隔離建置驗證全綠；整合階段請在所有遊戲穩定後重跑 `npm run e2e roulette`。
