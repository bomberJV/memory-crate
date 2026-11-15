import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE, DEFAULT_BUILD, MISSIONS, weightsGiB, cacheGiB, accounting, sanitizeBuild, isValidBuild, sanitizeProgress, bestPrecision, evaluateMission, cellSegments, precisionOptions } from '../memory/model.js';

test('weight storage distinguishes decimal parameter counts from binary GiB', () => {
  assert.equal(weightsGiB(8, 4), 4_000_000_000 / 2 ** 30);
  assert.equal(weightsGiB(8, 16), weightsGiB(8, 4) * 4);
  assert.ok(weightsGiB(70, 16) > 130);
});
test('cache matches the explicit architecture and scales with sequence count, not weight bits', () => {
  assert.equal(cacheGiB(8192, 1), 1);
  assert.equal(cacheGiB(16384, 4), 8);
  assert.equal(cacheGiB(0, 4), 0);
  assert.equal(cacheGiB(8192, 1, { ...ARCHITECTURE, cacheBits: 8 }), .5);
  assert.equal(accounting({ ...DEFAULT_BUILD, bits: 4 }).cache, accounting({ ...DEFAULT_BUILD, bits: 32 }).cache);
});
test('capacity accounting includes cache and reserve and keeps overflow separate from free space', () => {
  const build = { ...DEFAULT_BUILD, bits: 4 };
  const result = accounting(build);
  assert.equal(result.total, result.weights + result.cache + result.reserve);
  assert.equal(result.free + result.total, build.capacity);
  assert.equal(result.overflow, 0);
  const over = accounting({ ...build, bits: 32 });
  assert.equal(over.free, 0);
  assert.equal(over.overflow + over.capacity, over.total);
  assert.equal(over.fits, false);
});
test('all four missions are solvable and demand the highest feasible precision', () => {
  assert.deepEqual(MISSIONS.map(bestPrecision), [8, 4, 8, 8]);
  for (const mission of MISSIONS) {
    const build = { parameters: mission.minParameters, bits: bestPrecision(mission), capacity: mission.capacity, tokens: mission.minTokens, sequences: mission.minSequences, reserve: mission.reserve };
    assert.equal(evaluateMission(build, mission).solved, true);
    assert.equal(evaluateMission({ ...build, bits: build.bits * 2 }, mission).solved, false);
    if (build.bits > 4) {
      const lower = evaluateMission({ ...build, bits: 4 }, mission);
      assert.equal(lower.meetsBrief, true);
      assert.equal(lower.solved, false);
    }
  }
});
test('mission credit cannot be earned by shrinking the requested model, context, reserve or sequences', () => {
  const mission = MISSIONS[2];
  const build = { parameters: 13, bits: 8, capacity: 24, tokens: 16384, sequences: 2, reserve: 2 };
  for (const patch of [{ parameters: 3 }, { tokens: 2048 }, { sequences: 1 }, { reserve: 0 }, { capacity: 80 }]) assert.equal(evaluateMission({ ...build, ...patch }, mission).solved, false);
});
test('grid fractions account for every cell and distinguish partial components without rounding whole cells', () => {
  const result = accounting({ ...DEFAULT_BUILD, bits: 4 });
  const totals = { weights: 0, cache: 0, reserve: 0, empty: 0 };
  for (let index = 0; index < 64; index++) {
    const segments = cellSegments(result, index);
    assert.ok(Math.abs(segments.reduce((sum, s) => sum + s.fraction, 0) - 1) < 1e-10);
    for (const segment of segments) totals[segment.kind] += segment.fraction * result.capacity / 64;
  }
  assert.ok(Math.abs(totals.weights - result.weights) < 1e-10);
  assert.equal(totals.cache, result.cache);
  assert.equal(totals.reserve, result.reserve);
  assert.ok(Math.abs(totals.empty - result.free) < 1e-10);
  const over = accounting({ ...DEFAULT_BUILD, parameters: 70 });
  assert.equal(cellSegments(over, 63)[0].fraction, 1);
});
test('malformed saved settings and progress cannot introduce unsupported numbers or mission ids', () => {
  assert.deepEqual(sanitizeBuild(null), DEFAULT_BUILD);
  assert.equal(isValidBuild(DEFAULT_BUILD), true);
  assert.equal(isValidBuild({ bits: 4 }), false);
  assert.equal(isValidBuild({ ...DEFAULT_BUILD, tokens: '8192' }), false);
  assert.deepEqual(sanitizeBuild({ parameters: -1, bits: 7, capacity: Infinity, tokens: '<script>', sequences: 1e9, reserve: null }), DEFAULT_BUILD);
  const partial = sanitizeBuild({ ...DEFAULT_BUILD, bits: 4 });
  assert.equal(partial.bits, 4);
  assert.deepEqual(sanitizeProgress(['small-box', 'unknown', 3, 'small-box', 'two-at-once']), ['small-box', 'two-at-once']);
});
test('invalid math input fails explicitly instead of showing NaN estimates', () => {
  assert.throws(() => weightsGiB(NaN, 4), RangeError);
  assert.throws(() => cacheGiB(-1, 1), RangeError);
  assert.throws(() => cacheGiB(8, 1, {}), RangeError);
  assert.throws(() => accounting({ ...DEFAULT_BUILD, capacity: 0 }), RangeError);
  assert.throws(() => cellSegments(accounting(DEFAULT_BUILD), 64), RangeError);
});
test('precision comparison changes only weights and uses the same budget for every card', () => {
  const comparison = precisionOptions(DEFAULT_BUILD);
  assert.deepEqual(comparison.map(c => c.bits), [4, 8, 16, 32]);
  assert.equal(comparison[0].weights * 8, comparison[3].weights);
  assert.ok(comparison.every(c => c.cache === comparison[0].cache && c.reserve === comparison[0].reserve && c.capacity === comparison[0].capacity));
});
