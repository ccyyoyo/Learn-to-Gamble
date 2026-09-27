// e2e 執行器：跑 tests/e2e/*.mjs（不含 _ 開頭）。可傳 id 篩選：npm run e2e -- baccarat home
import { readdirSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, dirname } from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import * as h from './_helpers.mjs';

const dir = dirname(fileURLToPath(import.meta.url));
const ids = process.argv.slice(2).filter((a) => !a.startsWith('-'));
if (!existsSync(join(h.ROOT, 'index.html'))) { console.error('index.html 不存在，先執行 node build.mjs'); process.exit(1); }

const files = readdirSync(dir)
  .filter((f) => f.endsWith('.mjs') && !f.startsWith('_'))
  .filter((f) => !ids.length || ids.includes(f.replace(/\.mjs$/, '')))
  .sort();
if (!files.length) { console.error('沒有符合的 e2e 檔：', ids.join(' ')); process.exit(1); }

const browser = await h.launch();
let pass = 0, fail = 0;
const failures = [];
const t0 = Date.now();

for (const f of files) {
  const id = f.replace(/\.mjs$/, '');
  console.log(`\n# ${id}`);
  let mod;
  try { mod = await import(pathToFileURL(join(dir, f)).href); }
  catch (e) { fail++; failures.push(`${id}: 載入失敗 ${e.message}`); console.log(`  ✗ 載入失敗：${e.message}`); continue; }
  const t = {
    browser,
    h,
    async test(name, fn) {
      const page = await h.newPage(browser);
      const s = Date.now();
      try {
        await fn(page, h);
        if (page.lgErrors.length) throw new Error('console error:\n    ' + page.lgErrors.join('\n    '));
        pass++;
        console.log(`  ✓ ${name} (${Date.now() - s}ms)`);
      } catch (e) {
        fail++;
        failures.push(`${id} › ${name}: ${e.message}`);
        console.log(`  ✗ ${name}\n    ${String(e.stack || e.message).split('\n').slice(0, 6).join('\n    ')}`);
        try { const shot = join(tmpdir(), `lg-e2e-fail-${id}.png`); await page.screenshot({ path: shot }); console.log(`    screenshot: ${shot}`); } catch { /* ignore */ }
      } finally {
        await page.context().close();
      }
    },
  };
  try { await mod.default(t); }
  catch (e) { fail++; failures.push(`${id}: ${e.message}`); console.log(`  ✗ ${e.message}`); }
}
await browser.close();

console.log(`\n# e2e: ${pass} passed, ${fail} failed (${((Date.now() - t0) / 1000).toFixed(1)}s)`);
if (fail) { console.log(failures.map((x) => '  - ' + x).join('\n')); process.exit(1); }
