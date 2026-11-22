import { mountWorkload } from './workload.js';
import { safeLoad, safeSave } from '../shared/core.js';
import { DEFAULT_BUILD, TRACE_BUILD, MISSIONS, accounting, precisionOptions, evaluateMission, sanitizeBuild, isValidBuild, sanitizeProgress, cellSegments, formatGiB } from './model.js';
import { createTrace } from './trace.js';

const $ = selector => document.querySelector(selector);
const STORAGE_KEY = 'brandon-memory-crate-v2';
const saved = safeLoad(STORAGE_KEY, {});
let workshopBuild = sanitizeBuild(saved?.build);
let build = { ...workshopBuild };
let solved = sanitizeProgress(saved?.solved);
let pinned = Array.isArray(saved?.pinned) ? saved.pinned.filter(isValidBuild).slice(0, 2).map(value => sanitizeBuild(value)) : [];
let missionId = 'sandbox';
let hasChecked = false;
let traceBaseline = { ...build };
const renderTrace = createTrace({
  onChange: change,
  onExample: () => {
    missionId = 'sandbox';
    build = { ...TRACE_BUILD };
    traceBaseline = { ...build };
    hasChecked = false;
    $('#trace-action-status').textContent = 'Context example loaded. Baseline: zero cached tokens, 8B parameters, 16-bit weights, a 16 GiB budget and 1 GiB assumed reserve.';
    $('#check-result').textContent = 'Context example loaded. Increase cached tokens to cross the estimated budget.';
    render(); persist();
  },
  onBaseline: () => {
    traceBaseline = { ...build };
    $('#trace-action-status').textContent = 'Current build saved as the comparison baseline for this session.';
    render();
  },
  onReset: () => {
    missionId = 'sandbox';
    build = { ...traceBaseline };
    hasChecked = false;
    $('#trace-action-status').textContent = 'Restored the baseline in free play.';
    $('#check-result').textContent = 'Build restored from the trace baseline.';
    render(); persist();
  }
});
const colors = { weights: '#cde991', cache: '#7abfc9', reserve: '#daa9bc', empty: '#1b291a' };
const cells = Array.from({ length: 64 }, () => {
  const cell = document.createElement('span');
  cell.className = 'memory-cell';
  cell.setAttribute('aria-hidden', 'true');
  $('#memory-cells').append(cell);
  return cell;
});
const missionButtons = new Map([['sandbox', $('[data-mission="sandbox"]')]]);
for (const [index, mission] of MISSIONS.entries()) {
  const button = document.createElement('button');
  button.className = 'mission-option';
  button.type = 'button';
  button.dataset.mission = mission.id;
  button.setAttribute('aria-pressed', 'false');
  const number = document.createElement('span'); number.className = 'mono'; number.textContent = `0${index + 1} / PACKING BRIEF`;
  const title = document.createElement('strong'); title.textContent = mission.name;
  const detail = document.createElement('span'); detail.textContent = mission.tagline;
  button.append(number, title, detail);
  $('#mission-picker').append(button);
  missionButtons.set(mission.id, button);
}
const comparisonButtons = new Map();
for (const bits of [4, 8, 16, 32]) {
  const button = document.createElement('button');
  button.type = 'button';
  button.className = 'precision-card';
  button.innerHTML = '<span class="precision-title"></span><span class="precision-bar" aria-hidden="true"><i></i><i></i><i></i></span><strong class="precision-size"></strong><span class="precision-detail"></span><span class="precision-verdict"></span>';
  button.onclick = () => change('bits', bits);
  $('#precision-comparison').append(button);
  comparisonButtons.set(bits, button);
}
function mission() { return MISSIONS.find(item => item.id === missionId); }
function persist() {
  if (missionId === 'sandbox') workshopBuild = { ...build };
  const ok = safeSave(STORAGE_KEY, { version: 2, build: workshopBuild, solved, pinned });
  $('#storage-note').textContent = ok ? 'Solved briefs, pinned comparisons, and your last workshop build stay in this browser.' : 'Browser storage is unavailable. The workshop still works, but this session will not be saved.';
}
function change(key, value) {
  build = sanitizeBuild({ ...build, [key]: value });
  hasChecked = false;
  $('#check-result').textContent = mission() ? 'Build changed. Test again when you’re ready.' : 'The crate updates as you go. Check the numbers when you’re ready.';
  render();
  persist();
}
function chooseMission(id) {
  if (missionId === 'sandbox') workshopBuild = { ...build };
  missionId = id;
  const current = mission();
  if (current) {
    build = { parameters: Math.min(current.minParameters, 8), bits: 16, capacity: current.capacity, tokens: current.minTokens ? 2048 : 0, sequences: 1, reserve: current.reserve };
  } else build = { ...workshopBuild };
  hasChecked = false;
  $('#check-result').textContent = current ? 'The crate and reserve are set by the brief. Choose the model, precision and cache, then test your build.' : 'Back to free play. Change anything and see what fits.';
  render(); persist();
}
missionButtons.forEach((button, id) => button.onclick = () => chooseMission(id));
document.querySelectorAll('[data-parameter]').forEach(button => {
  button.onclick = () => change(button.dataset.parameter, Number(button.dataset.value));
});
document.querySelectorAll('[data-select]').forEach(select => {
  select.onchange = () => change(select.dataset.select, Number(select.value));
});
function renderCells(result) {
  cells.forEach((cell, index) => {
    let position = 0;
    const stops = [];
    cellSegments(result, index).forEach(segment => {
      if (segment.fraction <= 0) return;
      const end = position + segment.fraction * 100;
      stops.push(`${colors[segment.kind]} ${position.toFixed(4)}% ${end.toFixed(4)}%`);
      position = end;
    });
    cell.style.background = `linear-gradient(to top, ${stops.join(',')})`;
    cell.classList.toggle('loaded', index * result.capacity / 64 < result.total);
  });
  $('#memory-cells').setAttribute('aria-label', `Allocation of the ${result.capacity} GiB crate: ${formatGiB(result.weights)} GiB weights, ${formatGiB(result.cache)} GiB cache, ${formatGiB(result.reserve)} GiB reserve. ${result.fits ? formatGiB(result.free) + ' GiB remains.' : formatGiB(result.overflow) + ' GiB exceeds capacity.'}`);
}
function renderPrecision() {
  for (const option of precisionOptions(build)) {
    const button = comparisonButtons.get(option.bits);
    button.setAttribute('aria-pressed', String(option.bits === build.bits));
    button.classList.toggle('over', !option.fits);
    button.querySelector('.precision-title').textContent = `${option.bits}-bit weights`;
    button.querySelector('.precision-size').textContent = `${formatGiB(option.total)} GiB`;
    button.querySelector('.precision-detail').textContent = `${formatGiB(option.weights)} weights + ${formatGiB(option.cache + option.reserve)} other`;
    button.querySelector('.precision-verdict').textContent = option.fits ? `${formatGiB(option.free)} GiB left` : `${formatGiB(option.overflow)} GiB over`;
    const parts = [option.weights, option.cache, option.reserve];
    let used = 0;
    button.querySelectorAll('.precision-bar i').forEach((bar, index) => {
      const visible = Math.max(0, Math.min(parts[index], option.capacity - used));
      bar.style.width = `${visible / option.capacity * 100}%`;
      used += parts[index];
    });
  }
}
function renderPins() {
  $('#pinned-section').hidden = pinned.length === 0;
  $('#pinned-builds').replaceChildren();
  pinned.forEach((item, index) => {
    const result = accounting(item);
    const card = document.createElement('article'); card.className = 'pinned-card';
    const title = document.createElement('h3'); title.textContent = `${item.parameters}B at ${item.bits}-bit`;
    const label = document.createElement('p'); label.className = 'mono'; label.textContent = `BUILD ${index + 1} / ${item.capacity} GiB CRATE`;
    const total = document.createElement('p'); total.className = 'pinned-total'; total.textContent = `${formatGiB(result.total)} GiB`;
    const detail = document.createElement('p'); detail.textContent = `${item.tokens.toLocaleString('en-US')} tokens × ${item.sequences} sequence${item.sequences === 1 ? '' : 's'} · ${item.reserve} GiB reserve`;
    const verdict = document.createElement('p'); verdict.className = result.fits ? 'pin-verdict' : 'pin-verdict over'; verdict.textContent = result.fits ? `${formatGiB(result.free)} GiB unallocated` : `${formatGiB(result.overflow)} GiB over capacity`;
    const load = document.createElement('button'); load.type = 'button'; load.textContent = 'Load in workshop ↗'; load.onclick = () => { missionId = 'sandbox'; build = { ...item }; hasChecked = false; $('#check-result').textContent = 'Pinned build loaded into the workshop.'; render(); persist(); $('#check-build').focus({ preventScroll: true }); };
    card.append(label, title, total, detail, verdict, load); $('#pinned-builds').append(card);
  });
}
function renderBrief() {
  const current = mission();
  const evaluation = current ? evaluateMission(build, current) : null;
  $('#brief-kicker').textContent = current ? `PACKING BRIEF ${MISSIONS.indexOf(current) + 1} / 4` : 'FREE PLAY / NO WRONG TURNS';
  $('#brief-title').textContent = current ? current.name : 'What would you put in the box?';
  $('#brief-description').textContent = current ? current.brief : 'Try a bigger model, more cached tokens, or fewer bits. See what each part takes up.';
  $('#requirements').hidden = !current;
  $('#requirements').replaceChildren();
  evaluation?.requirements.forEach(requirement => {
    const li = document.createElement('li'); li.className = requirement.pass ? 'passed' : '';
    li.textContent = `${requirement.pass ? '✓' : '○'} ${requirement.label}`; $('#requirements').append(li);
  });
  missionButtons.forEach((button, id) => {
    button.setAttribute('aria-pressed', String(missionId === id));
    button.classList.toggle('solved', solved.includes(id));
    const currentMission = MISSIONS.find(m => m.id === id);
    if (currentMission) button.setAttribute('aria-label', `${currentMission.name}${solved.includes(id) ? ', solved' : ''}`);
  });
  $('#progress-count').textContent = `${solved.length} / ${MISSIONS.length} SOLVED`;
  $('#success-stamp').hidden = !(hasChecked && evaluation?.solved);
  $('#next-mission').hidden = !(hasChecked && evaluation?.solved);
  $('#next-mission').textContent = solved.length === MISSIONS.length ? 'Back to the workshop →' : 'Next brief →';
  document.querySelectorAll('[data-parameter="capacity"]').forEach(button => button.disabled = Boolean(current));
  $('#reserve').disabled = Boolean(current);
  $('#budget-note').textContent = current ? 'The brief sets this crate and reserve. Other controls are yours to change.' : 'You choose this reserve. It isn’t measured runtime overhead.';
  $('#check-build').textContent = current ? 'Check my packing ↗' : 'Check the numbers ↗';
  $('#check-controls').textContent = $('#check-build').textContent;
}
function render() {
  const result = accounting(build);
  $('#crate').classList.toggle('over', !result.fits);
  $('#crate-tag').textContent = result.fits ? 'WITHIN ESTIMATE' : 'ESTIMATE EXCEEDED';
  $('#build-label').textContent = `${build.parameters}B / ${build.bits}-BIT / ${build.capacity} GiB`;
  $('#memory-size').textContent = formatGiB(result.weights);
  $('#total-size').textContent = `${formatGiB(result.total)} GiB`;
  $('#capacity-label').textContent = `of ${build.capacity} GiB`;
  $('#memory-caption').textContent = `${formatGiB(build.capacity / 64)} GiB per cell`;
  $('#overflow-tray').hidden = result.fits;
  $('#overflow-size').textContent = `${formatGiB(result.overflow)} GiB`;
  $('#weights-breakdown').textContent = `${formatGiB(result.weights)} GiB`;
  $('#cache-breakdown').textContent = `${formatGiB(result.cache)} GiB`;
  $('#reserve-breakdown').textContent = `${formatGiB(result.reserve)} GiB`;
  $('#free-breakdown').textContent = `${formatGiB(result.free)} GiB`;
  $('#memory-status').textContent = result.fits ? `${formatGiB(result.free)} GiB unallocated after weights, this cache, and your reserve. Actual runtime needs can differ.` : `${formatGiB(result.overflow)} GiB over budget. The striped section shows what won’t fit.`;
  $('#controls-summary').textContent = `${formatGiB(result.total)} / ${build.capacity} GiB · ${result.fits ? formatGiB(result.free) + ' left' : formatGiB(result.overflow) + ' over'}`;
  $('#controls-summary').classList.toggle('over', !result.fits);
  document.querySelectorAll('[data-parameter]').forEach(button => button.setAttribute('aria-pressed', String(build[button.dataset.parameter] === Number(button.dataset.value))));
  document.querySelectorAll('[data-select]').forEach(select => select.value = String(build[select.dataset.select]));
  renderCells(result); renderBrief(); renderPrecision(); renderPins();
  renderTrace(build, traceBaseline, { locked: Boolean(mission()) });
}
function testBuild() {
  hasChecked = true;
  const current = mission(), result = accounting(build);
  if (current) {
    const evaluation = evaluateMission(build, current);
    if (evaluation.solved) {
      if (!solved.includes(current.id)) solved.push(current.id);
      $('#check-result').textContent = `Packed. ${build.bits}-bit is the highest weight precision that meets this brief. ${current.lesson}`;
    } else if (evaluation.meetsBrief) {
      $('#check-result').textContent = 'The build meets the capacity brief, but a higher weight precision is possible. Check the four-way comparison below and try again.';
    } else {
      const missing = evaluation.requirements.filter(item => !item.pass).map(item => item.label.toLowerCase());
      $('#check-result').textContent = `Not quite: ${missing.join('; ')}. Keep experimenting.`;
    }
  } else {
    $('#check-result').textContent = result.fits ? `The arithmetic checks out: ${formatGiB(result.weights)} weights + ${formatGiB(result.cache)} cache + ${formatGiB(result.reserve)} reserve = ${formatGiB(result.total)} GiB. This is a planning result, not a runtime test.` : `The load is ${formatGiB(result.total)} GiB against a capacity of ${build.capacity} GiB. Fewer bits shrink the weights; shorter or fewer sequences shrink this cache. A larger crate raises the budget.`;
  }
  render(); persist();
}
$('#check-build').onclick = $('#check-controls').onclick = testBuild;
$('#reset-build').onclick = () => { if (mission()) chooseMission(missionId); else { build = { ...DEFAULT_BUILD }; hasChecked = false; $('#check-result').textContent = 'Workshop reset to the starting build.'; render(); persist(); } };
$('#pin-build').onclick = () => {
  const signature = JSON.stringify(build);
  if (pinned.some(item => JSON.stringify(item) === signature)) { $('#check-result').textContent = 'That build is already pinned below.'; return; }
  pinned.push({ ...build }); if (pinned.length > 2) pinned.shift();
  $('#check-result').textContent = `${pinned.length === 1 ? 'First build' : 'Comparison'} pinned below. The tray holds your two most recent distinct builds.`;
  renderPins(); persist();
};
$('#clear-pins').onclick = () => { pinned = []; renderPins(); persist(); $('#pin-build').focus({ preventScroll: true }); $('#check-result').textContent = 'Comparison cleared. Your current build is unchanged.'; };
$('#next-mission').onclick = () => { const next = MISSIONS.find(item => !solved.includes(item.id)); chooseMission(next?.id || 'sandbox'); missionButtons.get(next?.id || 'sandbox').focus({ preventScroll: true }); };
render();
mountWorkload();

function openLinkedWorkshop() {
  const section = document.getElementById('memory-workshop');
  const target = document.getElementById(location.hash.slice(1));
  if (target && section.contains(target)) {
    section.open = true;
    target.scrollIntoView({ block: 'start' });
  }
}
window.addEventListener('hashchange', openLinkedWorkshop);
openLinkedWorkshop();
