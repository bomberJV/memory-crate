import { TRACE_BUILD, accounting, cacheGiB } from './model.js';

// A unitless subdivision allows a single token to be inspected even in the longest ramp.
export const EVENT_STEPS = 32768;
export const END_STEP = 10 * EVENT_STEPS;
export const ORIGINAL_LOAD = Object.freeze({
  a: 32768, b: 32768, c: 8192, arrival: 4, bits: 16, capacity: 24, reserve: 1
});

export function workloadRequests(plan) {
  return [
    { id: 'a', start: 1, release: 7, tokens: plan.a },
    { id: 'b', start: 2, release: 9, tokens: plan.b },
    { id: 'c', start: plan.arrival, release: plan.arrival + 2, tokens: plan.c }
  ];
}

function tokensAt(request, step) {
  const age = step - request.start * EVENT_STEPS;
  if (age <= 0 || step >= request.release * EVENT_STEPS) return 0;
  if (age >= EVENT_STEPS) return request.tokens;
  return Math.floor(request.tokens * age / EVENT_STEPS);
}

export function workloadAt(plan, step) {
  if (!Number.isInteger(step) || step < 0 || step > END_STEP) throw new RangeError('Invalid event position.');
  const requests = workloadRequests(plan).map(request => {
    const tokens = tokensAt(request, step);
    return { ...request, retained: tokens, cache: cacheGiB(tokens, 1) };
  });
  // Each private cache has the same geometry. Sum token positions across the unequal
  // requests and ask the original calculator for one set of shared weights and reserve.
  const tokens = requests.reduce((total, request) => total + request.retained, 0);
  const allocation = accounting({ ...TRACE_BUILD, tokens, bits: plan.bits, capacity: plan.capacity, reserve: plan.reserve });
  return { step, requests, tokens, allocation };
}

export function workloadProfile(plan) {
  for (const id of ['a', 'b', 'c']) {
    if (!Number.isInteger(plan[id]) || plan[id] < 0 || plan[id] > EVENT_STEPS) throw new RangeError('Request length must be between 0 and 32,768 whole tokens.');
  }
  if (!Number.isInteger(plan.arrival) || plan.arrival < 3 || plan.arrival > 8) throw new RangeError('C must arrive at event 3 through 8.');
  if (![4, 8, 16].includes(plan.bits) || ![16, 24, 32].includes(plan.capacity) || ![0, 0.5, 1, 2].includes(plan.reserve)) throw new RangeError('Unsupported workload configuration.');

  const steps = new Set([0, END_STEP]);
  for (const request of workloadRequests(plan)) {
    // Sample both sides of every release. A simultaneous arrival sees the released cache.
    for (const step of [request.start, request.start + 1, request.release]) steps.add(step * EVENT_STEPS);
    steps.add(request.release * EVENT_STEPS - 1);
  }
  const points = [...steps].sort((a, b) => a - b).map(step => workloadAt(plan, step));
  const peak = points.reduce((high, frame) => frame.allocation.total > high.allocation.total ? frame : high);
  const firstAbove = points.findIndex(frame => !frame.allocation.fits);
  let breach = null;
  if (firstAbove >= 0) {
    let low = firstAbove ? points[firstAbove - 1].step + 1 : 0;
    let high = points[firstAbove].step;
    // Between the sampled positions caches can only grow or stay level.
    while (low < high) {
      const middle = Math.floor((low + high) / 2);
      if (workloadAt(plan, middle).allocation.fits) low = middle + 1;
      else high = middle;
    }
    breach = workloadAt(plan, low);
  }
  return { points, peak, breach };
}

export function workloadPreset(name) {
  const plan = { ...ORIGINAL_LOAD };
  if (name === 'original') return plan;
  if (name === 'queue') return { ...plan, arrival: workloadRequests(plan)[0].release };
  if (name === 'precision') return { ...plan, bits: 8 };
  if (name !== 'trim') throw new RangeError('Unknown workload comparison.');
  let low = 0;
  let high = plan.c;
  while (low < high) {
    const mid = Math.ceil((low + high) / 2);
    if (workloadProfile({ ...plan, c: mid }).peak.allocation.fits) low = mid;
    else high = mid - 1;
  }
  return { ...plan, c: low };
}
