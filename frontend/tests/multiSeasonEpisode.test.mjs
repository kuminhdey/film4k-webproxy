import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import ts from 'typescript';

async function loadApiModule() {
  const src = await readFile(new URL('../src/api.ts', import.meta.url), 'utf8');
  const stripped = src.replace(/import\s+[\s\S]*?from\s+['"]\.\/types['"];/, '');
  const js = ts.transpileModule(stripped, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

async function loadWatchHelpers() {
  const src = await readFile(new URL('../src/components/WatchPage.tsx', import.meta.url), 'utf8');
  const marker = 'interface WatchPageProps';
  const idx = src.indexOf(marker);
  assert.ok(idx !== -1, 'Expected WatchPageProps marker in WatchPage.tsx');
  const helperSection = src
    .slice(0, idx)
    .replace(/^import\s+[\s\S]*?;$/gm, '');
  const js = ts.transpileModule(helperSection, {
    compilerOptions: { module: ts.ModuleKind.ESNext, target: ts.ScriptTarget.ES2022 },
  }).outputText;
  return import(`data:text/javascript,${encodeURIComponent(js)}`);
}

function buildFriendsRawMock() {
  const episodes = [];
  // Season 1: 24 episodes
  for (let ep = 1; ep <= 24; ep += 1) {
    episodes.push({
      season: 1,
      episode: ep,
      title: ep === 5 ? 'Bột giặt Đông Đức' : `S1 Tập ${ep}`,
      servers: [{ label: 'VIP #1', embed: `https://embed.example/s1e${ep}` }],
    });
  }
  // Season 2: 24 episodes
  for (let ep = 1; ep <= 24; ep += 1) {
    episodes.push({
      season: 2,
      episode: ep,
      title:
        ep === 1
          ? 'Bạn gái mới của Ross'
          : ep === 5
          ? 'Năm miếng thịt nướng và một quả cà tím'
          : `S2 Tập ${ep}`,
      servers: [{ label: 'VIP #1', embed: `https://embed.example/s2e${ep}` }],
    });
  }
  return {
    id: 'friends',
    slug: 'friends',
    type: 'tv',
    title_vi: 'Những Người Bạn',
    title_en: 'Friends',
    totalEpisodes: episodes.length,
    genres: ['Hài hước', 'Tình cảm'],
    episodes,
  };
}

test('movieDetailAdapter assigns unique globalIndex slugs and season query for multi-season series', async () => {
  const { movieDetailAdapter } = await loadApiModule();
  const detail = movieDetailAdapter(buildFriendsRawMock());
  const items = detail.episodes[0].items;

  assert.equal(items.length, 48);

  // Verify all episode slugs are unique (no S2E1 colliding on tap-1)
  const uniqueSlugs = new Set(items.map((item) => item.slug));
  assert.equal(uniqueSlugs.size, 48);

  // Episode 5 (index 4): S1E5 "Bột giặt Đông Đức"
  const s1e5 = items[4];
  assert.equal(s1e5.name, 'Bột giặt Đông Đức');
  assert.equal(s1e5.slug, 'tap-5');
  assert.equal(s1e5.season, 1);
  assert.equal(s1e5.episode, 5);
  assert.equal(s1e5.globalIndex, 5);
  assert.equal(s1e5.m3u8, '/api/stream/friends/ep/5/master.m3u8?season=1');
  assert.equal(s1e5.embed, 'https://embed.example/s1e5');

  // Episode 25 (index 24): S2E1 "Bạn gái mới của Ross"
  const s2e1 = items[24];
  assert.equal(s2e1.name, 'Bạn gái mới của Ross');
  assert.equal(s2e1.slug, 'tap-25');
  assert.equal(s2e1.season, 2);
  assert.equal(s2e1.episode, 1);
  assert.equal(s2e1.globalIndex, 25);
  assert.equal(s2e1.m3u8, '/api/stream/friends/ep/25/master.m3u8?season=2');
  assert.equal(s2e1.embed, 'https://embed.example/s2e1');

  // Episode 29 (index 28): S2E5 "Năm miếng thịt nướng và một quả cà tím"
  const s2e5 = items[28];
  assert.equal(s2e5.name, 'Năm miếng thịt nướng và một quả cà tím');
  assert.equal(s2e5.slug, 'tap-29');
  assert.equal(s2e5.season, 2);
  assert.equal(s2e5.episode, 5);
  assert.equal(s2e5.globalIndex, 29);
  assert.equal(s2e5.m3u8, '/api/stream/friends/ep/29/master.m3u8?season=2');
});

test('movieDetailAdapter preserves single-season slug and HLS URL conventions', async () => {
  const { movieDetailAdapter } = await loadApiModule();
  const detail = movieDetailAdapter({
    slug: 'single-show',
    type: 'tv',
    title_vi: 'Single Season Show',
    episodes: [
      { season: 1, episode: 1, title: 'Tập 1', sources: [] },
      { season: 1, episode: 2, title: 'Tập 2', sources: [] },
      { season: 1, episode: 3, title: 'Tập 3', sources: [] },
    ],
  });

  const items = detail.episodes[0].items;
  assert.equal(items[0].slug, 'tap-1');
  assert.equal(items[0].m3u8, '/api/stream/single-show/master.m3u8');
  assert.equal(items[1].slug, 'tap-2');
  assert.equal(items[1].m3u8, '/api/stream/single-show/ep/2/master.m3u8');
  assert.equal(items[2].slug, 'tap-3');
  assert.equal(items[2].m3u8, '/api/stream/single-show/ep/3/master.m3u8');
});

test('movieDetailAdapter detects duplicate episode numbers even when season is omitted or 1', async () => {
  const { movieDetailAdapter } = await loadApiModule();
  const detail = movieDetailAdapter({
    slug: 'dup-show',
    type: 'tv',
    title_vi: 'Duplicate Ep Numbers',
    episodes: [
      { episode: 1, title: 'Part 1 Ep 1', sources: [] },
      { episode: 1, title: 'Part 2 Ep 1', sources: [] },
    ],
  });
  const items = detail.episodes[0].items;
  assert.equal(items[0].slug, 'tap-1');
  assert.equal(items[1].slug, 'tap-2');
  assert.equal(items[1].globalIndex, 2);
});

test('findEpisodeIndex resolves multi-season slugs, clean numbers, s{S}-tap-{E}, s{S}e{E}, and falls back to 0', async () => {
  const { movieDetailAdapter } = await loadApiModule();
  const { findEpisodeIndex } = await loadWatchHelpers();
  const detail = movieDetailAdapter(buildFriendsRawMock());
  const items = detail.episodes[0].items;

  // Direct slug match for S2E1
  assert.equal(findEpisodeIndex(items, 'tap-25'), 24);
  // Direct name match
  assert.equal(findEpisodeIndex(items, 'Bạn gái mới của Ross'), 24);
  // Clean number match
  assert.equal(findEpisodeIndex(items, '25'), 24);
  assert.equal(findEpisodeIndex(items, 'ep-29'), 28);
  // s{S}-tap-{E} and s{S}e{E} URL patterns
  assert.equal(findEpisodeIndex(items, 's2-tap-1'), 24);
  assert.equal(findEpisodeIndex(items, 's2e1'), 24);
  assert.equal(findEpisodeIndex(items, 's2-tap-5'), 28);
  assert.equal(findEpisodeIndex(items, 's2e5'), 28);
  assert.equal(findEpisodeIndex(items, 's02e05'), 28);
  assert.equal(findEpisodeIndex(items, 's1e5'), 4);
  // Fallback if not found
  assert.equal(findEpisodeIndex(items, 'tap-999'), 0);
  assert.equal(findEpisodeIndex(items, undefined), 0);
});

test('getEpisodeHlsUrl preserves season query for multi-season series and server index', async () => {
  const { getEpisodeHlsUrl } = await loadWatchHelpers();

  assert.equal(
    getEpisodeHlsUrl('interstellar', 1, false),
    '/api/stream/interstellar/master.m3u8'
  );
  assert.equal(
    getEpisodeHlsUrl('single-show', 1, true),
    '/api/stream/single-show/master.m3u8'
  );
  assert.equal(
    getEpisodeHlsUrl('single-show', 5, true),
    '/api/stream/single-show/ep/5/master.m3u8'
  );
  assert.equal(
    getEpisodeHlsUrl('friends', 5, true, 0, 1),
    '/api/stream/friends/ep/5/master.m3u8'
  );
  assert.equal(
    getEpisodeHlsUrl('friends', 25, true, 0, 2),
    '/api/stream/friends/ep/25/master.m3u8?season=2'
  );
  assert.equal(
    getEpisodeHlsUrl('friends', 29, true, 1, 2),
    '/api/stream/friends/ep/29/master.m3u8?season=2&server=1'
  );
});

test('EpisodeSelector, VideoPlayer, WatchPage, and MovieDetailPage implement multi-season rendering and stream preservation', async () => {
  const [selectorSrc, playerSrc, watchSrc, detailSrc] = await Promise.all([
    readFile(new URL('../src/components/EpisodeSelector.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/VideoPlayer.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/WatchPage.tsx', import.meta.url), 'utf8'),
    readFile(new URL('../src/components/MovieDetailPage.tsx', import.meta.url), 'utf8'),
  ]);

  // EpisodeSelector checks
  assert.match(selectorSrc, /key=\{\`\$\{item\.slug\}-\$\{idx\}\`\}/);
  assert.match(selectorSrc, /Tập \$\{item\.globalIndex \|\| item\.name\} \(Mùa \$\{item\.season\}\)/);
  assert.match(selectorSrc, /activeEpisodeIndex !== -1[\s\S]*?allEpisodes\[activeEpisodeIndex\] === item/);

  // WatchPage checks
  assert.match(watchSrc, /currentEpisode\?\.globalIndex \|\|\s*parseEpisodeNumber/);
  assert.match(watchSrc, /getEpisodeHlsUrl\(\s*movie\.slug,\s*epNum,\s*isSeries,\s*activeServerIndex,\s*currentEpisode\?\.season\s*\)/);

  // VideoPlayer checks: uses m3u8Url as primary stream URL and preserves it in auto-ingested check
  assert.match(playerSrc, /const activeEpSlug = currentEpisodeSlug \|\| episodeSlug;/);
  assert.match(playerSrc, /const currentEpKey = m3u8Url \|\| `\$\{movieSlug \|\| ''\}:\$\{activeEpSlug \|\| epNum\}`;/);
  assert.match(playerSrc, /const streamCheckUrl = m3u8Url \|\| `\$\{fallbackPath\}\$\{serverParam\}`;/);

  // MovieDetailPage checks
  assert.match(detailSrc, /Tập \$\{ep\.globalIndex \|\| ep\.name\} \(Mùa \$\{ep\.season\}\)/);
});
