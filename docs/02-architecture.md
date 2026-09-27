# 02 架構與 API 合約

> 本文件是所有代理的**契約**。核心代理實作這些 API；遊戲代理只能依賴這些 API。
> 簽名若需變動，寫 `docs/change-requests/<id>.md`，由協調者決定。

## 1. 建置模型：多檔開發、單檔交付

```
src/
  core/            # 核心平台（核心代理擁有）
    00-namespace.js   # globalThis.LG = {}；LG.VERSION
    01-rng.js         # LG.rng
    02-money.js       # LG.money
    03-events.js      # LG.events
    04-store.js       # LG.store（localStorage）
    05-bank.js        # LG.bank
    06-stats.js       # LG.stats / LG.progress
    10-cards.js       # LG.cards（牌、牌靴）
    11-baccarat-lib.js# LG.baccarat（點數、第三張牌規則）
    12-blackjack-lib.js# LG.blackjack（手牌值、基本策略）
    13-poker-lib.js   # LG.poker（5/7 張評牌、3 張、勝率）
    14-paigow-lib.js  # LG.paigow（含小丑、房規排牌）
    15-slot-engine.js # LG.slots（轉軸、賠付線、RTP 模擬）
    16-dice.js        # LG.dice
    20-ui.js          # LG.ui（DOM 元件）
    21-bets.js        # LG.Bets（下注模型）+ LG.ui.betLayer
    22-slot-view.js   # LG.slotView（轉軸動畫、Pay Table）
    30-registry.js    # LG.registerGame / LG.games / LG.categories
    31-tutorial.js    # LG.tutorial（教學步驟引擎）
    32-modes.js       # LG.modes（三模式框架、ctx 建構）
    33-router.js      # LG.router（hash 路由）
    40-home.js        # 首頁
    50-app.js         # 啟動
    core.css          # 設計系統 + 核心元件樣式
  games/
    <id>.js           # LG.registerGame({...})
    <id>.css
build.mjs             # 合併 → index.html（core 依檔名排序，games 依檔名排序，css 全部內嵌）
index.html            # 產物，需 commit（離線可直接開）
tests/unit/*.test.mjs # node --test；用 tests/unit/_load.mjs 載入 src 檔到 globalThis.LG
tests/e2e/*.mjs       # playwright，開 file://index.html
```

- 每個 src 檔是一段「頂層腳本」（非 ESM），只能透過 `LG.*` 互相溝通，**不得**宣告全域變數（請用 IIFE 包住：`(() => { ... })();`）。
- 載入順序 = 檔名排序；遊戲檔在所有核心檔之後。
- 不用任何外部依賴、CDN、字型下載。

## 2. 命名空間 `LG` — 核心函式庫（純邏輯，無 DOM，可在 Node 測試）

### 2.1 `LG.rng`
```js
LG.rng.random()            // [0,1)，預設 crypto.getRandomValues
LG.rng.int(min, max)       // 整數，含兩端
LG.rng.shuffle(arr)        // Fisher–Yates，原地打亂並回傳
LG.rng.pick(arr)
LG.rng.seed(n)             // 切換為可重現的 PRNG（mulberry32），供測試；seed(null) 還原
```

### 2.2 `LG.money`
```js
LG.money.fmt(n, {cents} = {})   // 'RM 1,000'；有小數或 cents=true → 'RM 0.10'
LG.money.round2(n)              // 避免浮點誤差，所有加減後都要 round2
LG.money.add(a,b) / sub(a,b) / mul(a,b)
```

### 2.3 `LG.events`
```js
LG.events.on(name, fn) → off函式 ; LG.events.off(name, fn) ; LG.events.emit(name, payload)
// 內建事件：'bank:change' {balance}, 'route:change' {route}, 'mode:change' {gameId, mode},
//           'store:reset', 'progress:change' {gameId}
```

### 2.4 `LG.store`（見 `04-data-model.md`）
```js
LG.store.get()                  // 整份 state（唯讀複本）
LG.store.update(fn)             // fn(draft) 內修改，之後自動 save
LG.store.reset()                // 回到初始 state（含餘額 RM 1,000）
LG.store.KEY === 'lg.v1'
```

### 2.5 `LG.bank`
```js
LG.bank.balance()
LG.bank.canAfford(amount)
LG.bank.debit(amount)   // 不足 → throw Error('INSUFFICIENT')；成功 emit 'bank:change'
LG.bank.credit(amount)
LG.bank.reset()         // 回到 1000
```

### 2.6 `LG.stats` / `LG.progress`
```js
LG.stats.record(gameId, {wagered, net, outcome})   // outcome: 'win'|'lose'|'push'
LG.stats.get(gameId)   // {rounds, wagered, net, wins, losses, pushes}
LG.stats.session       // 真實模式本次統計：start(gameId) / record(...) / end() / current()
LG.progress.markStep(gameId, stepIndex, totalSteps)
LG.progress.pct(gameId)          // 0–100
LG.progress.isComplete(gameId)
```

### 2.7 `LG.cards`
```js
// 牌物件：{rank:'A', suit:'S', id:'AS'}  rank ∈ '2'..'9','T','J','Q','K','A'；suit ∈ S,H,D,C
// 小丑：{rank:'X', suit:'J', id:'XJ'}
LG.cards.RANKS, LG.cards.SUITS
LG.cards.newDeck({jokers=0})              // 52(+jokers) 張，未洗
LG.cards.newShoe(decks, {cutCard=14})     // → Shoe
Shoe.draw() ; Shoe.remaining() ; Shoe.needsShuffle() ; Shoe.shuffle() ; Shoe.burn(n)
LG.cards.rankValue(card)   // 2..14（A=14）
LG.cards.label(card)       // 'A♠'
LG.cards.suitName(suit)    // {zh:'黑桃', en:'Spades', symbol:'♠', color:'black'|'red'}
LG.cards.parse('AS') / LG.cards.parseMany('AS KH 7D')  // 測試用
```

### 2.8 `LG.baccarat`
```js
LG.baccarat.point(card)              // A=1, 2–9 面值, T/J/Q/K=0
LG.baccarat.total(cards)             // (Σpoint) % 10
LG.baccarat.playerDraws(pTotal)      // 0–5 抽
LG.baccarat.bankerDraws(bTotal, playerThirdCard /* card|null */)  // 標準第三張牌規則表
LG.baccarat.dealCoup(shoe)  → {
  player:[..], banker:[..], pTotal, bTotal, outcome:'P'|'B'|'T',
  natural:boolean, playerPair:boolean, bankerPair:boolean,
  bankerCards:2|3, playerCards:2|3, bankerWinsWith6:boolean }
LG.baccarat.settle(bets, coup, variant)  // variant: 'classic'|'super6'|'tiger'
  // → {payouts:{spotId: amountReturned /* 含本金 */}, net, lines:[{spot, stake, result:'win'|'lose'|'push', pay, formula:'RM 100 × 0.95 = RM 95'}]}
```

### 2.9 `LG.blackjack`
```js
LG.blackjack.value(cards)   // {total, soft, bust, blackjack /* 恰兩張 A+10 */}
LG.blackjack.basicStrategy(playerCards, dealerUp, opts)
  // opts: {canDouble, canSplit, decks:6, s17:true, das:true}
  // → 'H'|'S'|'D'|'P'   (D 若不可加倍則回 'H' 或 'S'，由函式處理)
LG.blackjack.STRATEGY_TABLE  // 供教學模式渲染：{hard:{...}, soft:{...}, pairs:{...}}
LG.blackjack.dealerPlay(dealerCards, shoe, {s17:true}) // 回傳完成後的牌
```

### 2.10 `LG.poker`
```js
LG.poker.CATEGORY = {HIGH:0, PAIR:1, TWO_PAIR:2, TRIPS:3, STRAIGHT:4, FLUSH:5, FULL_HOUSE:6, QUADS:7, STRAIGHT_FLUSH:8, ROYAL:9}
LG.poker.CATEGORY_NAME[cat]  // {zh:'同花順', en:'Straight Flush'}
LG.poker.eval5(cards)        // → {cat, score /* 數字，越大越強，可直接比較 */, ranks:[...], name:{zh,en}, cards}
LG.poker.best(cards)         // 5–7 張取最佳 5 張 → 同 eval5 結果 + best5
LG.poker.compare(a, b)       // >0 a 強，<0 b 強，0 平
LG.poker.eval3(cards)        // Three Card Poker：{cat: 'SF'|'TRIPS'|'STRAIGHT'|'FLUSH'|'PAIR'|'HIGH', score, name}
LG.poker.equity(hole, board, nOpponents, iters=2000) // Monte Carlo 勝率 0–1（撲克室 AI/提示用）
LG.poker.outs(hole, board)   // 簡易 outs 數（提示用）
LG.poker.describe(result)    // '一對 K（Pair of Kings）'
```

### 2.11 `LG.paigow`
```js
LG.paigow.eval5(cards)        // 含小丑（A 或補順/同花/同花順）；A-2-3-4-5 為第二大順（房規）
LG.paigow.eval2(cards)        // 對子 > 高牌；小丑 = A
LG.paigow.houseWay(sevenCards) // → {high:[5], low:[2]}  文件化的房規（見遊戲規格）
LG.paigow.isValidSplit(high, low) // high 必須 ≥ low
LG.paigow.compare(playerSplit, dealerSplit) // → {high:1|0|-1, low:1|0|-1, result:'win'|'lose'|'push'}  copies 歸莊
```

### 2.12 `LG.slots`
```js
LG.slots.spin(strips /* string[][] */, rows=3) // → grid[reel][row] 符號，隨機停點
LG.slots.LINES_20                                 // 5×3 標準 20 線座標 [[row per reel]...]
LG.slots.evalLines(grid, lines, paytable, {wild, scatter, leftToRight:true})
  // paytable: {SYM:{3:x,4:y,5:z}} 倍數（乘 line bet）→ {wins:[{line, sym, count, mult, cells}], total}
LG.slots.countScatter(grid, sym) // → {count, cells}
LG.slots.simulateRTP(config, spins=200000) // config 由遊戲提供 {strips, lines, paytable, bet, features(gridCb)} → {rtp, hitRate}
```

### 2.13 `LG.dice`
```js
LG.dice.roll(n=3) // [1..6]*n
```

## 3. `LG` — 核心 UI（DOM）

### 3.1 `LG.ui` 基本
```js
LG.ui.el(tag, attrs={}, children=[])   // attrs: class, dataset, on:{click:fn}, html, text, style
LG.ui.card(cardObj, {faceDown=false, size='md'|'sm'|'lg', dim=false}) // → .lg-card 元素；.lg-card 有 data-id
LG.ui.flip(cardEl, cardObj)            // 翻牌動畫（class 切換 300ms）
LG.ui.squeezeable(cardEl, cardObj, {onRevealed}) // 咪牌：拖曳/長按逐步揭露（clip-path），完成呼叫 onRevealed
LG.ui.toast(text, {ms=1800})
LG.ui.modal({title, body /* node|html */, actions:[{label, onClick, primary}]}) → {close}
LG.ui.confirm(text) → Promise<boolean>
LG.ui.chipTray(container, {denoms, onSelect}) → {selected(), select(d), setEnabled(bool), setAffordable(balance)}
LG.ui.chipStack(amount)                // → 小籌碼堆元素（下注格上顯示）
LG.ui.dealer.say(zh, en, {speak=false}) // 荷官口令橫幅，兩行（中/英）；真實模式可用 speechSynthesis 念英文
LG.ui.countdown(seconds, {onTick, onDone}) → {cancel}  // 顯示於桌面頂部
LG.ui.resultPanel({title, hand, result, formula, why, actions}) // 練習模式的「牌型 → 結果 → 賠付計算式 → 為什麼」
LG.ui.payoutFlash(net)                  // 真實模式：只顯示 +RM 95 / −RM 50
LG.ui.highlight(selectors[] | null)     // 教學：spotlight 高亮，null 清除
LG.ui.table(html, {caption})            // 策略表 / 賠付表渲染
LG.ui.tabs(container, [{id,label,render}])
LG.ui.actionBar(container, [{id, label, en, onClick, disabled, primary}]) → {set(id, {disabled,label}), clear()}
```

### 3.2 `LG.Bets` 與 `LG.ui.betLayer`
```js
const bets = new LG.Bets({min, max, perSpotMin, perSpotMax, spotRules /* {spotId:{min,max}} */});
bets.place(spotId, amount)   // 檢查上限；不足餘額由呼叫端先 canAfford；回傳 {ok, reason}
bets.remove(spotId, amount=全部)
bets.clear() ; bets.total() ; bets.get(spotId) ; bets.entries() // [[spotId, amt]]
bets.snapshot() / bets.restore(snap)  // 「重複上一注 Rebet」
bets.lock() / bets.unlock() / bets.locked   // No more bets 後禁止改注
bets.validate()   // → {ok, errors:[{spot, reason:'BELOW_MIN'|'ABOVE_MAX'}], zh 說明}

// 桌面元素標記 data-bet="spotId"；betLayer 處理點擊放籌碼（用 chipTray 目前面額）、長按/右鍵移除、顯示籌碼堆
LG.ui.betLayer(tableEl, {bets, chipTray, bank, onChange, disabledMsg}) → {refresh(), destroy()}
```

### 3.3 `LG.slotView`
```js
LG.slotView.create(container, {reels:5, rows:3, symbols:{SYM:{label:'發', color, emoji|svg}}, strips})
 → view.spin(targetGrid) : Promise   // 逐軸停止動畫（每軸 +150ms）
   view.highlight(cells[]) ; view.clear() ; view.lock(cells[]) /* Hold & Spin 鎖定 */
   view.setSymbolValue(cell, text)     /* 金球面額 */
LG.slotView.paytableButton(container, {render()}) // 「賠付表 Pay Table」按鈕 → modal
LG.slotView.betPanel(container, {lines, lineBets:[0.1,0.2,0.5,1,2,5], onChange}) → {bet(), lines(), lineBet(), setMax()}
```

## 4. 遊戲插件介面

```js
LG.registerGame({
  id: 'baccarat',                       // 與檔名一致
  category: 'table' | 'poker-table' | 'slots' | 'poker-room',
  order: 1,                             // 卡片排序
  name: { zh: '百家樂', en: 'Baccarat' },
  summary: '押莊或閒，比誰接近 9 點。',
  houseEdge: [ { bet: {zh:'莊', en:'Banker'}, edge: 1.06, best: true }, ... ], // 排行榜取 best 或最小值
  limits: { real: {min: 50, max: 5000}, practice: {min: 10, max: 100000} },   // 可依 variant 覆寫
  denoms: [10, 25, 50, 100, 500, 1000], // 老虎機可省略
  variants: [ { id:'classic', name:{zh,en}, limits? } ],                        // 可省略
  create(ctx) → instance
});

instance = {
  mount(root),            // 建立桌面 DOM（root 為空的 <section class="lg-game">）
  unmount(),              // 清理計時器/事件
  tutorialSteps(),        // 回傳步驤陣列（見 §5）；可依 ctx.variant 不同
  onModeChange(mode),     // 可省略
  onVariantChange(id),    // 可省略
}
```

### 4.1 `ctx`（由 `LG.modes` 建立並注入）
```js
ctx.gameId, ctx.def, ctx.mode /* 'tutorial'|'practice'|'real' */, ctx.variant
ctx.bank, ctx.stats, ctx.limits /* 目前模式的 {min,max} */, ctx.denoms
ctx.hints           // boolean，練習模式的提示開關（真實模式永遠 false）
ctx.isReal, ctx.isPractice, ctx.isTutorial
ctx.explain({hand, result, formula, why})   // 練習：resultPanel；真實：只 payoutFlash(net)；教學：resultPanel
ctx.dealer.say(zh, en)                       // 練習+真實顯示；教學亦可用
ctx.bettingWindow({seconds, onClose})        // 真實：倒數→'No more bets'→onClose；練習/教學：顯示「發牌 Deal」按鈕，按下→onClose
ctx.recordRound({wagered, net, outcome})     // 統一寫 stats（真實模式同時寫 session）
ctx.checkBroke()                             // 真實模式餘額 < 最低注 → 顯示「籌碼用完」覆蓋層（手動重置）
ctx.setVariant(id)
ctx.strategyPanel(html)                      // 練習模式提示面板內容（策略表等）
```

### 4.2 模式行為對照
| 行為 | 教學 | 練習 | 真實 |
|------|------|------|------|
| 限注 | practice | practice | real（雲頂） |
| 下注時機 | 由步驟控制 | 隨時，按「發牌」開局 | 倒數 N 秒，No more bets 後鎖注 |
| 結果 | resultPanel | resultPanel（四段） | 只 payoutFlash 金額 |
| 提示 | 內建於步驟 | 可開關 | 無 |
| 荷官口令 | 可 | 顯示 | 顯示（可念） |
| 破產 | 不會 | 提示可重置 | 覆蓋層，手動重置，顯示本次統計 |
| 統計 | 不記 | 記 stats | 記 stats + session |

## 5. 教學步驟格式（`LG.tutorial`）
```js
step = {
  id: 'layout-banker',
  title: '莊 Banker 下注區',
  body: '<p>…一步只講一件事…</p>',        // 可含 <b>術語 <i>English</i></b>
  highlight: ['[data-bet="banker"]'],     // 選擇器陣列；null = 不高亮
  setup(instance) {},                     // 進入步驤時擺好示範狀態（例如發一手指定牌）
  action: { label: '試著押 RM 50 在莊', check(instance) → boolean|string }, // 可省略；有 action 時需完成才能下一步
  section: 'layout' | 'flow' | 'payout' | 'strategy'  // 四大段
}
LG.tutorial.run({gameId, steps, root, instance}) // 底部工作表：上一步/下一步/跳到段落；完成寫 progress
```
教學至少 12 步，四段皆有；每段完成寫 `progress.markStep`。

## 6. 路由
`#/` 首頁；`#/game/<id>/<mode>[/<variant>]`。切換模式 = 重新 `create(ctx)`；離開真實模式時顯示本次 session 摘要。

## 7. 效能與品質
- 無框架；避免每局重建整個桌面 DOM（只更新牌區與籌碼堆）。
- 動畫用 CSS transition/transform；老虎機轉軸用 `requestAnimationFrame`。
- `index.html` < 1.5 MB；首屏 < 1 秒（file://）。
- 所有文字繁中，英文術語以 `<i class="en">` 標記。
