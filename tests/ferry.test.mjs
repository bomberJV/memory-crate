import test from 'node:test';
import assert from 'node:assert/strict';
import { LOG_LENGTH, SLIP_LENGTH, LAST_FITTING_PIECE, PIERS, EVENINGS, bellAtPier, crossingAllocation, windLog, recoverLog } from '../memory/ferry-model.js';

test('the last ferry reaches the byte-exact boundary between pieces 809 and 810', () => {
  assert.equal(LAST_FITTING_PIECE, 809);
  assert.equal(windLog(809).allocation.free * 2 ** 30, 90_112);
  const next = windLog(810);
  assert.equal(next.held, 809);
  assert.equal(next.attempted, 810);
  assert.equal(next.blocked, true);
  assert.equal(next.allocation.overflow * 2 ** 30, 40_960);
  assert.deepEqual(windLog(LOG_LENGTH), next);
  assert.equal(windLog(0).allocation.cache, 0);
  for (const invalid of [-1, 0.5, Infinity, '809', LOG_LENGTH + 1]) assert.throws(() => windLog(invalid), RangeError);
});

test('both routes retain both clues and expose the cost of the visitor’s choice', () => {
  const full = recoverLog('compact'), slips = recoverLog('slips');
  assert.ok(full.allocation.fits && slips.allocation.fits);
  assert.deepEqual(full.spans, [[1, 8192]]);
  assert.deepEqual(slips.spans, [[1, 128], [8065, 8192]]);
  assert.equal(full.hasMarginNote, true);
  assert.equal(slips.hasMarginNote, false);
  assert.equal(slips.tokens, 2 * SLIP_LENGTH);
  assert.equal(full.allocation.total, 9.450580596923828);
  assert.equal(slips.allocation.total, 15.932411193847656);
  assert.equal(full.allocation.cache, crossingAllocation(LOG_LENGTH).cache);
  assert.equal(slips.allocation.weights, crossingAllocation(LOG_LENGTH).weights);
  assert.equal(full.allocation.reserve, 1);
  assert.equal(slips.allocation.reserve, 1);
  assert.throws(() => recoverLog('unknown'), RangeError);
});

test('each evening has exactly one matching lamp and all three destinations can be reached', () => {
  const destinations = EVENINGS.map(evening => {
    const matches = PIERS.map(pier => bellAtPier(evening, pier.id)).filter(reply => reply.matches);
    assert.equal(matches.length, 1);
    return matches[0].pier.id;
  });
  assert.deepEqual(destinations, ['glass', 'mill', 'clock']);
});
