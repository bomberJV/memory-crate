import test from 'node:test';
import assert from 'node:assert/strict';
import { ARCHITECTURE, DEFAULT_BUILD, TRACE_BUILD, MISSIONS, weightsBytes, cacheBytes, bytesToGB, bytesToGiB, weightsGiB, cacheGiB, accounting, allocationTrace, contextSeries, sanitizeBuild, isValidBuild, sanitizeProgress, bestPrecision, evaluateMission, cellSegments, precisionOptions } from '../memory/model.js';

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

test('I-01: byte receipts independently reconcile decimal GB and binary GiB', () => {
  const sixteenBitBytes = weightsBytes(8, 16);
  assert.equal(sixteenBitBytes, 16_000_000_000);
  assert.equal(bytesToGB(sixteenBitBytes), 16);
  assert.equal(bytesToGiB(sixteenBitBytes), 14.901161193847656);
  assert.equal(weightsGiB(8, 16).toFixed(3), '14.901');
  const fourBitBytes = weightsBytes(8, 4);
  assert.equal(fourBitBytes, 4_000_000_000);
  assert.equal(bytesToGB(fourBitBytes), 4);
  assert.equal(bytesToGiB(fourBitBytes), 3.725290298461914);
  // Fixed oracle, rather than deriving the expected cache through the implementation.
  assert.equal(cacheBytes(8192, 1, { layers: 32, kvHeads: 8, headDimension: 128, cacheBits: 16 }), 1_073_741_824);
  assert.equal(bytesToGiB(cacheBytes(8192, 1)), 1);
  assert.equal(bytesToGB(cacheBytes(8192, 1)), 1.073741824);
});

test('I-02: concurrent sequences double the cache while preserving shared weights and reserve', () => {
  const before = { ...TRACE_BUILD, tokens: 8192 };
  const trace = allocationTrace(before, { ...before, sequences: 2 });
  assert.deepEqual(trace.changedInputs, ['sequences']);
  assert.equal(trace.before.cache, 1);
  assert.equal(trace.after.cache, 2);
  assert.equal(trace.after.weights, trace.before.weights);
  assert.equal(trace.after.reserve, trace.before.reserve);
  assert.equal(trace.after.total - trace.before.total, 1);
  assert.deepEqual(trace.rows.filter(row => !row.affected).map(row => row.key), ['weights', 'reserve', 'capacity']);
  const cacheRow = trace.rows.find(row => row.key === 'cache');
  assert.equal(cacheRow.changed, true);
  assert.equal(cacheRow.delta, 1);
});

test('I-02: every changed constraint exposes only its allocation dependencies', () => {
  const before = { ...TRACE_BUILD, tokens: 8192 };
  const cases = [
    ['parameters', 13, ['weights', 'total', 'free', 'overflow']],
    ['bits', 4, ['weights', 'total', 'free', 'overflow']],
    ['tokens', 16384, ['cache', 'total', 'free', 'overflow']],
    ['sequences', 2, ['cache', 'total', 'free', 'overflow']],
    ['reserve', 2, ['reserve', 'total', 'free', 'overflow']],
    ['capacity', 24, ['capacity', 'free', 'overflow']]
  ];
  for (const [key, value, affected] of cases) {
    const trace = allocationTrace(before, { ...before, [key]: value });
    assert.deepEqual(trace.changedInputs, [key]);
    assert.deepEqual(trace.rows.filter(row => row.affected).map(row => row.key), affected, key);
    for (const row of trace.rows.filter(row => !row.affected)) {
      assert.equal(row.changed, false, `${key} must not change ${row.key}`);
      assert.equal(row.delta, 0);
    }
  }
  const precision = allocationTrace(before, { ...before, bits: 4 });
  assert.equal(precision.after.weights, precision.before.weights / 4);
  assert.equal(precision.after.cache, 1);
  assert.equal(precision.rows.find(row => row.key === 'reserve').kind, 'assumed');
  assert.equal(precision.rows.find(row => row.key === 'capacity').kind, 'assumed');
});

test('I-03: zero context and context growth keep all allocations visible across the boundary', () => {
  const series = contextSeries(TRACE_BUILD);
  assert.deepEqual(series.map(point => point.tokens), [0, 2048, 8192, 16384, 32768]);
  assert.deepEqual(series.map(point => point.cache), [0, .25, 1, 2, 4]);
  assert.deepEqual(series.map(point => point.fits), [true, false, false, false, false]);
  assert.equal(series[0].total, 15.901161193847656);
  assert.equal(series[2].total, 16.901161193847656);
  assert.equal(series[2].overflow, .9011611938476562);
  for (const point of series) {
    assert.equal(point.weights, 14.901161193847656);
    assert.equal(point.reserve, 1);
    assert.equal(point.capacity, 16);
    assert.equal(point.total, point.weights + point.cache + point.reserve);
    assert.equal(point.free > 0 && point.overflow > 0, false);
  }
  const zero = allocationTrace(TRACE_BUILD, { ...TRACE_BUILD, sequences: 2 });
  const cacheRow = zero.rows.find(row => row.key === 'cache');
  assert.equal(cacheRow.affected, true);
  assert.equal(cacheRow.changed, false);
  assert.equal(cacheRow.after, 0);
});

test('I-03: exact budget fits, but even one byte of overflow exceeds it', () => {
  const total = accounting(DEFAULT_BUILD).total;
  const exact = accounting({ ...DEFAULT_BUILD, capacity: total });
  assert.equal(exact.fits, true);
  assert.equal(exact.free, 0);
  assert.equal(exact.overflow, 0);
  const over = accounting({ ...DEFAULT_BUILD, capacity: total - 1 / 2 ** 30 });
  assert.equal(over.fits, false);
  assert.equal(over.overflow, 1 / 2 ** 30);
  assert.equal(over.free, 0);
  const under = accounting({ ...DEFAULT_BUILD, capacity: total + 1 / 2 ** 30 });
  assert.equal(under.fits, true);
  assert.equal(under.free, 1 / 2 ** 30);
  assert.equal(under.overflow, 0);
});

test('I-03: invalid inputs and overflowing products fail explicitly across accounting APIs', () => {
  for (const key of ['parameters', 'bits', 'tokens', 'sequences', 'reserve', 'capacity']) {
    for (const value of [-1, NaN, Infinity, -Infinity, undefined, null, '8']) {
      const invalid = { ...TRACE_BUILD, [key]: value };
      assert.throws(() => accounting(invalid), RangeError, key);
      assert.throws(() => allocationTrace(TRACE_BUILD, invalid), RangeError, key);
      assert.throws(() => contextSeries(invalid), RangeError, key);
    }
  }
  for (const value of [-1, NaN, Infinity, '1024', null]) {
    assert.throws(() => bytesToGB(value), RangeError);
    assert.throws(() => bytesToGiB(value), RangeError);
  }
  for (const invalid of [null, [], undefined]) assert.throws(() => accounting(invalid), RangeError);
  assert.throws(() => weightsBytes(Number.MAX_VALUE, 16), RangeError);
  assert.throws(() => cacheBytes(Number.MAX_VALUE, 1), RangeError);
  assert.throws(() => cacheBytes(8192, 1, null), RangeError);
  assert.throws(() => accounting({ ...TRACE_BUILD, parameters: Number.MAX_VALUE }), RangeError);
  assert.equal(bytesToGB(0), 0);
  assert.equal(bytesToGiB(0), 0);
});

test('I-03: trace calculations preserve the baseline and resetting has no stale changes', () => {
  const baseline = Object.freeze({ ...TRACE_BUILD });
  const scenario = Object.freeze({ ...baseline, tokens: 8192, sequences: 2, bits: 4 });
  const savedBaseline = { ...baseline }, savedScenario = { ...scenario };
  const first = allocationTrace(baseline, scenario);
  contextSeries(scenario);
  assert.deepEqual(allocationTrace(baseline, scenario), first);
  assert.deepEqual(baseline, savedBaseline);
  assert.deepEqual(scenario, savedScenario);
  assert.equal(Object.isFrozen(TRACE_BUILD), true);
  const reset = allocationTrace(baseline, { ...TRACE_BUILD });
  assert.deepEqual(reset.changedInputs, []);
  assert.deepEqual(reset.before, reset.after);
  assert.ok(reset.rows.every(row => !row.affected && !row.changed && row.delta === 0));
  assert.equal(reset.after.cache, 0);
  assert.equal(reset.after.fits, true);
});

