# 07 測試計畫

## 1. 層級
| 層 | 工具 | 位置 | 誰寫 |
|----|------|------|------|
| 單元（純邏輯） | `node --test` | `tests/unit/<module>.test.mjs` | 核心代理（lib）、遊戲代理（各自結算/策略） |
| 模擬（EV/RTP） | 同上，`LG.rng.seed()` 固定 | 同檔或 `<id>.sim.test.mjs`（標記 `slow`，`npm run test:slow`） | 遊戲代理 |
| e2e 煙霧 | Playwright（全域）開 `file://index.html` | `tests/e2e/<id>.mjs`，`tests/e2e/_run.mjs` 依序執行 | 遊戲代理；核心寫 `home.mjs` |
| 手動驗收 | 檢查表 | 本文 §4 | 整合代理 |

## 2. 載入器 `tests/unit/_load.mjs`
- 依檔名排序讀 `src/core/*.js`（可指定子集）與指定 `src/games/<id>.js`，以 `vm.runInThisContext` 執行；提供最小 DOM stub（`document.createElement` 回傳簡易物件）讓 UI 檔不崩潰；匯出 `LG`。
- 測試檔開頭：`import { loadLG } from './_load.mjs'; const LG = loadLG({ games: ['baccarat'] });`

## 3. e2e 慣例（`tests/e2e/_helpers.mjs`）
- `openGame(page, id, mode)` → 導向 `#/game/<id>/<mode>`，等待 `.lg-game[data-ready="1"]`。
- `placeChip(page, spotId, denom)`：點籌碼 → 點 `[data-bet="spotId"]`。
- `balance(page)` 讀 topbar 餘額數字。
- 測試前 `localStorage.clear()`；設 `window.LG_TEST = true` 讓動畫時間 ×0.1（核心需支援 `LG.speed`）。
- 每個遊戲 e2e 必含：三模式皆可進入且 `data-ready`；練習模式完成一局並出現 `.lg-result`；教學模式前 3 步可前進且 highlight 元素存在；真實模式出現倒數與口令。

## 4. 手動驗收清單（整合代理逐項打勾，寫入 `docs/acceptance-report.md`）
- [ ] `index.html` 雙擊離線可開（file://），無 console error。
- [ ] 手機 390×844 檢視：無橫向溢出（桌面允許內部橫捲），觸控目標 ≥ 44px。
- [ ] 首頁：四區、17 張卡、完成度環、餘額、排行榜由低到高、撲克室在最下。
- [ ] 每款遊戲：教學 ≥ 12 步、四段齊、≥ 3 個 action；練習 resultPanel 四段；真實：倒數/口令/只顯金額/破產覆蓋層。
- [ ] 重整頁面後餘額、進度、統計保留。重置籌碼只重置餘額。
- [ ] 所有金額顯示 `RM` 前綴且千分位。
- [ ] 英文術語出現在每個下注格。
- [ ] 老虎機轉軸有動畫、Pay Table 按鈕開表。
- [ ] `index.html` < 1.5 MB。

## 5. 指令
```
npm run build        # node build.mjs
npm test             # node --test tests/unit  （排除 *.sim.test.mjs）
npm run test:slow    # 含模擬
npm run e2e          # NODE_PATH=$(npm root -g) node tests/e2e/_run.mjs [id]
```
