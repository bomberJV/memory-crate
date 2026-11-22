import assert from 'node:assert/strict';
import test from 'node:test';
import { scenario } from '../memory/admission/scenario.js';

test('waiting and trimming admit the same complete third request at different costs', () => {
  const { initial, demand, trimmed, afterRelease, incomingCapacity } = scenario;
  assert.equal(incomingCapacity, 809);
  assert.equal(demand.allocation.fits, false);
  assert.deepEqual(initial.requests.map(r => r.retained), [32768, 32768, 0]);
  assert.deepEqual(trimmed.requests.map(r => r.retained), [28672, 28672, 8192]);
  assert.deepEqual(afterRelease.requests.map(r => r.retained), [0, 32768, 8192]);
  for (const frame of [initial, trimmed, afterRelease]) {
    assert.equal(frame.allocation.fits, true);
    assert.equal(frame.allocation.weights, demand.allocation.weights);
    assert.equal(frame.allocation.reserve, demand.allocation.reserve);
  }
  assert.equal(trimmed.allocation.total, initial.allocation.total);
});
