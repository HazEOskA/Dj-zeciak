/** Pure control maths: no browser, DOM or audio-device dependencies. */
export type FilterKind = 'allpass' | 'lowpass' | 'highpass';
export function finiteClamp(value: number, min: number, max: number, fallback = min): number {
  return Math.min(max, Math.max(min, Number.isFinite(value) ? value : fallback));
}
export function equalPower(position: number): { a: number; b: number } {
  const x = finiteClamp(position, 0, 1, 0.5);
  return { a: Math.cos(x * Math.PI / 2), b: Math.sin(x * Math.PI / 2) };
}
export function filterParameters(position: number): { type: FilterKind; frequency: number } {
  const value = finiteClamp(position, -100, 100, 0);
  if (Math.abs(value) < 3) return { type: 'allpass', frequency: 1000 };
  return value < 0
    ? { type: 'lowpass', frequency: finiteClamp(18000 * Math.pow(80, value / 100), 150, 18000) }
    : { type: 'highpass', frequency: finiteClamp(40 * Math.pow(200, value / 100), 40, 18000) };
}
export function normalizeVolume(value: number): number {
  return finiteClamp(value, 0, 1, 0);
}
export function normalizeEQ(value: number): number {
  return finiteClamp(value, -12, 12, 0);
}
export function safeEchoWet(value: number): number {
  return finiteClamp(value, 0, 0.55, 0);
}
export function syncPlaybackRate(sourceBpm: number, targetBpm: number): number {
  if (!Number.isFinite(sourceBpm) || !Number.isFinite(targetBpm) || sourceBpm <= 0 || targetBpm <= 0) return 1;
  return finiteClamp(targetBpm / sourceBpm, 0.5, 2, 1);
}
