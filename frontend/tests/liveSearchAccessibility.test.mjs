import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

test('live search exposes combobox state, listbox options, and arrow-key active descendant', async () => {
  const source = await readFile(new URL('../src/components/LiveSearch.tsx', import.meta.url), 'utf8');
  assert.match(source, /role="combobox"/);
  assert.match(source, /aria-autocomplete="list"/);
  assert.match(source, /role="listbox"/);
  assert.match(source, /role="option"[\s\S]*?aria-selected=\{index === activeSuggestionIndex\}/);
  assert.match(source, /aria-activedescendant=\{activeSuggestionIndex >= 0 \? `live-search-option-\$\{activeSuggestionIndex\}`/);
  assert.match(source, /e\.key === 'ArrowDown' \|\| e\.key === 'ArrowUp'/);
  assert.match(source, /e\.key === 'Enter'[\s\S]*?handleSelect\(suggestions\[activeSuggestionIndex\]\.slug\)/);
});

test('admin dashboard reports unavailable source totals instead of inventing zero counts', async () => {
  const source = await readFile(new URL('../src/components/AdminDashboard.tsx', import.meta.url), 'utf8');
  assert.match(source, /Chưa có dữ liệu đối chiếu với kho nguồn/);
  assert.doesNotMatch(source, /Math\.max\(0, \(data\.total_source_movies/);
  assert.match(source, /total_source_movies: data\.total_source_movies/);
  assert.match(source, /method: 'POST'[\s\S]*?body: JSON\.stringify\(\{ level, message \}\)/);
});
