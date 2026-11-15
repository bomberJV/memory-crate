/** Pure memory accounting for a deliberately simplified teaching model. */
export const GIB = 2 ** 30;
export const OPTIONS = Object.freeze({
  parameters: [3, 8, 13, 30, 70],
  bits: [4, 8, 16, 32],
  capacity: [4, 8, 16, 24, 80],
  tokens: [0, 2048, 8192, 16384, 32768],
  sequences: [1, 2, 4],
  reserve: [0, .5, 1, 2, 4]
});
export const ARCHITECTURE = Object.freeze({ layers: 32, kvHeads: 8, headDimension: 128, cacheBits: 16 });
export const DEFAULT_BUILD = Object.freeze({ parameters: 8, bits: 16, capacity: 8, tokens: 8192, sequences: 1, reserve: 1 });
export const MISSIONS = Object.freeze([
  { id: 'small-box', name: 'The pocket build', tagline: '3B parameters. 4 GiB to work with.', capacity: 4, reserve: .5, minParameters: 3, minTokens: 0, minSequences: 1,
    brief: 'Pack at least 3B parameters into 4 GiB. Keep 0.5 GiB aside. Cache is optional. Use the highest weight precision that meets the brief.',
    lesson: 'At 8-bit, the ideal weight storage is half what it is at 16-bit. That alone doesn’t tell you how good the answers will be.' },
  { id: 'long-conversation', name: 'Room for a conversation', tagline: 'The weights are only the beginning.', capacity: 8, reserve: 1, minParameters: 8, minTokens: 8192, minSequences: 1,
    brief: 'Fit at least 8B parameters and an 8,192-token cache into 8 GiB, with 1 GiB held aside. Find the highest weight precision that works in this model.',
    lesson: 'Changing the weight precision doesn’t change this 16-bit cache. They use separate parts of the budget.' },
  { id: 'two-at-once', name: 'Make room for two', tagline: 'Shared weights. Separate conversations.', capacity: 24, reserve: 2, minParameters: 13, minTokens: 16384, minSequences: 2,
    brief: 'Budget for at least 13B parameters and two sequences of 16,384 cached tokens each. You have 24 GiB, including a 2 GiB reserve. Preserve the most weight precision.',
    lesson: 'Both sequences use the same model weights. Each needs its own cache, so more sequences mean more cache storage.' },
  { id: 'big-crate', name: 'The big squeeze', tagline: 'A big model still has to fit.', capacity: 80, reserve: 4, minParameters: 70, minTokens: 16384, minSequences: 4,
    brief: 'Pack 70B parameters and four sequences of 16,384 cached tokens into 80 GiB. Keep 4 GiB aside. Use the highest weight precision possible.',
    lesson: 'Even 80 GiB goes quickly. This still uses the same example cache architecture, not a real 70B model.' }
]);

function finiteNonnegative(value, label) {
  if (!Number.isFinite(value) || value < 0) throw new RangeError(`${label} must be finite and nonnegative`);
  return value;
}
export function weightsGiB(parameters, bits) {
  finiteNonnegative(parameters, 'Parameters');
  finiteNonnegative(bits, 'Bits');
  return parameters * 1e9 * bits / 8 / GIB;
}
export function cacheGiB(tokens, sequences, architecture = ARCHITECTURE) {
  for (const [key, value] of Object.entries({ tokens, sequences, layers: architecture.layers, kvHeads: architecture.kvHeads, headDimension: architecture.headDimension, cacheBits: architecture.cacheBits })) finiteNonnegative(value, key);
  const { layers, kvHeads, headDimension, cacheBits } = architecture;
  return 2 * layers * kvHeads * headDimension * tokens * sequences * cacheBits / 8 / GIB;
}
export function accounting(build) {
  const weights = weightsGiB(build.parameters, build.bits);
  const cache = cacheGiB(build.tokens, build.sequences);
  const reserve = finiteNonnegative(build.reserve, 'Reserve');
  const capacity = finiteNonnegative(build.capacity, 'Capacity');
  if (capacity === 0) throw new RangeError('Capacity must be positive');
  const total = weights + cache + reserve;
  return { weights, cache, reserve, capacity, total, free: Math.max(0, capacity - total), overflow: Math.max(0, total - capacity), fits: total <= capacity + 1e-9 };
}
export function isValidBuild(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value) && Object.keys(OPTIONS).every(key => OPTIONS[key].includes(value[key])));
}
export function sanitizeBuild(value, fallback = DEFAULT_BUILD) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return { ...fallback };
  return Object.fromEntries(Object.keys(OPTIONS).map(key => [key, OPTIONS[key].includes(value[key]) ? value[key] : fallback[key]]));
}
export function precisionOptions(build) {
  return OPTIONS.bits.map(bits => ({ bits, ...accounting({ ...build, bits }) }));
}
export function bestPrecision(mission) {
  // More parameters, cache, or sequences cannot reduce the calculated storage.
  const minimum = { parameters: mission.minParameters, capacity: mission.capacity, tokens: mission.minTokens, sequences: mission.minSequences, reserve: mission.reserve };
  return [...OPTIONS.bits].reverse().find(bits => accounting({ ...minimum, bits }).fits) ?? null;
}
export function evaluateMission(build, mission) {
  const result = accounting(build);
  const requirements = [
    { id: 'parameters', label: `At least ${mission.minParameters}B parameters`, pass: build.parameters >= mission.minParameters },
    { id: 'tokens', label: mission.minTokens ? `At least ${mission.minTokens.toLocaleString('en-US')} cached tokens per sequence` : 'Cache is optional', pass: build.tokens >= mission.minTokens },
    { id: 'sequences', label: `At least ${mission.minSequences} sequence${mission.minSequences === 1 ? '' : 's'}`, pass: build.sequences >= mission.minSequences },
    { id: 'capacity', label: `${mission.capacity} GiB crate and ${mission.reserve} GiB reserve`, pass: build.capacity === mission.capacity && build.reserve === mission.reserve },
    { id: 'fits', label: 'Calculated total within the crate', pass: result.fits }
  ];
  const meetsBrief = requirements.every(r => r.pass);
  const optimum = bestPrecision(mission);
  return { requirements, meetsBrief, optimum, solved: meetsBrief && build.bits === optimum, result };
}
export function sanitizeProgress(value) {
  const ids = new Set(MISSIONS.map(m => m.id));
  return Array.isArray(value) ? [...new Set(value.filter(id => typeof id === 'string' && ids.has(id)))] : [];
}
export function cellSegments(result, index, count = 64) {
  if (!Number.isInteger(index) || index < 0 || index >= count || !Number.isInteger(count) || count < 1) throw new RangeError('Invalid cell');
  const start = index * result.capacity / count, end = (index + 1) * result.capacity / count, width = end - start;
  const limits = [0, result.weights, result.weights + result.cache, result.total, Math.max(result.total, result.capacity)];
  return ['weights', 'cache', 'reserve', 'empty'].map((kind, i) => ({ kind, fraction: Math.max(0, Math.min(end, limits[i + 1]) - Math.max(start, limits[i])) / width }));
}
export function formatGiB(value) {
  if (!Number.isFinite(value)) return '—';
  return value.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}
