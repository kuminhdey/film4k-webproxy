import test from 'node:test';
import assert from 'node:assert/strict';
import { formatEpisodeLabel } from '../src/episodeLabel.mjs';

test('formats raw episode names with one Tập prefix', () => {
  assert.equal(formatEpisodeLabel('2'), 'Tập 2');
  assert.equal(formatEpisodeLabel('Tập 2'), 'Tập 2');
  assert.equal(formatEpisodeLabel('tập 02'), 'Tập 02');
  assert.equal(formatEpisodeLabel('  '), 'Tập 1');
});
