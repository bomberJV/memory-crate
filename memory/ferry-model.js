import { TRACE_BUILD, accounting } from './model.js';

// The passages are authored clues. Their numbered spans are a teaching fixture.
export const LOG_LENGTH = 8192;
export const SLIP_LENGTH = 128;
export const MARGIN_POSITION = 4316;
export const PIERS = Object.freeze([
  { id: 'clock', name: 'Clock Pier', x: 22 },
  { id: 'glass', name: 'Glasshouse', x: 54 },
  { id: 'mill', name: 'Mill Pier', x: 83 }
]);
export const EVENINGS = Object.freeze([
  { signal: 2, calls: [1, 2, 3] },
  { signal: 1, calls: [2, 3, 1] },
  { signal: 3, calls: [3, 1, 2] }
]);

export function crossingAllocation(tokens, bits = TRACE_BUILD.bits) {
  return accounting({ ...TRACE_BUILD, tokens, bits });
}

// Find the last whole token that fits by asking the workshop's calculator.
function lastFittingPrefix() {
  let low = 0;
  let high = LOG_LENGTH;
  while (low < high) {
    const middle = Math.ceil((low + high) / 2);
    if (crossingAllocation(middle).fits) low = middle;
    else high = middle - 1;
  }
  return low;
}
export const LAST_FITTING_PIECE = lastFittingPrefix();

export function windLog(requested) {
  if (!Number.isInteger(requested) || requested < 0 || requested > LOG_LENGTH) {
    throw new RangeError('Choose a whole piece on the log.');
  }
  const held = Math.min(requested, LAST_FITTING_PIECE);
  const attempted = Math.min(requested, held + 1);
  return { held, attempted, blocked: attempted > held, allocation: crossingAllocation(attempted) };
}

export function recoverLog(method) {
  if (method !== 'compact' && method !== 'slips') throw new RangeError('Unknown way to keep the clues.');
  const compact = method === 'compact';
  const bits = compact ? 8 : TRACE_BUILD.bits;
  const tokens = compact ? LOG_LENGTH : 2 * SLIP_LENGTH;
  const spans = compact ? [[1, LOG_LENGTH]] : [[1, SLIP_LENGTH], [LOG_LENGTH - SLIP_LENGTH + 1, LOG_LENGTH]];
  const hasMarginNote = spans.some(([start, end]) => start <= MARGIN_POSITION && MARGIN_POSITION <= end);
  return { method, bits, tokens, spans, hasMarginNote, allocation: crossingAllocation(tokens, bits) };
}

export function bellAtPier(evening, pierId) {
  const index = PIERS.findIndex(pier => pier.id === pierId);
  if (index < 0) throw new RangeError('Unknown pier.');
  return { pier: PIERS[index], bells: evening.calls[index], matches: evening.calls[index] === evening.signal };
}
