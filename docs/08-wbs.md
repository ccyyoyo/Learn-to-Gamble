# 08 三層任務拆解（WBS）與代理分派

層級：**L1 里程碑 → L2 功能 → L3 小任務**。每個 L3 任務可由一個子代理在一個工作階段內完成，並有明確驗收。
執行波次：Wave 1（M0，2 個代理平行）→ Wave 2（M1–M4，11 個代理平行）→ Wave 3（M5，1–2 個代理）。

---
## L1 · M0 平台核心（Wave 1）

### L2 · F0.1 建置與工程骨架 — 核心代理 A
- T0.1.1 `build.mjs`：合併 `src/core/*.js`（檔名序）+ `src/games/*.js`（檔名序）+ 所有 css → `index.html`；內含 `<meta viewport>`、`<title>`、離線可開；輸出大小報告。驗收：`node build.mjs` 產生可開的檔。
- T0.1.2 `package.json` scripts（build/test/test:slow/e2e）、`tests/unit/_load.mjs`（vm 載入 + DOM stub）、`tests/e2e/_helpers.mjs`、`tests/e2e/_run.mjs`。驗收：`npm test` 在空測試下通過；e2e 可開首頁。
- T0.1.3 `LG.speed` 測試加速（`window.LG_TEST` → 動畫時長 ×0.1）。

### L2 · F0.2 狀態與資料 — 核心代理 A
- T0.2.1 `LG.rng`（含 seed）、`LG.money`、`LG.events`。
- T0.2.2 `LG.store`（schema v1、migrate、localStorage 不可用 fallback）。
- T0.2.3 `LG.bank`、`LG.stats`（含 session）、`LG.progress`。驗收：`tests/unit/core-store.test.mjs` 覆蓋 reset/debit 不足/session 摘要。

### L2 · F0.3 UI 元件庫 — 核心代理 A
- T0.3.1 `core.css` 設計系統（變數、topbar/modebar/table/actions/chips 版面、`.lg-card` 撲克牌樣式 4 花色、籌碼樣式 6 面額、highlight 動畫、resultPanel、modal、toast、countdown、dealer banner）。
- T0.3.2 `LG.ui`：el/card/flip/squeezeable/toast/modal/confirm/chipTray/chipStack/dealer.say/countdown/resultPanel/payoutFlash/highlight/table/tabs/actionBar。
- T0.3.3 `LG.Bets` + `LG.ui.betLayer`（點放、長按移除、上限/餘額檢查、鎖注、snapshot/restore）。驗收：`core-bets.test.mjs`。
- T0.3.4 `LG.slotView`（轉軸 rAF 動畫、逐軸停、highlight/lock、setSymbolValue、paytableButton、betPanel）。

### L2 · F0.4 框架與首頁 — 核心代理 A
- T0.4.1 `LG.registerGame`/`LG.games`/`LG.categories`；`LG.router`（hash）。
- T0.4.2 `LG.modes`：建 ctx（explain/dealer/bettingWindow/recordRound/checkBroke/strategyPanel/hints）、模式列、變體列、真實模式進場 modal 與離場 session 摘要、破產覆蓋層。
- T0.4.3 `LG.tutorial`：底部工作表、上一步/下一步/段落跳轉、spotlight、action check、progress 寫入、完成頁。
- T0.4.4 首頁：四區卡片、完成度環、餘額/重置、莊家優勢排行榜（低→高，撲克室最下）、頁尾。
- T0.4.5 `50-app.js` 啟動、`tests/e2e/home.mjs`、示範遊戲 `src/games/_demo.js`（極簡「猜大小」，用來驗證 ctx/教學/三模式全流程，整合階段刪除）。

### L2 · F0.5 遊戲邏輯函式庫 — 核心代理 B
- T0.5.1 `LG.cards`（牌、牌靴、parse）。
- T0.5.2 `LG.baccarat`（點數、第三張牌表、dealCoup、settle 三變體含老虎旁注）。驗收：70 格規則表測試、Monte Carlo 機率。
- T0.5.3 `LG.blackjack`（value、STRATEGY_TABLE 依規格、basicStrategy、dealerPlay S17）。
- T0.5.4 `LG.poker`（eval5/best/compare/eval3/equity/outs/describe；效能：best(7) ≥ 200k/秒）。
- T0.5.5 `LG.paigow`（含小丑評牌、houseWay 9 條、isValidSplit、compare）。
- T0.5.6 `LG.slots`（spin/LINES_20/evalLines/countScatter/simulateRTP）、`LG.dice`。
- 驗收：`tests/unit/lib-*.test.mjs` 全綠；文件化 JSDoc。

---
## L1 · M1 桌遊（Wave 2）

### L2 · F1.1 百家樂 — 代理 G1 → `baccarat`
- T1.1.1 桌面（大眾桌 layout、旁注列依變體切換、珠盤路）。
- T1.1.2 一局流程（發牌動畫、第三張、唱牌、結算）+ 四變體 settle 接線。
- T1.1.3 咪牌模式（squeezeable 掀牌後才唱牌）。
- T1.1.4 教學 ≥ 14 步、練習提示、真實模式限注/倒數。
- T1.1.5 測試（單元：settle 情境；e2e：四變體）。

### L2 · F1.2 21 點 — 代理 G2 → `blackjack`
- T1.2.1 半圓桌、5 座位、印字、保險線。
- T1.2.2 流程：保險、BJ、Hit/Stand/Double/Split（≤ 4 手）、莊 S17。
- T1.2.3 策略表渲染（三表）、提示、resultPanel 引用表。
- T1.2.4 教學 ≥ 14 步含手勢；真實模式。
- T1.2.5 測試（分牌情境、Monte Carlo 優勢）。

### L2 · F1.3 輪盤 — 代理 G3 → `roulette`
- T1.3.1 歐式 layout（直式手機版）+ 內注熱區 157 個 + 外注。
- T1.3.2 SVG 輪盤動畫、dolly、歷史號碼。
- T1.3.3 結算全部注型；教學（每種內注放法一步）；真實模式。
- T1.3.4 測試（spot→號碼集合、派彩）。

### L2 · F1.4 骰寶 + 三公 + 番攤 — 代理 G4 → `sicbo`, `three-pictures`, `fantan`
- T1.4.1 骰寶檯面 + 骰盅動畫 + 全注型結算 + 教學 + 測試（216 枚舉）。
- T1.4.2 三公桌 + 三位置 + 比牌規則 + Monte Carlo 優勢寫入 + 教學 + 測試。
- T1.4.3 番攤方桌 + 番/念/角/三門/單雙熱區 + 撥扣動畫 + 佣金結算 + 教學 + 測試。

---
## L1 · M2 撲克桌遊（Wave 2）

### L2 · F2.1 Caribbean Stud + Three Card Poker — 代理 G5
- T2.1.1 `caribbean-stud`：桌面、合格規則、賠付表、累積獎金（store）、策略提示、教學、測試。
- T2.1.2 `three-card-poker`：桌面、Ante/Play + Pair Plus 獨立結算、Q-6-4 提示、教學、測試。

### L2 · F2.2 Casino Hold'em + Ultimate Texas Hold'em — 代理 G6
- T2.2.1 `casino-holdem`：桌面、flop 決策、合格 44、Ante 賠付表、AA 旁注、教學、測試。
- T2.2.2 `ultimate-holdem`：三階段狀態機、Blind/Trips 表、策略提示、教學、測試。

### L2 · F2.3 Pai Gow Poker — 代理 G7 → `paigow-poker`
- T2.3.1 7 張排牌 UI（點牌移到低手）、Foul 檢查、House Way 按鈕。
- T2.3.2 莊家房規排牌、比較、佣金結算、Fortune 旁注（可選）。
- T2.3.3 教學 ≥ 14 步、真實 60 秒、測試。

---
## L1 · M3 老虎機與視訊撲克（Wave 2）

### L2 · F3.1 經典 3 軸 + 影片 5 軸 — 代理 G8 → `slot-classic`, `slot-video`
- T3.1.1 `slot-classic`：strips 調到 RTP 90%、單線 UI、Pay Table、教學、測試。
- T3.1.2 `slot-video`：符號/strips 調到 RTP 94%、20 線亮線、Wild/Scatter/免費轉、Pay Table、教學、測試。

### L2 · F3.2 Hold & Spin + 累積獎金 — 代理 G9 → `slot-holdspin`, `slot-progressive`
- T3.2.1 `slot-holdspin`：金球、鎖球、再轉 3 次重置、GRAND 填滿、獎池 store、RTP 94.5%、教學、測試。
- T3.2.2 `slot-progressive`：JACKPOT 符號、輪盤 modal、四級獎池成長/重置、MAX BET ONLY、RTP 92%、教學、測試。

### L2 · F3.3 視訊撲克 — 代理 G10 → `video-poker`
- T3.3.1 9/6 賠付表 UI（欄高亮）、HOLD/DRAW、皇家 5 枚 4000。
- T3.3.2 15 條持牌策略 + 提示；教學；Monte Carlo RTP 測試。

---
## L1 · M4 撲克室（Wave 2）

### L2 · F4.1 德州撲克現金桌 — 代理 G11 → `poker-room`
- T4.1.1 牌局引擎：座位、按鈕、盲注、行動順序、最小加注、all-in、邊池、攤牌分池、抽水。
- T4.1.2 AI 三性格（equity + 底池賠率 + 隨機）。
- T4.1.3 UI：橢圓桌、動作列與滑桿、手牌歷程、買入/離桌。
- T4.1.4 教學 ≥ 16 步、練習提示（勝率/底池賠率）、真實 30 秒倒數、session 統計。
- T4.1.5 測試：邊池、抽水、100 手自動對戰守恆。

---
## L1 · M5 整合與驗收（Wave 3）

### L2 · F5.1 整合 — 整合代理 I1
- T5.1.1 處理所有 `docs/change-requests/*.md`；刪 `_demo.js`；統一風格（色、字級、術語）。
- T5.1.2 跑全部單元 + e2e；修錯；手機 390px 逐款檢視截圖（Playwright）存 `docs/screens/`。
- T5.1.3 手動驗收清單（`07-test-plan.md §4`）→ `docs/acceptance-report.md`。
- T5.1.4 首頁排行榜數值對照 `00-common.md`；`index.html` 大小 < 1.5 MB。

### L2 · F5.2 規格一致性審查 — 審查代理 I2（可與 I1 平行）
- T5.2.1 逐款對照規格書：賠率表、限注、教學四段與步數、桌面 data-bet 齊全；產出 `docs/spec-audit.md` 缺陷清單交 I1 修。

---
## 依賴
- Wave 2 全部依賴 M0 完成（API 存在且 `_demo.js` 三模式可玩）。
- G8/G9 依賴 `LG.slotView`、`LG.slots`；G5–G7、G10、G11 依賴 `LG.poker`；G7 依賴 `LG.paigow`；G1 依賴 `LG.baccarat` 與 `LG.ui.squeezeable`；G2 依賴 `LG.blackjack`。
- Wave 3 依賴 Wave 2 全部回報。

## 分派總表
| 代理 | 模型 | 任務 | 產出檔 |
|------|------|------|------|
| 核心 A | opus | F0.1–F0.4 | `src/core/{00-06,20-22,30-33,40,50}.js`, `core.css`, `build.mjs`, `package.json`, tests 骨架, `_demo.js` |
| 核心 B | opus | F0.5 | `src/core/{10-16}.js`, `tests/unit/lib-*.test.mjs` |
| G1 | opus | F1.1 | `baccarat` |
| G2 | opus | F1.2 | `blackjack` |
| G3 | opus | F1.3 | `roulette` |
| G4 | opus | F1.4 | `sicbo`, `three-pictures`, `fantan` |
| G5 | opus | F2.1 | `caribbean-stud`, `three-card-poker` |
| G6 | opus | F2.2 | `casino-holdem`, `ultimate-holdem` |
| G7 | opus | F2.3 | `paigow-poker` |
| G8 | opus | F3.1 | `slot-classic`, `slot-video` |
| G9 | opus | F3.2 | `slot-holdspin`, `slot-progressive` |
| G10 | opus | F3.3 | `video-poker` |
| G11 | opus | F4.1 | `poker-room` |
| I1 / I2 | opus | F5.1 / F5.2 | 全域修正、報告 |
