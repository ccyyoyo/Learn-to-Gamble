# 09 子代理工作手冊（每個子代理開工前必讀）

## 0. 你的角色
你是 Opus 子代理，負責 `docs/08-wbs.md` 指派給你的 L3 任務。協調者（主代理）負責整合。沒有人會即時回答你的問題：**依規格書做決定，把假設寫進 `docs/change-requests/<你的id>.md` 或程式註解**。

## 1. 開工順序
1. 讀 `CLAUDE.md`、`docs/02-architecture.md`（API 合約）、`docs/03-ui-spec.md`、`docs/06-tutorial-guide.md`、`docs/09-agent-playbook.md`（本文）。
2. 讀你負責的 `docs/05-game-rules/<id>.md` 與 `docs/05-game-rules/00-common.md`。
3. 讀實際核心程式 `src/core/*.js`（以程式為準；若程式與合約不符，合約優先並寫 change-request）。
4. 看 `src/games/` 有沒有已完成的遊戲可參考結構（例如先完成的 `baccarat.js`）。

## 2. 檔案所有權（嚴格）
| 你是 | 只能建立/修改 |
|------|------|
| 核心代理 A（runtime/UI） | `src/core/00-06,20-22,30-33,40,50,core.css`、`build.mjs`、`package.json`、`tests/unit/_load.mjs`、`tests/e2e/_helpers.mjs`、`tests/e2e/_run.mjs`、`tests/e2e/home.mjs`、`tests/unit/core-*.test.mjs` |
| 核心代理 B（libs） | `src/core/10-16.js`、`tests/unit/lib-*.test.mjs` |
| 遊戲代理 `<id>` | `src/games/<id>.js`、`src/games/<id>.css`、`tests/unit/<id>*.test.mjs`、`tests/e2e/<id>.mjs`、`docs/change-requests/<id>.md`、可在 `docs/05-game-rules/<id>.md` 補充「實作備註」段 |
| 整合代理 | 全部（修 bug、統一風格），但不改規格中的數字 |
其他檔案**不要碰**。多個代理同時在同一目錄工作，碰別人的檔會互相覆蓋。

## 3. 建置與測試
- 每次改完：`node build.mjs && npm test`。e2e：`npm run e2e <id>`。
- `index.html` 由 build 產生；**不要手改**。
- 不加 npm 依賽。Playwright 用全域（`NODE_PATH=$(npm root -g)`），Chromium 在 `/opt/pw-browsers`，勿 `playwright install`。
- 用 `LG.rng.seed(123)` 讓模擬測試可重現。慢測試（> 3 秒）放 `*.sim.test.mjs`。

## 4. 遊戲模組骨架
```js
(() => {
  const T = {  // 文案集中
    banker: {zh:'莊', en:'Banker'},
  };
  LG.registerGame({
    id: '<id>', category: '...', order: N, name: {...}, summary: '...',
    houseEdge: [...], limits: {...}, denoms: [...], variants: [...],
    create(ctx) {
      const state = {...};
      let root, bets, tray, layer;
      function buildTable() {...}          // 一次建好，之後只更新
      function startRound() {...}          // ctx.bettingWindow → deal → settle
      function settle() { ...; ctx.recordRound({...}); ctx.explain({...}); ctx.checkBroke(); }
      return {
        mount(el) { root = el; buildTable(); root.dataset.ready = '1'; },
        unmount() { /* 清 timers */ },
        tutorialSteps() { return [...]; },  // ≥ 12 步，四段
        demo: { /* 教學 setup 用的方法：擺牌、顯示橫幅 */ },
        bets,  // 讓教學 action.check 能讀
      };
    }
  });
})();
```

## 5. 完成定義（DoD）— 全部達成才回報
- [ ] 三模式皆可進入、可玩完整一局、無 console error（e2e 驗證）。
- [ ] 教學 ≥ 12 步（撲克室 ≥ 16）、四段齊、≥ 3 個 action、每步有 highlight 或明確 `null`。
- [ ] 練習模式 resultPanel 四段（牌型/結果/賠付計算式/為什麼）內容正確、提示開關有效。
- [ ] 真實模式：規格限注、倒數、口令、只顯示金額、破產覆蓋層。
- [ ] 桌面每格有中文 + 英文 + 賠率，`data-bet` 齊全，與規格 ASCII 圖一致。
- [ ] 單元測試涵蓋規格「驗收測試」每一條；模擬測試優勢/RTP 落在規格區間。
- [ ] `houseEdge` 數值與 `00-common.md` 一致（三公用模擬值）。
- [ ] 手機寬 390px 版面不溢出。
- [ ] 回報格式：完成項目 / 未完成與原因 / change-requests 清單 / 測試結果摘要（貼 `npm test` 最後幾行）。

## 6. 禁止
- 不改核心檔（除核心/整合代理）。不改別人的遊戲。不改規格數字（賠率、限注、優勢）。
- 不用 `alert/confirm/prompt`；用 `LG.ui.modal/confirm`。
- 不留 `console.log`（可用 `LG.debug()`）。
- 不 commit（協調者統一 commit）。
