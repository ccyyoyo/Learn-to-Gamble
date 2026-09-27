# 06 教學模式寫作規範與術語表

## 1. 原則
1. **一步只講一件事**：一個下注格、一個動作、一個算式。步驤 body ≤ 80 中文字。
2. **先看再做**：每段先「指給你看」（highlight），再「讓你做一次」（action）。每款教學至少 3 個 action 步。
3. **四段固定順序**：layout（桌面）→ flow（流程）→ payout（輸贏與賠率）→ strategy（優勢與該押什麼）。每段開頭一步是「這段你會學到…」。
4. **術語格式**：第一次出現寫「中文 <i class="en">English</i>」，之後可只寫中文。桌面標示用英文大寫（BANKER），對話用一般英文（Banker）。
5. **算式格式**：`RM 100 × 0.95 = RM 95`；拿回金額要區分「淨贏」與「拿回（含本金）」，兩者都寫。
6. **不能碰籌碌的時機**必須在 flow 段獨立一步，語氣直接：「No more bets 之後，手放桌下。」
7. **strategy 段必含**：本遊戲莊家優勢表（每注）、「該押」與「別押」各一步、預算一步（「今晚只帶 RM 500，輸完就走」）。
8. **不教迷信**：路單/熱號/機台「快出了」一律標示「這只是紀錄，不能預測」。
9. 完成整份教學 → 最後一步顯示「完成！去練習模式試 10 局」按鈕（route 到 practice）。

## 2. 步驤模板
```js
{
  id: 'flow-no-more-bets', section: 'flow',
  title: '停止下注 No more bets',
  body: '<p>荷官說 <b>No more bets</b>（停止下注）後，任何籌碼都不能再碰——加、減、移動都不行。</p><p>現場做法：手放桌邊下方，等派彩完成。</p>',
  highlight: ['.lg-dealer-banner', '[data-bet]'],
  setup(inst) { inst.demo.showBanner('停止下注', 'No more bets'); inst.bets.lock(); },
}
```
action 範例：`action: { label: '在「莊 BANKER」放一枚 RM 50', check: inst => inst.bets.get('banker') === 50 }`；check 回傳字串 = 顯示錯誤提示。

## 3. 通用術語表（zh-TW / EN）
| 中文 | English | 備註 |
|------|---------|------|
| 荷官 | Dealer / Croupier（輪盤） | |
| 籌碼 | Chips | 現金籌碼 Cash chips |
| 最低注 / 最高注 | Minimum / Maximum bet | 桌牌 Table limit sign |
| 請下注 / 停止下注 | Place your bets / No more bets | |
| 派彩 | Payout | |
| 平手 / 退注 | Push | |
| 莊家優勢 | House edge | 老虎機用 RTP（Return to Player） |
| 旁注 | Side bet | |
| 抽佣 | Commission | 百家樂 5% |
| 天牌 | Natural | |
| 補牌 | Draw / Hit | 21 點用 Hit |
| 停牌 | Stand | |
| 加倍 | Double down | |
| 分牌 | Split | |
| 保險 | Insurance | |
| 爆牌 | Bust | |
| 牌靴 | Shoe | |
| 切牌 | Cut card | |
| 燒牌 | Burn card | |
| 底注 | Ante | |
| 跟注 / 加注 / 棄牌 | Call / Raise / Fold | |
| 過牌 | Check | |
| 全下 | All-in | |
| 盲注（小/大） | Blinds (Small / Big) | |
| 按鈕位 | Button / Dealer button | |
| 底池 / 邊池 | Pot / Side pot | |
| 抽水 | Rake | |
| 攤牌 | Showdown | |
| 翻牌 / 轉牌 / 河牌 | Flop / Turn / River | |
| 公共牌 | Community cards | |
| 合格 | Qualify | 莊家最低牌型 |
| 賠付表 | Pay table | |
| 賠付線 | Payline | |
| 百搭 | Wild | |
| 分散符號 | Scatter | |
| 免費轉 | Free spins | |
| 累積獎金 | Progressive jackpot | |
| 最大注 | Max bet | |
| 每線注 | Bet per line | |
| 兌現 | Cash out | TITO 票 Ticket in, ticket out |
| 持牌 | Hold | 視訊撲克 |
| 換牌 | Draw | |
| 一對 / 兩對 / 三條 / 順 / 同花 / 葫蘆 / 四條 / 同花順 / 皇家同花順 | Pair / Two Pair / Three of a Kind / Straight / Flush / Full House / Four of a Kind / Straight Flush / Royal Flush | |
| 高牌 | High card | |
| 路單 | Roadmap / Scoreboard | 珠盤路 Bead plate、大路 Big road |
| 咪牌 | Squeeze | |
| 圍骰 | Triple | 骰寶 |
| 公 | Picture | 三公 |
| 番 / 念 / 角 | Fan / Nim / Kwok | 番攤 |
