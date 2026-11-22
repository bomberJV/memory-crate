import test from 'node:test';
import assert from 'node:assert/strict';
import { GIB, accounting, TRACE_BUILD } from '../memory/model.js';
import { END_STEP, EVENT_STEPS, ORIGINAL_LOAD, workloadAt, workloadPreset, workloadProfile } from '../memory/workload-model.js';

test('unequal requests share one set of weights and the initial 24 GiB boundary is byte-exact', () => {
  const profile = workloadProfile(ORIGINAL_LOAD);
  const prior = workloadAt(ORIGINAL_LOAD, profile.breach.step - 1);
  assert.deepEqual(prior.requests.map(r => r.retained), [32768, 32768, 809]);
  assert.deepEqual(profile.breach.requests.map(r => r.retained), [32768, 32768, 810]);
  assert.equal(prior.allocation.free * GIB, 90112);
  assert.equal(profile.breach.allocation.overflow * GIB, 40960);
  assert.equal(profile.peak.step, 5 * EVENT_STEPS);
  assert.equal(profile.peak.allocation.weights * GIB, 16e9);
  assert.deepEqual(profile.peak.requests.map(r => r.cache), [4, 4, 1]);
  assert.equal(profile.peak.allocation.total, 24.901161193847656);
  const same = accounting({ ...TRACE_BUILD, capacity: 24, tokens: 32768, sequences: 2 });
  assert.deepEqual(workloadAt(ORIGINAL_LOAD, 3 * EVENT_STEPS).allocation, same);
});

test('queueing, weight precision and trimming have distinct consequences', () => {
  const queue = workloadPreset('queue'), precision = workloadPreset('precision'), trim = workloadPreset('trim');
  assert.equal(queue.arrival, 7);
  assert.equal(queue.c, ORIGINAL_LOAD.c);
  assert.equal(workloadProfile(queue).peak.allocation.total, 23.901161193847656);
  assert.equal(workloadProfile(queue).breach, null);
  assert.equal(precision.bits, 8);
  assert.equal(workloadProfile(precision).peak.allocation.cache, 9);
  assert.equal(workloadProfile(precision).peak.allocation.total, 17.450580596923828);
  assert.equal(trim.c, 809);
  assert.equal(workloadProfile(trim).peak.allocation.free * GIB, 90112);
  assert.ok(workloadProfile({ ...trim, c: trim.c + 1 }).breach);
  assert.deepEqual(workloadPreset('original'), ORIGINAL_LOAD);
});

test('a finish and arrival at one event release the old private cache first', () => {
  const plan = workloadPreset('queue');
  const before = workloadAt(plan, 7 * EVENT_STEPS - 1);
  const release = workloadAt(plan, 7 * EVENT_STEPS);
  assert.deepEqual(before.requests.map(r => r.retained), [32768, 32768, 0]);
  assert.deepEqual(release.requests.map(r => r.retained), [0, 32768, 0]);
  assert.equal(before.allocation.weights, release.allocation.weights);
  assert.equal(before.allocation.reserve, release.allocation.reserve);
  const almost = workloadProfile({ ...plan, arrival: 6 });
  assert.equal(almost.peak.step, 7 * EVENT_STEPS - 1);
  assert.deepEqual(almost.peak.requests.map(r => r.retained), [32768, 32768, 8191]);
  assert.equal(workloadAt(plan, END_STEP).allocation.cache, 0);
});

test('custom inputs include empty workloads, a loaded model already over budget, and invalid inputs', () => {
  const empty = { ...ORIGINAL_LOAD, a: 0, b: 0, c: 0 };
  assert.equal(workloadProfile(empty).peak.step, 0);
  assert.equal(workloadProfile(empty).breach, null);
  const over = workloadProfile({ ...empty, capacity: 16, reserve: 2 });
  assert.equal(over.breach.step, 0);
  for (const edit of [{ a: -1 }, { b: 32769 }, { c: .5 }, { arrival: 8.5 }, { bits: 12 }, { reserve: NaN }, { capacity: 0 }]) {
    assert.throws(() => workloadProfile({ ...ORIGINAL_LOAD, ...edit }), RangeError);
  }
  assert.throws(() => workloadAt(empty, -1), RangeError);
  assert.throws(() => workloadPreset('unknown'), RangeError);
});
