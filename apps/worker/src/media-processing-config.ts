export function mediaMaxWidth(value = process.env.MEDIA_MAX_WIDTH) {
  const parsed = Number.parseInt(value || "", 10);
  if (!Number.isFinite(parsed)) return 1920;
  return Math.min(Math.max(parsed, 320), 7680);
}

export function mediaScaleFilter(value = process.env.MEDIA_MAX_WIDTH) {
  return `scale='min(${mediaMaxWidth(value)},iw)':-2`;
}

export function mediaPosterTime(durationSeconds: number, value = process.env.MEDIA_POSTER_TIME) {
  const parsed = Number(value);
  const requested = Number.isFinite(parsed) && parsed >= 0 ? parsed : 3;
  const duration = Number.isFinite(durationSeconds) && durationSeconds > 0 ? durationSeconds : 0;
  return Math.min(requested, duration / 2).toFixed(3);
}
