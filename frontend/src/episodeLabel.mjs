export function formatEpisodeLabel(name) {
  const numberOrTitle = String(name ?? '').replace(/^Tập\s*/i, '').trim();
  return `Tập ${numberOrTitle || '1'}`;
}
