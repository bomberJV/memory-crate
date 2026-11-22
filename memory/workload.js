import { ARCHITECTURE, GIB, cacheBytes } from './model.js';
import { END_STEP, EVENT_STEPS, ORIGINAL_LOAD, workloadAt, workloadPreset, workloadProfile, workloadRequests } from './workload-model.js';
import { createWorkloadPlot } from './workload-plot.js';

export function mountWorkload() {
  const section = document.getElementById('workload');
  if (!section) return;
  const el = id => document.getElementById(id);
  const numbers = new Intl.NumberFormat('en-US');
  const gib = number => number.toFixed(3) + ' GiB';
  const bytes = number => numbers.format(Math.round(number * GIB)) + ' bytes';
  const headroom = value => value < 0.001 ? bytes(value) : gib(value);
  const original = workloadProfile(ORIGINAL_LOAD);
  const lastOriginalToken = workloadAt(ORIGINAL_LOAD, original.breach.step - 1).requests[2].retained;
  const buttons = [...section.querySelectorAll('[data-plan]')];
  const presets = new Map(buttons.map(button => [button.dataset.plan, workloadPreset(button.dataset.plan)]));
  let plan = { ...ORIGINAL_LOAD };
  let profile = original;
  let cursor = original.peak.step;
  let replay = 0;
  let paused = false;
  let lastPaint = 0;
  const draw = createWorkloadPlot(el('load-plot'), tick => seek(tick));

  function currentPreset() {
    return [...presets].find(([, candidate]) => Object.keys(ORIGINAL_LOAD).every(key => plan[key] === candidate[key]))?.[0];
  }
  let selected = 'original';

  function describeEvent(frame) {
    const phase = Math.floor(frame.step / EVENT_STEPS);
    const exact = frame.step % EVENT_STEPS === 0;
    const lead = 'Event ' + phase + (exact ? ' · ' : ' → ' + (phase + 1) + ' · ');
    const actions = [];
    for (const request of frame.requests) {
      const name = request.id.toUpperCase();
      if (exact && phase === request.release) actions.push(name + ' released');
      if (exact && phase === request.start) actions.push(name + ' admitted');
      if (exact && phase === request.start + 1) actions.push(name + ' at target');
      if (!exact && phase === request.start) actions.push(name + ' at ' + numbers.format(request.retained) + ' tokens');
    }
    if (actions.length) return lead + actions.join(', ');
    if (phase < 1) return lead + 'model loaded';
    const live = frame.requests.filter(r => r.retained > 0).map(r => r.id.toUpperCase());
    return lead + (live.length ? live.join(' + ') + ' resident' : 'all caches empty');
  }

  function showFrame() {
    const frame = workloadAt(plan, cursor);
    const allocation = frame.allocation;
    el('load-event').textContent = describeEvent(frame);
    el('load-weights').textContent = gib(allocation.weights);
    el('load-reserve').textContent = gib(allocation.reserve);
    for (const request of frame.requests) el('load-' + request.id).textContent = gib(request.cache);
    el('load-total').textContent = gib(allocation.total);
    const status = el('load-state');
    status.dataset.over = String(!allocation.fits);
    if (!allocation.fits) status.textContent = headroom(allocation.overflow) + ' over budget';
    else if (allocation.free === 0) status.textContent = 'Exactly at budget';
    else status.textContent = headroom(allocation.free) + ' free';
    el('load-scrub').value = String(cursor);
    el('load-scrub').setAttribute('aria-valuetext', describeEvent(frame) + ', ' + gib(allocation.total) + ' required');
    el('load-byte-receipt').textContent = 'At the cursor, ' + numbers.format(frame.tokens) + ' retained tokens use ' + bytes(allocation.cache) + ' of cache. Shared weights use ' +
      bytes(allocation.weights) + ', with ' + bytes(allocation.reserve) + ' held aside by assumption. Total required is ' + bytes(allocation.total) + ' against a ' + bytes(plan.capacity) + ' budget.';
    draw({ profile, original, frame, changed: selected !== 'original' });
  }

  function renderPlan() {
    selected = currentPreset();
    for (const button of buttons) button.setAttribute('aria-pressed', String(button.dataset.plan === selected));
    const peak = profile.peak.allocation;
    const delta = peak.total - original.peak.allocation.total;
    el('load-config').textContent = '8B model · ' + plan.bits + '-bit weights · ' + ARCHITECTURE.cacheBits + '-bit KV cache';
    el('load-peak').textContent = gib(peak.total);
    el('load-peak').dataset.over = String(!peak.fits);
    el('plan-delta').textContent = delta === 0 ? 'No change' : (delta < 0 ? '−' : '+') + gib(Math.abs(delta));
    el('load-original-key').hidden = selected === 'original';
    el('load-last').disabled = !profile.breach || profile.breach.step === 0;
    el('load-first').disabled = !profile.breach;
    let verdict = 'Every request fits the estimated budget.';
    if (profile.breach?.step === 0) verdict = 'The loaded model and reserve already exceed the budget.';
    else if (profile.breach) {
      const prev = workloadAt(plan, profile.breach.step - 1);
      const added = profile.breach.requests.filter((r, i) => r.retained > prev.requests[i].retained);
      verdict = added.length === 1
        ? 'Request ' + added[0].id.toUpperCase() + ' crosses the budget at token ' + numbers.format(added[0].retained) + '.'
        : 'Concurrent cache growth crosses the budget.';
    }
    el('plan-result-title').textContent = verdict;
    const words = {
      original: 'The two long requests leave space for ' + numbers.format(lastOriginalToken) + ' more tokens. The full third request takes the peak to ' + gib(peak.total) + '.',
      queue: 'Request C starts at event ' + plan.arrival + ', when A releases its cache. All ' + numbers.format(plan.a + plan.b + plan.c) + ' requested tokens are retained, with the model still at 16 bits.',
      precision: 'The same three requests overlap. Storing the shared weights at 8 bits frees ' + gib(original.peak.allocation.weights - peak.weights) + '. Every token still uses the original 16-bit cache.',
      trim: 'C keeps ' + numbers.format(plan.c) + ' of its original ' + numbers.format(ORIGINAL_LOAD.c) + ' tokens. Its start event and the other two requests stay fixed.'
    };
    el('plan-consequence').textContent = words[selected] ?? ('The plan requests ' + numbers.format(plan.a + plan.b + plan.c) + ' tokens in total. C begins at event ' + plan.arrival + ' with ' + plan.bits + '-bit shared weights and ' + plan.reserve + ' GiB held aside.');
    for (const request of workloadRequests(plan)) {
      const block = el('lane-' + request.id);
      block.style.left = request.start * 10 + '%';
      block.style.width = (request.release - request.start) * 10 + '%';
      block.title = request.id.toUpperCase() + ' occupies events ' + request.start + ' through ' + request.release + ' (release)';
    }
    el('load-arrival').value = String(plan.arrival);
    el('load-arrival').setAttribute('aria-valuetext', 'Event ' + plan.arrival + ', releases at event ' + (plan.arrival + 2));
    el('lane-help').textContent = 'C arrives at event ' + plan.arrival + '. Drag its handle to move the request.';
    for (const key of ['a', 'b', 'c', 'bits', 'capacity', 'reserve']) el('edit-' + key).value = String(plan[key]);
    showFrame();
  }

  function stopReplay(allowResume = false) {
    cancelAnimationFrame(replay);
    replay = 0;
    paused = allowResume;
    el('load-play').textContent = allowResume ? 'Resume replay' : 'Replay trace';
    el('load-play').setAttribute('aria-pressed', 'false');
  }
  function seek(step, announce = false) {
    stopReplay();
    cursor = step;
    showFrame();
    if (announce) el('load-announcement').textContent = el('load-event').textContent + '. ' + el('load-state').textContent + '.';
  }
  function applyPlan(next) {
    const nextProfile = workloadProfile(next);
    stopReplay();
    plan = next;
    profile = nextProfile;
    renderPlan();
    el('load-announcement').textContent = el('plan-result-title').textContent + ' Peak ' + el('load-peak').textContent + '.';
  }

  for (const button of buttons) button.addEventListener('click', () => applyPlan({ ...presets.get(button.dataset.plan) }));
  el('load-arrival').addEventListener('input', event => applyPlan({ ...plan, arrival: Number(event.target.value) }));
  el('load-scrub').addEventListener('input', event => seek(Number(event.target.value)));
  el('load-scrub').addEventListener('keydown', event => {
    if (!['ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown'].includes(event.key)) return;
    event.preventDefault();
    const forward = event.key === 'ArrowRight' || event.key === 'ArrowUp';
    const nextEvent = forward ? Math.floor(cursor / EVENT_STEPS) + 1 : Math.ceil(cursor / EVENT_STEPS) - 1;
    seek(Math.min(END_STEP, Math.max(0, nextEvent * EVENT_STEPS)), true);
  });
  el('load-last').addEventListener('click', () => { if (profile.breach?.step > 0) seek(profile.breach.step - 1, true); });
  el('load-first').addEventListener('click', () => { if (profile.breach) seek(profile.breach.step, true); });
  el('load-peak-jump').addEventListener('click', () => seek(profile.peak.step, true));
  el('load-form').addEventListener('submit', event => {
    event.preventDefault();
    const form = event.currentTarget;
    if (!form.reportValidity()) return;
    const next = { ...plan };
    for (const [key, value] of new FormData(form)) next[key] = Number(value);
    applyPlan(next);
  });
  el('load-play').addEventListener('click', () => {
    if (replay) { stopReplay(true); return; }
    if (!paused) cursor = 0;
    const initial = cursor;
    const start = performance.now();
    lastPaint = 0;
    el('load-play').textContent = 'Pause replay';
    el('load-play').setAttribute('aria-pressed', 'true');
    function advance(now) {
      cursor = Math.min(END_STEP, initial + Math.floor((now - start) * END_STEP / 9500));
      if (now - lastPaint >= 32 || cursor === END_STEP) { showFrame(); lastPaint = now; }
      if (cursor < END_STEP) replay = requestAnimationFrame(advance);
      else stopReplay();
    }
    replay = requestAnimationFrame(advance);
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && replay) stopReplay(true); });
  window.addEventListener('pagehide', () => stopReplay());
  el('load-unit-cost').textContent = 'Each token adds ' + numbers.format(cacheBytes(1, 1)) + ' bytes (' + cacheBytes(1, 1) / 1024 + ' KiB). Each of ' + ARCHITECTURE.layers + ' layers stores a key and a value across ' + ARCHITECTURE.kvHeads + ' KV heads and ' + ARCHITECTURE.headDimension + ' values per head, at ' + ARCHITECTURE.cacheBits + ' bits per value. Shared weights are counted once.';
  el('load-scrub').max = String(END_STEP);
  section.querySelector('[data-workload-ui]').hidden = false;
  renderPlan();
}
