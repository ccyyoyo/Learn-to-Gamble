# Learn-to-Gamble 賭場遊戲練習場

用虛擬籌碼學賭場遊戲的單一 HTML 網頁。繁體中文介面，每個術語附英文（例如「停止下注 No more bets」），讓第一次去雲頂（Genting）等賭場的人先弄懂規則、賠率、桌面禮儀和莊家優勢，再決定要不要上桌。

- 17 款遊戲，每款都有 **教學 / 練習 / 真實** 三種模式
- 虛擬籌碼 RM 1,000，可隨時重置；**沒有真錢、不連網**
- 賠率、限注以雲頂大眾區常見設定為基準（近似），現場以桌上標示為準

## 怎麼開

直接用瀏覽器開 `index.html`（雙擊即可）。整個網站只有這一個檔案，不用安裝、不用網路，手機和電腦都能用。進度與餘額存在瀏覽器的 localStorage。

## 17 款遊戲

| 分類 | 遊戲 |
|---|---|
| 桌遊 Table Games | 百家樂 Baccarat（傳統 / 免佣 Super 6 / 老虎 / 咪牌）、21 點 Blackjack、輪盤 Roulette（單零）、骰寶 Sic Bo、三公 Three Pictures、番攤 Fan Tan |
| 撲克桌遊 Poker Table Games | 加勒比撲克 Caribbean Stud、三張撲克 Three Card Poker、賭場德州撲克 Casino Hold'em、終極德州撲克 Ultimate Texas Hold'em、牌九撲克 Pai Gow Poker |
| 老虎機 Slots | 3 軸經典機、5 軸 20 線影片機、Hold & Spin 機、四級累積獎金機、視訊撲克 Jacks or Better 9/6 |
| 撲克室 Poker Room | 德州撲克現金桌（No Limit，跟 AI 對打，賭場抽水） |

首頁有「莊家優勢排行榜」，從最划算的 21 點（基本策略 0.41%）排到經典老虎機（10%）。

## 三種模式

| 模式 | 用途 |
|---|---|
| **教學 Tutorial** | 一步一件事：桌面每一格、一局的流程、賠付怎麼算、該押與別押。用 RM 1,000 示範籌碼，不影響你的餘額。 |
| **練習 Practice** | 自由玩，每局結束顯示「牌型 → 結果 → 賠付計算式 → 為什麼」；可開提示（策略建議、機率、優勢）。 |
| **真實 Real** | 照現場限注與倒數：荷官喊 Place your bets / No more bets，時間到就鎖注，結果只顯示輸贏金額；籌碼用完就結束，離開時顯示本次統計。 |

## 開發

純 vanilla JS（ES2020）＋ CSS，沒有外部依賴。原始碼在 `src/`，建置時合併成 `index.html`。

```bash
node build.mjs        # src/ → index.html（離線單檔，< 1.5 MB）
npm test              # 單元測試（node --test，不含 [slow] 模擬）
npm run test:slow     # 含 Monte Carlo / RTP 模擬
npm run e2e           # Playwright e2e（用全域 playwright；可加遊戲 id：npm run e2e sicbo）
```

- `src/core/`：核心平台（`LG` 命名空間：rng、money、store、bank、stats、牌庫與各遊戲邏輯庫、UI 元件、三模式框架、教學引擎、路由、首頁）
- `src/games/<id>.js|css`：每款遊戲一個模組（`LG.registerGame`），寫法可參考 `src/games/sicbo.js`
- `tests/unit/`、`tests/e2e/`：單元測試與 e2e
- `index.html`：建置產物，不要手改

## 文件

| 文件 | 內容 |
|---|---|
| [docs/00-index.md](docs/00-index.md) | 文件索引與閱讀順序 |
| [docs/01-prd.md](docs/01-prd.md) | 產品需求 |
| [docs/02-architecture.md](docs/02-architecture.md) | 架構與 API 合約 |
| [docs/03-ui-spec.md](docs/03-ui-spec.md) | UI 規格 |
| [docs/04-data-model.md](docs/04-data-model.md) | 資料模型（localStorage） |
| [docs/05-game-rules/](docs/05-game-rules/00-common.md) | 共用規則、限注、莊家優勢總表，以及 17 份遊戲規格 |
| [docs/06-tutorial-guide.md](docs/06-tutorial-guide.md) | 教學寫作規範 |
| [docs/07-test-plan.md](docs/07-test-plan.md) | 測試計畫與手動驗收清單 |
| [docs/08-wbs.md](docs/08-wbs.md) | 工作拆解 |
| [docs/09-agent-playbook.md](docs/09-agent-playbook.md) | 代理工作規範 |
| [docs/change-requests/](docs/change-requests/README.md) | 變更請求與協調者決議 |
| [docs/spec-audit.md](docs/spec-audit.md) | 規格一致性審查 |
| [docs/acceptance-report.md](docs/acceptance-report.md) | 驗收報告與已知限制 |
| [docs/screens/](docs/screens/) | 手機 390×844 截圖（首頁與 17 款遊戲） |

## 聲明

本站只供學習，沒有真錢，也不鼓勵賭博。每種賭場遊戲長期下來都是莊家贏；上桌前先設好預算，輸完就走。
