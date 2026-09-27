# 10 遊戲代理工作簡報（Wave 2 每個遊戲代理必讀）

你是 Learn-to-Gamble 的遊戲代理，負責派給你的遊戲。工作目錄 /home/user/Learn-to-Gamble。核心平台已完成，你只寫自己的遊戲模組。

## 先讀（依序，全部讀完再動手）
1. CLAUDE.md、docs/09-agent-playbook.md（檔案所有權、DoD、禁止事項）
2. docs/02-architecture.md（API 合約：§3 LG.ui / LG.Bets / LG.slotView、§4 遊戲插件介面與 ctx、§5 教學步驟格式）
3. docs/03-ui-spec.md、docs/06-tutorial-guide.md、docs/05-game-rules/00-common.md
4. 你的規格書：docs/05-game-rules/<你的遊戲 id>.md —— 賠率、限注、桌面 ASCII 圖、data-bet spotId、教學大綱、驗收測試都以它為準，不得改數字。
5. 實際核心程式：src/core/20-ui.js、21-bets.js、32-modes.js、31-tutorial.js、30-registry.js（以及你會用到的 lib：派工訊息列出的 src/core/1x-*.js）。程式為準；若與合約不一致，寫 docs/change-requests/<你的遊戲 id>.md 說明並用能動的方式繞過。
6. 範本：參考 src/games/sicbo.js 與 sicbo.css（完整走完三模式、下注格、教學與提示的標準桌遊，照它的結構寫；示範遊戲 _demo 已於 Wave 3 刪除）。
7. 核心代理給的使用提示：docs/core-notes.md（若存在）。

## 你只能建立/修改
src/games/<id>.js、src/games/<id>.css、tests/unit/<id>*.test.mjs、tests/e2e/<id>.mjs、docs/change-requests/<id>.md（每個派給你的 id 各一組）。
其他檔案一律不碰（其他 10 個遊戲代理同時在同一目錄工作，碰別人的檔會互相覆蓋；index.html 由 build 產生，不要手改）。

## 交付（DoD，全部達成才回報）
- 三模式（tutorial / practice / real）皆可進入、完整玩一局、無 console error；`root.dataset.ready='1'` 在 mount 完成時設定。
- 桌面用 CSS 畫出規格 ASCII 圖的配置；每個下注格 `data-bet` 齊全，格內顯示中文 + 英文 + 賠率。手機 390px 不溢出（桌面可內部橫捲）。
- 教學：步數 ≥ 規格要求、四段（layout/flow/payout/strategy）齊、≥ 3 個 action 步、每步 highlight 指向存在的元素、遵守 06-tutorial-guide（一步一事、術語格式、算式格式、不能碰籌碼、不教迷信、預算）。
- 練習：局末 ctx.explain({hand, result, formula, why}) 四段內容具體正確；ctx.hints 開啟時顯示建議（規格 §「練習模式提示」）。
- 真實：規格限注、ctx.bettingWindow 倒數與口令、只顯示金額、ctx.checkBroke()。
- houseEdge 陣列與 00-common.md 一致（含 best: true）。
- 單元測試 tests/unit/<id>*.test.mjs 覆蓋規格「驗收測試」每一條（用 loadLG({games:['<id>']}) 載入；Monte Carlo 類放名稱含 [slow] 的測試）；e2e tests/e2e/<id>.mjs 照 07-test-plan §3 慣例（用 tests/e2e/_helpers.mjs）。
- 文案集中在檔案頂部 T 物件；不留 console.log；不用 alert。

## 流程
node build.mjs && npm test && npm run e2e <id> 全綠才算完成。不要 commit。
最後回報（精簡）：完成項目 / 未完成與原因 / change-requests / 測試結果最後幾行。
