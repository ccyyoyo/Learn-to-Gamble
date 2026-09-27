# Three Card Poker（id: `three-card-poker`）

## 1. 規則
- 1 副牌。兩個獨立主注：**Ante/Play**（對莊）與 **Pair Plus**（只看自己牌）。可只押其一。
- 玩家 3 張、莊 3 張暗。玩家看牌後 **Fold**（輸 Ante 與 Pair Plus 仍結算）或 **Play = Ante 同額**。
- 莊 **合格 Q 高牌以上**。不合格：Ante 1:1，Play push。合格：比牌，贏 Ante+Play 各 1:1，輸都輸，平 push。
- 三張牌型排序：**同花順 > 三條 > 順 > 同花 > 一對 > 高牌**（順比同花大！教學重點）。

## 2. 賠付
| Ante Bonus（不論莊牌、不論輸贏） | |
|---|---|
| 順 | 1:1 |
| 三條 | 4:1 |
| 同花順 | 5:1 |

| Pair Plus（1-4-6-30-40，優勢 2.32%） | |
|---|---|
| 一對 | 1:1 |
| 同花 | 4:1 |
| 順 | 6:1 |
| 三條 | 30:1 |
| 同花順 | 40:1 |
Ante/Play 優勢 3.37%（以 Ante 計）。spotId：`ante`, `play`, `pairPlus`。

## 3. 桌面配置
```
┌──────────────────────────────────┐
│       莊家 DEALER 三張            │
│ 印字："DEALER PLAYS WITH QUEEN HIGH OR BETTER" + Pair Plus / Ante Bonus 賠付表 │
│       你 YOU 三張                 │
│   (PAIR PLUS)  (ANTE)  (PLAY)     │  三格橫排，Play 在最靠玩家
└──────────────────────────────────┘
動作列：棄牌 Fold | 跟注 Play
```

## 4. 策略
Q-6-4 以上 Play，否則 Fold（比較：Q>… 第一張、6 第二、4 第三）。

## 5. 教學大綱（≥ 12 步）
layout、flow（先放 Ante/Pair Plus，看牌後 Play 放 Ante 同額）、payout（三情境 + Ante Bonus 與 Pair Plus 各自獨立）、strategy（Q-6-4、Pair Plus 比 Ante 划算一點、順 > 同花）。

## 6. 真實模式
RM 25–500；決策 30 秒。

## 7. 驗收測試
- eval3：順（A-2-3 最小、Q-K-A 最大）、同花順、三條；順 > 同花。
- Q-6-4 邊界：Q-6-4 Play，Q-6-3 Fold。
- 結算：莊不合格 Ante 1:1 Play push；Pair Plus 三條 30:1。
- Monte Carlo：Pair Plus 優勢 2.32%±0.2；Ante 3.37%±0.3。
