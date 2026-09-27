// 合併 src/ → index.html（單一離線檔）。詳見 docs/02-architecture.md §1
import { readdirSync, readFileSync, writeFileSync, statSync } from 'node:fs';
import { join } from 'node:path';

const root = new URL('.', import.meta.url).pathname;
const list = (dir, ext) => {
  try {
    return readdirSync(join(root, dir)).filter(f => f.endsWith(ext)).sort()
      .map(f => join(root, dir, f));
  } catch { return []; }
};
const read = p => readFileSync(p, 'utf8');
const js = [...list('src/core', '.js'), ...list('src/games', '.js')];
const css = [...list('src/core', '.css'), ...list('src/games', '.css')];

const jsText = js.map(p => `/* ==== ${p.replace(root, '')} ==== */\n${read(p)}`).join('\n\n');
const cssText = css.map(p => `/* ==== ${p.replace(root, '')} ==== */\n${read(p)}`).join('\n\n');

const html = `<!DOCTYPE html>
<html lang="zh-Hant">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
<meta name="theme-color" content="#101418">
<title>賭場遊戲練習場 Casino Practice</title>
<style>
${cssText}
</style>
</head>
<body>
<div id="app"></div>
<script>
${jsText.replace(/<\/script>/gi, '<\\/script>')}
</script>
</body>
</html>
`;
const out = join(root, 'index.html');
writeFileSync(out, html);
const kb = (statSync(out).size / 1024).toFixed(1);
console.log(`index.html written: ${kb} KB (${js.length} js, ${css.length} css files)`);
if (statSync(out).size > 1.5 * 1024 * 1024) console.warn('WARNING: index.html exceeds 1.5 MB');
