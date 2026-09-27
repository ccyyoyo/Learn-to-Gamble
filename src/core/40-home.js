// 首頁 #/ — 餘額、四區遊戲卡片（完成度環、最佳優勢、練習統計、三模式按鈕）、莊家優勢排行榜、頁尾。
// 見 docs/03-ui-spec.md §3
(() => {
  const LG = globalThis.LG;
  const { el, term } = LG.ui;
  const { fmt } = LG.money;

  const RAKE_TEXT = '無莊家優勢，抽水 5%（≤ RM 50）';
  let offs = [];

  // 與 00-common.md §4 同格式：桌遊兩位小數（2.50%），老虎機一位（6.0%）
  const pctStr = (n, def) => `${Number(n).toFixed(def && def.category === 'slots' && !/^video/.test(def.id) ? 1 : 2)}%`;
  const rtpStr = (edge, def) => `RTP ${pctStr(100 - edge, def)}`;

  function edgeLine(def) {
    if (def.category === 'poker-room') return RAKE_TEXT;
    const b = LG.bestEdge(def);
    if (!b) return '';
    const bet = b.bet ? `（${b.bet.zh || ''}）` : '';
    const rtp = def.category === 'slots' ? ` · ${rtpStr(b.edge, def)}` : '';
    return `莊家優勢 ${b.approx ? '≈' : ''}${pctStr(b.edge, def)}${bet}${rtp}`;
  }

  /** 變體別優勢（variants[i].houseEdge）→ '傳統 1.06% · 免佣 1.46% …'；沒有就空字串 */
  function variantLine(def) {
    const list = LG.variantEdges(def).filter((x) => x.best);
    if (!list.length) return '';
    return list.map(({ variant, best }) => `${variant.name.zh} ${best.approx ? '≈' : ''}${pctStr(best.edge)}`).join(' · ');
  }
  /** 排行榜：與代表值不同的變體 → '免佣 / 老虎：莊（免佣…）1.46%' */
  function variantDiff(def, b) {
    const groups = new Map();
    LG.variantEdges(def).forEach(({ variant, best }) => {
      if (!best || (best.edge === b.edge && (best.bet && best.bet.zh) === (b.bet && b.bet.zh))) return;
      const k = `${best.bet ? best.bet.zh : ''} ${best.approx ? '≈' : ''}${pctStr(best.edge)}`;
      groups.set(k, [...(groups.get(k) || []), variant.name.zh]);
    });
    return [...groups].map(([k, names]) => `${names.join(' / ')}：${k}`).join('；');
  }

  function ring(pct) {
    return el('div.lg-ring', { style: `--p:${pct}`, role: 'img', 'aria-label': `教學完成 ${pct}%`, title: `教學完成度 ${pct}%` }, [
      el('span', { text: `${pct}%` }),
    ]);
  }

  function gameCard(def) {
    const s = LG.stats.get(def.id);
    const pct = LG.progress.pct(def.id);
    const R = LG.router;
    const modes = el('div.lg-gcard__modes', ['tutorial', 'practice', 'real'].map((m) =>
      el('a', { class: ['lg-btn', 'lg-btn--sm', m === 'practice' && 'lg-btn--primary'], href: R.href(def.id, m), dataset: { mode: m },
        html: term(LG.modes.MODE_INFO[m].zh, LG.modes.MODE_INFO[m].en) })));
    const card = el('article.lg-gcard', { dataset: { gameCard: def.id }, tabindex: '0' }, [
      el('div.lg-gcard__head', [
        el('div', [
          el('h3.lg-gcard__name', { html: `${def.name.zh}${def.demo ? ' <span class="lg-tag">示範</span>' : ''}` }),
          el('div.lg-gcard__en', { text: def.name.en }),
        ]),
        ring(pct),
      ]),
      el('p.lg-gcard__summary', { text: def.summary || '' }),
      el('div.lg-gcard__edge', { text: edgeLine(def) }),
      variantLine(def) ? el('div.lg-gcard__variants', { html: `變體 <i class="en">Variants</i>：${variantLine(def)}` }) : null,
      el('div.lg-gcard__stats', { html: s.rounds ? `已玩 ${s.rounds} 局 · 淨 <b class="${s.net > 0 ? 'lg-win' : s.net < 0 ? 'lg-lose' : ''}">${LG.money.fmtSigned(s.net)}</b>` : '還沒玩過' }),
      modes,
    ]);
    // 點卡片（非按鈕處）→ 聚焦模式按鈕
    card.addEventListener('click', (ev) => {
      if (ev.target.closest('a')) return;
      card.classList.add('is-open');
      const p = modes.querySelector('[data-mode="practice"]');
      if (p) p.focus();
    });
    return card;
  }

  function leaderboard() {
    const rows = LG.gameList()
      .filter((d) => d.category !== 'poker-room')
      .map((d) => ({ d, b: LG.bestEdge(d) }))
      .filter((x) => x.b)
      .sort((a, b) => a.b.edge - b.b.edge);
    const room = LG.games['poker-room'];
    const tbody = el('tbody', rows.map(({ d, b }, i) => el('tr', { dataset: { game: d.id, edge: b.edge } }, [
      el('td.lg-lb__rank', { text: String(i + 1) }),
      el('td', { html: `<a href="${LG.router.href(d.id, 'practice')}">${d.name.zh}</a> <i class="en">${d.name.en}</i>` }),
      el('td', { html: (b.bet ? term(b.bet.zh || '', b.bet.en || '') : '') + (variantDiff(d, b) ? `<small class="lg-lb__var">${variantDiff(d, b)}</small>` : '') }),
      el('td.lg-lb__edge', { html: `${b.approx ? '≈' : ''}${pctStr(b.edge, d)}${d.category === 'slots' ? `<small>${rtpStr(b.edge, d)}</small>` : ''}` }),
    ])));
    tbody.appendChild(el('tr.lg-lb__room', { dataset: { game: 'poker-room' } }, [
      el('td.lg-lb__rank', { text: '—' }),
      el('td', { html: room ? `${room.name.zh} <i class="en">${room.name.en}</i>` : '撲克室 <i class="en">Poker Room</i>' }),
      el('td', { html: '玩家對玩家 <i class="en">Player vs player</i>' }),
      el('td.lg-lb__edge', { text: RAKE_TEXT }),
    ]));
    return el('section.lg-home__lb', { id: 'leaderboard' }, [
      el('h2', { html: '莊家優勢排行榜 <i class="en">House Edge</i>' }),
      el('p.lg-muted', { text: '數字越低越划算：代表長期每押 RM 100，平均會輸掉的金額。老虎機附上 RTP（返還率 = 100% − 優勢）。' }),
      el('div.lg-tablewrap', [el('table.lg-datatable.lg-lb', [
        el('thead', [el('tr', [el('th', { text: '#' }), el('th', { text: '遊戲' }), el('th', { text: '注別' }), el('th', { text: '優勢' })])]),
        tbody,
      ])]),
      el('p.lg-muted.lg-lb__note', { html: '撲克室不是跟賭場對賭：賭場從每個底池抽水 5%（上限 RM 50），不看翻牌不抽 <i class="en">No flop, no drop</i>。' }),
    ]);
  }

  function render(app) {
    unmount();
    const bal = el('div.lg-hero__balance', { dataset: { balance: LG.bank.balance() } });
    const paintBal = () => {
      const b = LG.bank.balance();
      bal.innerHTML = `<small>餘額 <i class="en">Balance</i></small><span class="lg-balance" data-balance="${b}">${fmt(b, { cents: Math.round(b * 100) % 100 !== 0 })}</span>`;
    };
    paintBal();
    const resetB = el('button', {
      type: 'button', class: 'lg-btn lg-btn--ghost lg-btn--sm', dataset: { action: 'reset-bank' }, html: '重置籌碼 <i class="en">Reset chips</i>',
      on: { click: async () => { if (await LG.ui.confirm('把籌碼重置為 RM 1,000？教學進度與統計不受影響。')) { LG.bank.reset(); LG.ui.toast('籌碼已重置為 RM 1,000'); } } },
    });
    const hero = el('header.lg-hero', [
      el('div', [
        el('h1.lg-hero__title', { html: '賭場遊戲練習場' }),
        el('p.lg-hero__sub', { html: '<i class="en">Casino Practice</i> · 虛擬籌碼，先學規則再上桌' }),
      ]),
      el('div.lg-hero__right', [bal, resetB]),
    ]);

    const cats = LG.categories.map((c) => {
      const list = LG.gameList(c.id);
      return el('section.lg-cat', { dataset: { category: c.id } }, [
        el('h2.lg-cat__title', { html: term(c.name.zh, c.name.en) }),
        list.length ? el('div.lg-cards-grid', list.map(gameCard))
          : el('p.lg-muted.lg-cat__empty', { html: '即將推出 <i class="en">Coming soon</i>' }),
      ]);
    });

    const clearB = el('button', {
      type: 'button', class: 'lg-btn lg-btn--danger lg-btn--sm', dataset: { action: 'reset-all' }, text: '清除所有進度',
      on: { click: async () => {
        if (await LG.ui.confirm('清除所有進度、統計與餘額，回到初始狀態？這無法復原。', { danger: true, okLabel: '全部清除' })) {
          LG.store.reset(); LG.ui.toast('已清除所有進度');
        }
      } },
    });
    const foot = el('footer.lg-foot', [
      el('p', { html: '規則、賠率與限注以雲頂（Genting）大眾區常見設定為基準（近似），現場以桌上標示為準。本站僅供學習，沒有真錢。' }),
      el('p', { html: `版本 v${LG.VERSION} · 進度存在本機瀏覽器${LG.store.persistent ? '' : '（目前無法保存）'}` }),
      clearB,
    ]);

    const page = el('div.lg-page.lg-page--home', [hero, ...cats, leaderboard(), foot]);
    app.replaceChildren(page);
    document.title = '賭場遊戲練習場 Casino Practice';
    offs.push(LG.events.on('bank:change', paintBal));
    offs.push(LG.events.on('store:reset', () => { if (page.isConnected) render(app); }));
  }

  function unmount() { offs.forEach((f) => f()); offs = []; }

  LG.home = { render, unmount, edgeLine, variantLine };
})();
