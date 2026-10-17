// Быстрая проверка без зависимостей: JS парсится, а все файлы из manifest.json существуют.
import { readFileSync, existsSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { execFileSync } from 'node:child_process';

const manifest = JSON.parse(readFileSync('manifest.json', 'utf8'));
const files = new Set([
  ...(manifest.background?.scripts ?? []),
  manifest.background?.service_worker,
  ...manifest.content_scripts.flatMap((c) => [...(c.js ?? []), ...(c.css ?? [])]),
].filter(Boolean));

let bad = 0;
for (const f of files) if (!existsSync(f)) { console.error('нет файла из manifest:', f); bad++; }

const walk = (d) => readdirSync(d).flatMap((n) => {
  const p = join(d, n);
  return statSync(p).isDirectory() ? walk(p) : [p];
});
for (const f of walk('src').filter((p) => p.endsWith('.js'))) {
  try { execFileSync(process.execPath, ['--check', f], { stdio: 'pipe' }); }
  catch (e) { console.error('синтаксис:', f, String(e.stderr)); bad++; }
}
console.log(bad ? `ошибок: ${bad}` : 'ok');
process.exit(bad ? 1 : 0);
