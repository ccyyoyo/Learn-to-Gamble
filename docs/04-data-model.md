# 04 資料模型（localStorage）

Key：`lg.v1`。JSON。寫入時機：`LG.store.update()` 結束後立即寫入（同步）。

```jsonc
{
  "version": 1,
  "createdAt": 1727400000000,
  "bank": 1000,                       // RM，浮點（老虎機會有小數），永遠 round2
  "settings": { "speak": false, "hints": true, "reducedMotion": false },
  "progress": {                        // 教學進度
    "baccarat": { "steps": [0,1,2,5], "total": 14, "completedAt": null }
  },
  "stats": {                           // 練習 + 真實累計
    "baccarat": { "rounds": 12, "wagered": 1200, "net": -60, "wins": 5, "losses": 6, "pushes": 1 }
  },
  "sessions": [                        // 真實模式歷史（最多保留 20 筆）
    { "gameId": "baccarat", "startedAt": 0, "endedAt": 0, "rounds": 10, "wagered": 500, "net": -100, "maxWin": 95, "maxLoss": -50, "broke": false }
  ],
  "jackpots": {                        // 累積獎金（跨 session 持續成長）
    "slot-progressive": { "mini": 20, "minor": 50, "major": 500, "grand": 10000 },
    "slot-holdspin":    { "major": 500, "grand": 5000 },
    "caribbean-stud":   { "pool": 100000 }
  },
  "lastBets": { "baccarat": { "banker": 50 } }   // 重複上注
}
```

規則：
- `LG.store.reset()` 清除全部並回到初始（bank=1000、jackpots 回種子值）。「重置籌碼」只把 bank 設回 1000（不清進度與統計）。
- 讀取時若 `version` 不同：目前只有 v1；缺欄位用預設補齊（`migrate()`）。
- localStorage 不可用（隱私模式）時：改用記憶體，並 toast 提示「進度不會保存」。
- 遊戲不得直接動 localStorage；一律透過 `LG.store` / `LG.bank` / `LG.stats` / `LG.progress`。
- 累積獎金：遊戲呼叫 `LG.store.update(s => s.jackpots[id].grand += contrib)`。
