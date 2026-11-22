import { TRACE_BUILD } from './model.js';
import { EVENINGS, LAST_FITTING_PIECE, LOG_LENGTH, PIERS, SLIP_LENGTH, bellAtPier, recoverLog, windLog } from './ferry-model.js';

const counted = new Intl.NumberFormat('en-US');
const places = new Intl.NumberFormat('en-US', { maximumFractionDigits: 3 });
const bellWords = ['silence', 'one bell', 'two bells', 'three bells'];
const bellTimes = ['', 'once', 'twice', 'three times'];

export function mountFerry() {
  const story = document.getElementById('crossing');
  if (!story) return;
  const byId = id => document.getElementById(id);
  const scene = byId('ferry-scene');
  const slider = byId('ferry-scrub');
  const pages = [...story.querySelectorAll('[data-story-page]')];
  const lamps = [...story.querySelectorAll('[data-pier]')];
  const entries = [
    [0, 'Spindle empty', 'The paper is waiting on the spool.'],
    [1, 'Opening slip', 'The envelope smells faintly of the sea.'],
    [192, 'Harbor log · afternoon', 'Blue paint still wet on the handrail at Clock Pier.'],
    [415, 'Harbor log · dusk', 'Three lamp glasses polished. One gull asleep on the ticket booth.'],
    [704, 'Harbor log · evening', 'A steward laid a blue scarf over the back of a chair.']
  ];
  const soundButton = byId('ferry-sound');
  const motionButton = byId('ferry-motion');
  const motionPreference = window.matchMedia('(prefers-reduced-motion: reduce)');
  let motion = !motionPreference.matches;
  let audioContext;
  let sound = false;
  let round = 0;
  let phase = 'start';
  let spool = windLog(0);
  let recovery = null;
  let frame = 0;
  let chosenPier = null;

  function bellSound(count) {
    if (!sound || audioContext?.state !== 'running') return;
    for (let strike = 0; strike < count; strike++) {
      const start = audioContext.currentTime + strike * 0.48;
      for (const [pitch, volume, duration] of [[540, 0.12, 0.68], [1330, 0.026, 0.31]]) {
        const oscillator = audioContext.createOscillator();
        const gain = audioContext.createGain();
        oscillator.frequency.value = pitch;
        gain.gain.setValueAtTime(0.0001, start);
        gain.gain.exponentialRampToValueAtTime(volume, start + 0.012);
        gain.gain.exponentialRampToValueAtTime(0.0001, start + duration);
        oscillator.connect(gain).connect(audioContext.destination);
        oscillator.start(start);
        oscillator.stop(start + duration + 0.02);
        oscillator.onended = () => { oscillator.disconnect(); gain.disconnect(); };
      }
    }
  }

  function cancelWinding() {
    cancelAnimationFrame(frame);
    frame = 0;
    byId('wind-log').textContent = 'Wind the log';
  }

  function updateMotion(value) {
    motion = value;
    scene.classList.toggle('still-water', !motion);
    story.classList.toggle('still-story', !motion);
    motionButton.textContent = motion ? 'Pause motion' : 'Play motion';
    motionButton.setAttribute('aria-pressed', String(motion));
    if (!motion && frame) {
      cancelWinding();
      seek(LAST_FITTING_PIECE + 1, true);
    }
  }

  function showBoat(x, y, scale, faceLeft = false) {
    const ship = byId('ship-position');
    ship.style.setProperty('--ship-x', x + '%');
    ship.style.setProperty('--ship-y', y + '%');
    ship.style.setProperty('--ship-size', scale);
    ship.classList.toggle('face-left', faceLeft);
  }

  function showPage(next, focus = true) {
    phase = next;
    story.dataset.phase = next;
    scene.dataset.phase = next;
    for (const page of pages) page.hidden = page.dataset.storyPage !== next;
    for (const lamp of lamps) {
      lamp.disabled = next !== 'signal';
      const lit = lamp.dataset.pier === chosenPier;
      lamp.classList.toggle('is-lit', lit);
      lamp.classList.toggle('is-home', lit && next === 'home');
    }
    byId('log-drive').hidden = next === 'start';
    byId('ferry-hand-controls').hidden = next !== 'reading' && next !== 'blocked';
    const captions = {
      start: 'Across the water, the last ferry is still out in the fog.',
      reading: 'A row of amber windows appears offshore.',
      blocked: 'The ferry waits offshore. The bell list is still on the reel.',
      signal: 'The ferry is watching the piers. Choose a lamp.',
      home: chosenPier ? 'The lamp at ' + PIERS.find(p => p.id === chosenPier).name + ' guides the ferry in.' : ''
    };
    byId('water-caption').textContent = captions[next];
    if (next === 'start') showBoat(11, 85, 1);
    if (next === 'reading') showBoat(23, 79, 0.92);
    if (next === 'blocked') showBoat(31, 76, 0.86);
    if (next === 'signal') showBoat(42, 74, 0.84);
    if (next === 'home') {
      const pier = PIERS.find(p => p.id === chosenPier);
      showBoat(pier.x, 61, 0.64, pier.x < 42);
    }
    if (focus) {
      const page = pages.find(p => p.dataset.storyPage === next);
      const target = next === 'start' ? byId('open-letter') : page.querySelector('h2');
      target.focus({ preventScroll: true });
      const rect = target.getBoundingClientRect();
      if (rect.bottom < 0 || rect.top > window.innerHeight) target.scrollIntoView({ block: 'center' });
    }
  }

  function updateReceipt() {
    const result = recovery?.allocation ?? spool.allocation;
    const bits = recovery?.bits ?? TRACE_BUILD.bits;
    const pieces = recovery?.tokens ?? spool.attempted;
    const mode = recovery?.method === 'slips' ? 'Only the first and last ' + SLIP_LENGTH + ' positions are retained. ' : '';
    byId('memory-receipt').textContent = mode + counted.format(pieces) + ' token positions at ' + bits + '-bit weight precision. ' +
      (result.fits ? 'The estimate leaves ' + places.format(result.free) + ' GiB free.' :
        'The first piece over the limit needs ' + counted.format(Math.round(result.overflow * 2 ** 30)) + ' additional bytes.');
    const outputs = story.querySelectorAll('[data-value-from]');
    for (const output of outputs) {
      const key = output.dataset.valueFrom;
      const value = result[key];
      output.textContent = places.format(value) + ' GiB';
    }
  }

  function paintReel() {
    const count = recovery?.tokens ?? spool.held;
    const fmt = counted.format(count);
    byId('drive-count').textContent = fmt + ' / ' + counted.format(LOG_LENGTH) + ' pieces held';
    const feed = byId('feed-held');
    const clips = recovery?.method === 'slips';
    const excerpt = recovery
      ? ['Last slip · tonight’s bells', 'The keeper’s list is unrolled beside Nell’s note.']
      : entries.findLast(entry => entry[0] <= spool.held).slice(1);
    if (byId('excerpt-label').textContent !== excerpt[0]) {
      byId('excerpt-label').textContent = excerpt[0];
      byId('excerpt-line').textContent = excerpt[1];
    }
    feed.classList.toggle('two-slips', clips);
    feed.style.setProperty('--loaded', (count / LOG_LENGTH * 100) + '%');
    feed.style.setProperty('--slip', (SLIP_LENGTH / LOG_LENGTH * 100) + '%');
    byId('feed-marks').style.backgroundPositionX = -(count % 56) + 'px';
    byId('feed-edge').hidden = Boolean(recovery);
    const drive = byId('log-drive');
    drive.dataset.blocked = String(spool.blocked && !recovery);
    drive.style.setProperty('--spool-turn', (count * 0.95) + 'deg');
    slider.value = String(spool.attempted);
    slider.setAttribute('aria-valuetext', counted.format(spool.attempted) + ' pieces requested; ' + counted.format(spool.held) + ' held.');
    byId('one-back').disabled = spool.attempted === 0;
    byId('one-forward').disabled = spool.blocked;
    const edgeCopy = 'Piece ' + counted.format(LAST_FITTING_PIECE + 1) + ' takes the reader over its budget.';
    if (recovery?.method === 'compact') byId('reel-reading').textContent = 'The entire roll fits in the compact reader. Both clues are in view.';
    else if (clips) byId('reel-reading').textContent = 'Two slips are threaded. The ' + counted.format(LOG_LENGTH - count) + ' pieces between them are set aside.';
    else byId('reel-reading').textContent = spool.blocked ? edgeCopy : 'The marks follow the paper through the reel.';
    updateReceipt();
  }

  function seek(requested, focus = false) {
    spool = windLog(requested);
    const next = spool.blocked ? 'blocked' : 'reading';
    if (phase !== next) showPage(next, focus);
    paintReel();
  }

  function windToLimit() {
    if (frame || !motion) {
      cancelWinding();
      seek(LAST_FITTING_PIECE + 1, true);
      return;
    }
    const initial = spool.held;
    const start = performance.now();
    byId('wind-log').textContent = 'Finish winding';
    function advance(now) {
      const t = Math.min(1, (now - start) / 1050);
      const position = Math.round(initial + (LAST_FITTING_PIECE + 1 - initial) * t);
      const reachedEnd = position >= LAST_FITTING_PIECE + 1;
      seek(position, reachedEnd);
      if (!reachedEnd) frame = requestAnimationFrame(advance);
      else cancelWinding();
    }
    frame = requestAnimationFrame(advance);
  }

  function showClues(method) {
    cancelWinding();
    recovery = recoverLog(method);
    byId('margin-note').open = false;
    byId('margin-kept').hidden = !recovery.hasMarginNote;
    byId('margin-missing').hidden = recovery.hasMarginNote;
    chosenPier = null;
    const evening = EVENINGS[round];
    byId('clue-recap').textContent = 'Nell wrote, “Meet me where the bell rings ' + bellTimes[evening.signal] + '.”';
    const list = byId('bell-list');
    list.replaceChildren();
    for (const [i, pier] of PIERS.entries()) {
      const term = document.createElement('dt');
      term.textContent = pier.name;
      const description = document.createElement('dd');
      const dots = document.createElement('span');
      dots.setAttribute('aria-hidden', 'true');
      dots.className = 'register-dots';
      dots.textContent = '●'.repeat(evening.calls[i]);
      description.append(dots, bellWords[evening.calls[i]]);
      list.append(term, description);
    }
    byId('bell-feedback').textContent = '';
    showPage('signal');
    paintReel();
  }

  function signalPier(id) {
    if (phase !== 'signal') return;
    const answer = bellAtPier(EVENINGS[round], id);
    chosenPier = id;
    bellSound(answer.bells);
    const bulb = lamps.find(lamp => lamp.dataset.pier === id).querySelector('.lamp-bulb');
    if (motion && bulb.animate) {
      bulb.getAnimations().forEach(animation => animation.cancel());
      bulb.animate([
        { outline: '1px solid rgba(255,218,145,.95)', outlineOffset: '0px' },
        { outline: '2px solid rgba(255,218,145,0)', outlineOffset: '17px' }
      ], { duration: 480, iterations: answer.bells, easing: 'ease-out' });
    }
    if (!answer.matches) {
      showPage('signal', false);
      byId('bell-feedback').textContent = answer.pier.name + ' answers with ' + bellWords[answer.bells] + '. Nell asked for ' + bellWords[EVENINGS[round].signal] + '. Try another lamp.';
      byId('water-caption').textContent = answer.pier.name + ' is lit. The ferry waits for Nell’s signal.';
      return;
    }
    byId('arrival-copy').textContent = 'The ferry noses up to ' + answer.pier.name + '. Nell is the first one down the ramp, her blue scarf trailing behind her.';
    showPage('home');
  }

  function openNote() {
    cancelWinding();
    chosenPier = null;
    recovery = null;
    byId('nell-message').textContent = '“Meet me where the bell rings ' + bellTimes[EVENINGS[round].signal] + '. I’ll be wearing that ridiculous blue scarf.”';
    byId('bell-feedback').textContent = '';
    byId('block-copy').textContent = 'The reader holds ' + counted.format(LAST_FITTING_PIECE) + ' pieces of the log. The next piece catches. You have Nell’s note, but tonight’s bell list is still at the far end.';
    spool = windLog(SLIP_LENGTH);
    showPage('reading');
    paintReel();
  }

  byId('open-letter').addEventListener('click', openNote);
  byId('wind-log').addEventListener('click', windToLimit);
  slider.addEventListener('input', () => { cancelWinding(); seek(Number(slider.value)); });
  byId('one-back').addEventListener('click', () => { cancelWinding(); seek(Math.max(0, spool.attempted - 1)); });
  byId('one-forward').addEventListener('click', () => { cancelWinding(); seek(spool.attempted + 1); });
  for (const button of story.querySelectorAll('[data-recover]')) button.addEventListener('click', () => showClues(button.dataset.recover));
  for (const lamp of lamps) lamp.addEventListener('click', () => signalPier(lamp.dataset.pier));
  byId('play-again').addEventListener('click', () => { round = (round + 1) % EVENINGS.length; openNote(); });
  byId('try-other-route').addEventListener('click', () => {
    recovery = null;
    chosenPier = null;
    spool = windLog(LAST_FITTING_PIECE + 1);
    showPage('blocked');
    paintReel();
  });
  motionButton.addEventListener('click', () => updateMotion(!motion));
  motionPreference.addEventListener('change', event => updateMotion(!event.matches));
  soundButton.addEventListener('click', async () => {
    if (!sound) {
      try {
        const SoundContext = window.AudioContext ?? window.webkitAudioContext;
        audioContext ??= new SoundContext();
        await audioContext.resume();
        sound = audioContext.state === 'running';
      } catch { sound = false; }
    } else sound = false;
    soundButton.setAttribute('aria-pressed', String(sound));
    soundButton.textContent = sound ? 'Sound on' : 'Sound off';
    if (sound) bellSound(1);
  });
  if (!window.AudioContext && !window.webkitAudioContext) soundButton.hidden = true;
  window.addEventListener('pagehide', cancelWinding);
  byId('feed-edge').style.left = (LAST_FITTING_PIECE / LOG_LENGTH * 100) + '%';
  for (const [key, label] of [['weights', 'Model weights'], ['cache', 'Text cache'], ['reserve', 'Assumed reserve'], ['total', 'Required in total']]) {
    const dt = document.createElement('dt');
    const dd = document.createElement('dd');
    dt.textContent = label;
    dd.dataset.valueFrom = key;
    byId('receipt-allocations').append(dt, dd);
  }
  for (const element of story.querySelectorAll('.ferry-js')) element.hidden = false;
  updateMotion(motion);
  showPage('start', false);
  updateReceipt();
}
