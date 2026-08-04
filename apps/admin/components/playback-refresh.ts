export function playbackRefreshDelay(expires: number, now = Date.now()) {
  return Math.max(1_000, expires * 1_000 - now - 60_000);
}
