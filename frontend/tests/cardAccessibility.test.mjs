import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const readComponent = (name) => readFile(new URL(`../src/components/${name}.tsx`, import.meta.url), 'utf8');

test('history and continue-watching primary actions use named native buttons', async () => {
  const [history, continueWatching, admin] = await Promise.all([
    readComponent('HistoryPage'),
    readComponent('ContinueWatchingRow'),
    readComponent('AdminDashboard'),
  ]);
  assert.match(history, /<button[\s\S]*?onClick=\{\(\) => onWatch\(item\.slug, item\.episodeSlug\)\}[\s\S]*?aria-label=\{`Xem tiếp/);
  assert.match(continueWatching, /<button[\s\S]*?onClick=\{\(\) => onWatch\(item\.slug, item\.episodeSlug, item\.time\)\}[\s\S]*?aria-label=\{`Tiếp tục xem/);
  assert.doesNotMatch(history, /<div\s+key=\{item\.slug\}\s+onClick=/);
  assert.doesNotMatch(continueWatching, /<div\s+key=\{`\$\{item\.slug\}[^}]*\}\s+onClick=/);
  assert.ok(history.indexOf('aria-label={`Xem tiếp') < history.indexOf('</button>', history.indexOf('aria-label={`Xem tiếp')));
  assert.ok(history.indexOf('</button>', history.indexOf('aria-label={`Xem tiếp')) < history.indexOf('aria-label={`Xóa'));
  assert.ok(continueWatching.indexOf('aria-label={`Tiếp tục xem') < continueWatching.indexOf('</button>', continueWatching.indexOf('aria-label={`Tiếp tục xem')));
  assert.ok(continueWatching.indexOf('</button>', continueWatching.indexOf('aria-label={`Tiếp tục xem')) < continueWatching.indexOf('aria-label={`Xóa'));
  assert.match(admin, /<label\s+htmlFor="admin-password"/);
  assert.match(admin, /aria-label=\{showPassword \? 'Ẩn mật khẩu' : 'Hiển thị mật khẩu'\}/);
  assert.match(admin, /aria-pressed=\{showPassword\}/);
});
