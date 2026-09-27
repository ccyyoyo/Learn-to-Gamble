// e2e 共用工具（Playwright，全域安裝；Chromium 在 /opt/pw-browsers）。見 docs/07-test-plan.md §3
//
// 測試檔慣例（tests/e2e/<id>.mjs）：
//   export default async function (t) {
//     await t.test('練習模式一局', async (page, h) => { await h.openGame(page, 'baccarat', 'practice'); ... });
//   }
// 每個 t.test 拿到全新的 browser context（localStorage 乾淨）、window.LG_TEST = true（動畫 ×0.1），
// 視窗 390×844。測試結束時若有 console error / pageerror 視為失敗。
import { createRequire } from 'node:module';
import { pathToFileURL, fileURLToPath } from 'node:url';
import { join, dirname } from 'node:path';

// ESM 不吃 NODE_PATH，改用 require 解析全域 playwright
const require = createRequire(import.meta.url);
const { chromium } = require('playwright');

export const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..', '..');
export const INDEX_URL = pathToFileURL(join(ROOT, 'index.html')).href;

export function assert(cond, msg = 'assertion failed') {
  if (!cond) throw new Error(msg);
}
export function assertEq(a, b, msg = '') {
  if (a !== b) throw new Error(`${msg} expected ${JSON.stringify(b)}, got ${JSON.stringify(a)}`);
}

export async function launch() {
  return chromium.launch();
}

/** 新 context + page；page.lgErrors 收集 console error 與 pageerror */
export async function newPage(browser, { viewport = { width: 390, height: 844 } } = {}) {
  const context = await browser.newContext({ viewport });
  await context.addInitScript(() => { window.LG_TEST = true; });
  const page = await context.newPage();
  page.setDefaultTimeout(8000);
  const errors = [];
  page.on('console', (m) => { if (m.type() === 'error') errors.push(m.text()); });
  page.on('pageerror', (e) => errors.push(String((e && e.stack) || e)));
  page.lgErrors = errors;
  return page;
}

async function goHash(page, hash) {
  if (page.url().startsWith(INDEX_URL)) await page.evaluate((h) => { location.hash = h; }, hash);
  else await page.goto(INDEX_URL + hash);
}

export async function openHome(page) {
  await goHash(page, '#/');
  await page.waitForSelector('.lg-page--home');
}

/** 導向 #/game/<id>/<mode>[/<variant>]，等 .lg-game[data-ready="1"] */
export async function openGame(page, id, mode = 'practice', variant) {
  await goHash(page, `#/game/${id}/${mode}${variant ? '/' + variant : ''}`);
  await page.waitForSelector(`.lg-game[data-game="${id}"][data-mode="${mode}"][data-ready="1"]`);
}

/** 真實模式進場 modal 按「開始」 */
export async function startReal(page) {
  await page.click('[data-action="real-start"]');
  await page.waitForSelector('[data-action="real-start"]', { state: 'detached' });
}

export async function selectChip(page, denom) {
  await page.click(`.lg-chips [data-denom="${denom}"]`);
}
/** 點籌碼（可省略面額）→ 點 [data-bet="spotId"] */
export async function placeChip(page, spotId, denom) {
  if (denom) await selectChip(page, denom);
  await page.click(`[data-bet="${spotId}"]`);
}
/** 右鍵移除一枚 */
export async function removeChip(page, spotId) {
  await page.click(`[data-bet="${spotId}"]`, { button: 'right' });
}
/** 格子上的下注金額 */
export async function betAmount(page, spotId) {
  return Number((await page.getAttribute(`[data-bet="${spotId}"]`, 'data-amount')) || 0);
}

/** topbar（或首頁）餘額數字 */
export async function balance(page) {
  const v = await page.getAttribute('.lg-topbar .lg-balance, .lg-hero .lg-balance', 'data-balance');
  return Number(v);
}
export async function setBalance(page, n) {
  await page.evaluate((x) => { LG.store.update((s) => { s.bank = x; }); LG.events.emit('bank:change', { balance: x, delta: 0 }); }, n);
}

/** 練習/教學：按「發牌 Deal」 */
export async function deal(page) {
  await page.click('[data-action="deal"]');
}
/** 等練習/教學結果面板 */
export async function waitResult(page, timeout = 8000) {
  return page.waitForSelector('.lg-result', { timeout });
}
export async function closeResult(page) {
  const b = await page.$('.lg-result .lg-result__x');
  if (b) await b.click();
  await page.waitForSelector('.lg-result', { state: 'detached' });
}
/** 目前已出現過幾次派彩閃示（搭配 waitFlash(page, since)） */
export async function flashCount(page) {
  return page.evaluate(() => LG.ui.flashCount || 0);
}
/** 真實模式：等派彩閃示（閃示很短，用計數判斷）；回傳 {net} */
export async function waitFlash(page, since = 0, timeout = 8000) {
  await page.waitForFunction((n) => (LG.ui.flashCount || 0) > n, since, { timeout });
  return page.evaluate(() => LG.ui.lastFlash);
}

export async function waitCountdown(page) {
  return page.waitForSelector('.lg-countdown.is-active');
}
/** 荷官橫幅 {zh, en} */
export async function banner(page) {
  return page.$eval('.lg-dealer-banner', (b) => ({ zh: b.dataset.zh || '', en: b.dataset.en || '' }));
}
export async function waitBanner(page, en, timeout = 8000) {
  await page.waitForFunction((x) => (document.querySelector('.lg-dealer-banner') || {}).dataset?.en === x, en, { timeout });
}

// ---- 教學
export async function tutorialStep(page) {
  return page.$eval('.lg-tutor', (t) => ({ index: Number(t.dataset.index), id: t.dataset.step, section: t.dataset.section }));
}
export async function tutorialNext(page) {
  const before = (await tutorialStep(page)).index;
  await page.click('[data-tutor="next"]');
  await page.waitForFunction((b) => { const t = document.querySelector('.lg-tutor'); return !t || Number(t.dataset.index) !== b; }, before);
}
export async function highlighted(page) {
  return page.$$eval('.lg-spot--hl', (els) => els.length);
}

/** 咪牌：在 selector 元素上由上往下拖曳 */
export async function dragSqueeze(page, selector = '.lg-card.is-squeeze') {
  const box = await (await page.waitForSelector(selector)).boundingBox();
  await page.mouse.move(box.x + box.width / 2, box.y + 4);
  await page.mouse.down();
  for (let i = 1; i <= 8; i++) await page.mouse.move(box.x + box.width / 2, box.y + 4 + (box.height * i) / 8);
  await page.mouse.up();
}

export async function toastText(page) {
  return page.$$eval('.lg-toast', (els) => els.map((e) => e.textContent).join(' | '));
}
