# Learn-to-Gamble 賭場遊戲練習場

單一 HTML 檔（`index.html`，由 `node build.mjs` 從 `src/` 合併產生）的賭場新手練習場。
繁中介面附英文術語、虛擬籌碼 RM 1,000、17 款遊戲 × 3 種模式（教學 / 練習 / 真實）。

## 必讀文件（SDD）
- `docs/00-index.md` 文件索引與閱讀順序
- `docs/02-architecture.md` 模組結構與 **API 合約**（所有程式必須遵守）
- `docs/05-game-rules/<game>.md` 每款遊戲的規則、賠率、桌面配置、教學大綱、驗收條件
- `docs/08-wbs.md` 三層任務拆解與負責代理
- `docs/09-agent-playbook.md` 子代理工作規範（檔案所有權、建置、測試、完成定義）

## 指令
- `node build.mjs` → 產生 `index.html`（離線可開）
- `npm test` → Node 單元測試（`tests/unit/*.test.mjs`）
- `npm run e2e` → Playwright 煙霧測試（`tests/e2e/*.mjs`，用全域 playwright，需 `NODE_PATH=$(npm root -g)`）

## 硬規則
- 不引入任何外部依賴或 CDN；純 vanilla JS（ES2020）+ CSS。
- 遊戲模組只能寫 `src/games/<id>.js`、`src/games/<id>.css`、`tests/unit/<id>.test.mjs`、`tests/e2e/<id>.mjs`。
- 需要改核心（`src/core/*`）時，寫 `docs/change-requests/<id>.md`，不要直接改。
- 金額一律 RM，數值以「元」為單位的浮點數，顯示用 `LG.money.fmt()`。
