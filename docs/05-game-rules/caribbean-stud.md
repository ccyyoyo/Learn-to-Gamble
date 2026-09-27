# Caribbean Stud Poker（id: `caribbean-stud`）

## 1. 規則
- 1 副牌每局重洗。玩家先押 **Ante**（可加 **累積獎金 Progressive** 旁注固定 RM 5）。
- 每人 5 張暗牌，莊家 5 張其中 1 張翻開（明牌 Up card）。
- 玩家看牌後：**棄牌 Fold**（輸 Ante）或 **跟注 Bet/Raise = 2 × Ante**。
- 莊家開牌，**合格 Qualify 條件：A-K 高牌或更好**（即 A 與 K 同在、或任何一對以上）。
  - 莊不合格：Ante 賠 1:1，Bet 退回（push）。
  - 莊合格且玩家勝：Ante 1:1，Bet 依賠付表。
  - 莊合格且莊勝：輸 Ante + Bet。平手：都 push。

## 2. Bet 賠付表（`spotId: ante, bet, progressive`）
| 牌型 | Bet 賠率 |
|------|------|
| 一對或 A-K | 1:1 |
| 兩對 | 2:1 |
| 三條 | 3:1 |
| 順 | 4:1 |
| 同花 | 5:1 |
| 葫蘆 | 7:1 |
| 四條 | 20:1 |
| 同花順 | 50:1 |
| 皇家同花順 | 100:1 |
| **累積獎金旁注**（不論莊牌） | 同花 RM 50／葫蘆 RM 100／四條 RM 500／同花順 10% 獎池／皇家 100% 獎池 |
獎池：種子 RM 100,000，每個旁注 +RM 3.5（70% 進池），存 `store.jackpots['caribbean-stud'].pool`。
莊家優勢 Ante 5.22%（最佳策略）。
- 備註：累積獎金旁注固定 RM 5、彩金不隨注額放大，**獎池 RM 100,000 時優勢約 86%，需 RM 1.58M 才打平**（`logic.progressiveEdge(pool)` 精確計算；`houseEdge` 另列一筆 approx）。

## 3. 桌面配置
```
┌──────────────────────────────────────┐
│    莊家 DEALER 五張（一張明）  獎池 JACKPOT RM 100,000 │
│ 印字："DEALER QUALIFIES WITH ACE-KING OR HIGHER"       │
│      ┌── 你 YOU 五張牌 ──┐                             │
│  [BET 2×Ante 格]  [ANTE 格]  (◎ PROGRESSIVE RM 5 投幣孔)│
│  data-bet="bet"   data-bet="ante"  data-bet="progressive"(切換式 RM 5) │
└──────────────────────────────────────┘
動作列：棄牌 Fold | 跟注 Bet（自動放 2×Ante）
```

## 4. 一局流程
Ante（+ 旁注）→ No more bets → 發 5 張、莊翻一張 → 玩家 Fold/Bet（真實 30 秒）→ 莊開牌 → 判合格 → 結算。

## 5. 策略（提示用）
- 一對以上：跟。
- A-K：只在（a）莊明牌 2–Q 且與你手中任一張同 rank；或（b）莊明牌 A/K 且你有 Q 或 J 時跟；否則棄。
- 低於 A-K：棄。

## 6. 教學大綱（≥ 12 步）
layout：Ante/Bet 格、旁注孔、莊明牌、獎池顯示。flow：Ante 後不能碰、看牌後 Fold 或放 2×Ante、莊合格規則。payout：三個情境（莊不合格／合格你贏兩對／你輸）計算；旁注獨立結算。strategy：策略三條、旁注優勢很高（獎池 RM 100,000 時約 86%，需 RM 1.58M 才打平）。

## 7. 真實模式
Ante RM 25–500；旁注 RM 5；決策 30 秒未操作 = 棄牌。

## 8. 驗收測試
- 合格判定：A-K-x-x-x 合格；A-Q-J-x-x 不合格；任何對合格。
- 結算三情境數值正確；旁注四條 +RM 500。
- Monte Carlo 100 萬手用上述策略：優勢 4.5%–6%。
