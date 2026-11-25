import { ARCHITECTURE, OPTIONS, allocationTrace, contextSeries, weightsBytes, cacheBytes, bytesToGB, bytesToGiB } from './model.js';

const labels = { parameters: 'Parameters (billions)', bits: 'Weight precision (bits)', tokens: 'Cached tokens per sequence', sequences: 'Concurrent sequences', capacity: 'Estimated budget (GiB)', reserve: 'Assumed reserve (GiB)' };
const number = value => value.toLocaleString('en-US', { maximumFractionDigits: 3 });
const gib = value => `${number(value)} GiB`;
const exact = value => value.toLocaleString('en-US', { maximumFractionDigits: 12 });
const kinds = ['weights', 'reserve', 'cache'];

/** Presentation only: every allocation, sweep and comparison comes from model.js. */
export function createTrace({ onChange, onExample, onBaseline, onReset }) {
  const $ = selector => document.querySelector(selector);
  const controls = new Map();
  for (const key of ['tokens', 'sequences', 'bits', 'capacity', 'reserve', 'parameters']) {
    const label = document.createElement('label');
    label.htmlFor = `trace-${key}`;
    label.textContent = labels[key];
    const select = document.createElement('select');
    select.id = label.htmlFor;
    for (const value of OPTIONS[key]) {
      const option = document.createElement('option');
      option.value = String(value);
      option.textContent = number(value);
      select.append(option);
    }
    select.onchange = () => onChange(key, Number(select.value));
    label.append(select);
    $('#trace-controls').append(label);
    controls.set(key, select);
  }
  $('#trace-example').onclick = onExample;
  $('#trace-baseline').onclick = onBaseline;
  $('#trace-reset').onclick = onReset;
  const steps = OPTIONS.tokens.map(tokens => {
    const button = document.createElement('button');
    button.type = 'button';
    button.className = 'context-step';
    button.onclick = () => onChange('tokens', tokens);
    const title = document.createElement('strong');
    title.textContent = number(tokens);

    const size = document.createElement('span'); size.className = 'step-size';
    const status = document.createElement('span'); status.className = 'step-status';
    button.append(title, size, status);
    $('#context-steps').append(button);
    return { button, size, status };
  });
  document.querySelectorAll('.trace-interactive').forEach(element => { element.hidden = false; });

  function allocationRow(name, result, scale) {
    const row = document.createElement('div'); row.className = 'trace-allocation-row';
    const label = document.createElement('span'); label.className = 'trace-row-label';
    label.textContent = `${name} · ${gib(result.total)}`;
    const track = document.createElement('div'); track.className = 'trace-track'; track.setAttribute('aria-hidden', 'true');
    for (const kind of kinds) {
      const block = document.createElement('span'); block.className = `trace-block ${kind}`;
      block.style.width = `${result[kind] / scale * 100}%`;
      track.append(block);
    }
    const boundary = document.createElement('span'); boundary.className = 'trace-budget-line';
    boundary.style.left = `${result.capacity / scale * 100}%`;
    track.append(boundary);
    const caption = document.createElement('span'); caption.className = 'trace-row-caption';
    caption.textContent = `${gib(result.weights)} weights + ${gib(result.cache)} cache + ${gib(result.reserve)} assumed reserve. Budget: ${gib(result.capacity)}.`;
    row.append(label, track, caption);
    return row;
  }

  return function renderTrace(build, baseline, { locked = false } = {}) {
    const trace = allocationTrace(baseline, build);
    const result = trace.after;
    controls.forEach((select, key) => {
      select.value = String(build[key]);
      select.disabled = locked && ['capacity', 'reserve'].includes(key);
    });
    $('#trace-lock-note').hidden = !locked;
    $('#trace-lock-note').textContent = locked ? 'The active workshop brief fixes the budget and reserve.' : '';
    $('#trace-state').textContent = result.fits ? (result.free === 0 ? 'Exactly at the estimated budget' : 'Within the estimated budget') : 'Estimated budget exceeded';
    $('#trace-state').classList.toggle('over', !result.fits);
    $('#trace-total').textContent = gib(result.total);
    $('#trace-budget').textContent = `required of ${gib(result.capacity)} available`;
    $('#trace-verdict').textContent = result.fits ? `${gib(result.free)} of headroom.` : `${gib(result.overflow)} over budget.`;
    const components = trace.rows.filter(row => kinds.includes(row.key));
    const changed = components.filter(row => row.changed);
    const stable = components.filter(row => !row.changed).map(row => row.label.toLowerCase());
    const differences = changed.map(row => `${row.label} ${row.delta > 0 ? 'grew' : 'fell'} from ${number(row.before)} to ${gib(row.after)}.`);
    if (changed.length && stable.length) {
      const label = stable.join(' and ');
      differences.push(label[0].toUpperCase() + label.slice(1) + ' stayed fixed.');
    }
    if (!changed.length) differences.push(trace.changedInputs.length ? 'Weights, cache and assumed reserve match the baseline.' : 'Current allocation matches the baseline.');
    $('#trace-difference').textContent = differences.join(' ');
    const scale = Math.max(trace.before.total, result.total, trace.before.capacity, result.capacity) * 1.04;
    $('#trace-allocations').replaceChildren(allocationRow('Baseline', trace.before, scale), allocationRow('Current', result, scale));
    $('#trace-changes').textContent = trace.changedInputs.length ? `Changed from baseline: ${trace.changedInputs.map(key => `${labels[key]} ${number(baseline[key])} → ${number(build[key])}`).join('; ')}.` : 'No inputs changed from baseline.';
    $('#trace-comparison').replaceChildren();
    for (const row of trace.rows) {
      const tr = document.createElement('tr');
      tr.classList.toggle('trace-changed', row.changed);
      const th = document.createElement('th'); th.scope = 'row';
      th.textContent = row.label;
      const evidence = document.createElement('small'); evidence.textContent = row.kind;
      th.append(evidence); tr.append(th);
      const delta = row.delta === 0 ? '0' : `${row.delta > 0 ? '+' : '−'}${number(Math.abs(row.delta))}`;
      for (const value of [number(row.before), number(row.after), delta, row.changed ? 'Changed' : 'Unchanged']) {
        const td = document.createElement('td'); td.textContent = value; tr.append(td);
      }
      const dependency = document.createElement('td');
      dependency.textContent = row.dependsOn.map(key => labels[key]).join(' · ');
      if (row.affected && !row.changed) {
        const note = document.createElement('small');
        note.textContent = 'Input changed; result stays fixed.';
        dependency.append(note);
      }
      tr.append(dependency); $('#trace-comparison').append(tr);
    }
    contextSeries(build).forEach((point, index) => {
      const step = steps[index];
      step.button.setAttribute('aria-pressed', String(point.tokens === build.tokens));
      step.button.classList.toggle('over', !point.fits);
      step.size.textContent = gib(point.total);
      step.status.textContent = point.fits ? 'Within budget' : 'Budget exceeded';
      step.button.setAttribute('aria-label', `${number(point.tokens)} cached tokens per sequence, ${gib(point.total)} total, ${step.status.textContent.toLowerCase()}`);
    });
    const weight = weightsBytes(build.parameters, build.bits), cache = cacheBytes(build.tokens, build.sequences);
    $('#trace-weight-math').textContent = `${number(build.parameters)} × 10⁹ parameters × ${build.bits} bits ÷ 8 = ${exact(weight)} bytes = ${exact(bytesToGB(weight))} GB ≈ ${number(bytesToGiB(weight))} GiB.`;
    $('#trace-cache-math').textContent = `2 × ${ARCHITECTURE.layers} layers × ${ARCHITECTURE.kvHeads} KV heads × ${ARCHITECTURE.headDimension} dimensions × ${number(build.tokens)} tokens × ${build.sequences} sequences × ${ARCHITECTURE.cacheBits} bits ÷ 8 = ${exact(cache)} bytes = ${exact(bytesToGB(cache))} GB = ${exact(bytesToGiB(cache))} GiB.`;
    $('#trace-total-math').textContent = `${exact(result.weights)} GiB weights + ${exact(result.cache)} GiB cache + ${exact(result.reserve)} GiB assumed reserve = ${exact(result.total)} GiB. Compare this with ${exact(result.capacity)} GiB of assumed available memory. Display values round to at most 3 decimal places; comparisons use unrounded values.`;
  };
}
