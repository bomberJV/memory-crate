import { cacheBytes } from './model.js';

import { mountDeviceRun } from './observation/device-run.js';

export async function mountFirstToken() {
  const chapter = document.getElementById('first-token');
  if (!chapter) return;
  const id = name => document.getElementById(name);
  const embedded = id('record-data');
  let record;
  try {
    if (embedded) record = JSON.parse(embedded.textContent);
    else {
      const response = await fetch(chapter.dataset.record);
      if (!response.ok) throw Error('Recording unavailable');
      record = await response.json();
    }
  } catch {
    const note = document.createElement('p');
    note.textContent = 'The recording could not be loaded. Reload this page to replay it.';
    chapter.querySelector('.ft-head').after(note);
    return;
  }
  const num = new Intl.NumberFormat('en-US');
  const milli = ns => num.format(Math.round(ns / 1e6)) + ' ms';
  const mib = b => (b / 2 ** 20).toFixed(2) + ' MiB';
  const median = values => {
    const sorted = [...values].sort((a,b) => a-b);
    const middle = Math.floor(sorted.length/2);
    return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
  };
  const names = {short:'One setting', long:'Model file', bundle:'Model + tokenizer'};
  let inspected = 'short';
  let paintedStep = -2;
  let lanes = [];
  let cursor = 0;
  let duration = 0;
  let playing = 0;
  let paused = false;
  function node(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text !== undefined) e.textContent = text;
    return e;
  }
  function assemble(key) {
    const c = record.cases[key];
    const sample = c.runs[c.shown];
    let elapsed = 0;
    const steps = sample.steps.map(s => {
      const start = elapsed;
      elapsed += s.ns;
      return {...s, start, end:elapsed};
    });
    return {key, count:c.inputIds.length, steps, end:elapsed, first:steps[0].end};
  }
  function makeLane(lane) {
    const wrapper = node('div','ft-lane');
    const header = node('div','ft-lane-head');
    header.append(node('span','',names[lane.key]+' · '+lane.count.toLocaleString('en-US')+' tokens'),node('small','','First token · '+milli(lane.first)));
    const cache = node('small','ft-cache',mib(lane.steps[0].kvBytes)+' KV cache after input');
    lane.answer = node('p','ft-answer');
    const track = node('div','ft-track');
    track.setAttribute('aria-hidden','true');
    lane.steps.forEach((s,i) => {
      const bar = node('i',i ? 'ft-step' : 'ft-prefill');
      bar.style.left = s.start/duration*100+'%';
      bar.style.width = s.ns/duration*100+'%';
      track.append(bar);
    });
    lane.shade = node('i','ft-shade');
    lane.marker = node('i','ft-cursor');
    track.append(lane.shade,lane.marker);
    wrapper.dataset.case = lane.key;
    wrapper.append(header,lane.answer,track,cache);
    return wrapper;
  }
  function selectRecording(key) {
    inspected = key;
    paintedStep = -2;
    id('ft-inspect-run').value = key;
    const lane = lanes.find(item => item.key === key);
    id('ft-token-rail').replaceChildren(...lane.steps.map((step, index) => {
      const piece = step.id === record.eos ? 'EOS' : step.piece.replaceAll(' ', '·').replaceAll('\n','↵');
      const button = node('button','ft-token',piece);
      button.type = 'button';
      button.setAttribute('aria-label','Token '+(index+1)+', '+JSON.stringify(step.piece)+', ID '+step.id);
      button.onclick = () => { halt(true); paint(step.end); };
      return button;
    }));
  }
  function paintInspector() {
    const lane = lanes.find(item => item.key === inspected);
    const index = lane.steps.findLastIndex(step => step.end <= cursor);
    if (index === paintedStep) return;
    paintedStep = index;
    const step = lane.steps[index];
    id('ft-event').textContent = step ? (index ? 'Decode' : 'Prefill')+' · token '+(index+1)+' of '+lane.steps.length : 'Prefill · waiting for the first recorded token';
    id('ft-token-id').textContent = step ? String(step.id) : '—';
    id('ft-step-time').textContent = step ? milli(step.ns) : '—';
    id('ft-positions').textContent = step ? num.format(step.positions) : '—';
    id('ft-kv-bytes').textContent = step ? num.format(step.kvBytes) : '—';
    Array.from(id('ft-token-rail').children).forEach((button, i) => {
      button.setAttribute('aria-pressed', String(i === index));
      button.classList.toggle('emitted', i <= index);
    });
  }
  function paint(t) {
    cursor = Math.min(duration,Math.max(0,t));
    const pct = cursor / duration;
    for (const lane of lanes) {
      const visible = lane.steps.filter(s => s.end <= cursor && s.id !== record.eos);
      const count = visible.length;
      if (lane.shown !== count) {
        lane.answer.replaceChildren();
        if (!count) lane.answer.textContent = 'Reading the input…';
        else lane.answer.textContent = visible.map(step => step.piece).join('') + (count === record.maxOutputTokens ? '…' : '');
        lane.answer.dataset.reading = String(count === 0);
        lane.shown = count;
      }
      lane.marker.style.left = 'calc('+pct*100+'% - 1px)';
      lane.shade.style.left = pct*100+'%';
    }
    id('ft-time').value = String(Math.round(pct*1000));
    id('ft-time').setAttribute('aria-valuetext',milli(cursor)+' of '+milli(duration));
    id('ft-clock').textContent = milli(cursor);
    paintInspector();
  }
  function halt(resume=false) {
    cancelAnimationFrame(playing);
    playing = 0;
    paused = resume;
    id('ft-play').textContent = resume ? 'Resume replay' : 'Replay all runs';
  }
  function configure() {
    halt();
    lanes = Object.keys(names).map(assemble);
    duration = Math.max(...lanes.map(lane => lane.end));
    id('ft-lanes').replaceChildren(...lanes.map(makeLane));
    id('ft-axis').replaceChildren(...[0,0.25,0.5,0.75,1].map(f => node('span','',(duration*f/1e9).toFixed(2)+' s')));
    selectRecording(inspected);
    id('ft-factor').textContent = (lanes[2].first/lanes[0].first).toFixed(1)+'×';
    id('ft-caption').textContent = 'Hatching is prefill: the model reads the input. Each solid segment is a decode step. The three recordings share one time axis.';
    const c = record.cases.bundle;
    id('ft-input').textContent = lanes.map(l => {
      const item=record.cases[l.key];
      return names[l.key]+'\n\n'+item.prompt+'\n\nOutput token IDs: '+l.steps.map(s=>s.id).join(' · ');
    }).join('\n\n————————\n\n');
    const sample = c.runs[c.shown].steps[0];
    id('ft-method').textContent = 'After reading the model and tokenizer files, the model held '+num.format(sample.kvBytes)+' bytes of KV tensors. Its cache geometry predicts '+num.format(cacheBytes(c.inputIds.length,1,record.architecture))+' bytes. The process resident set sampled at that boundary was '+mib(sample.rssBytes)+'. Model parameter payload: '+mib(record.weightsBytes)+'. RSS includes the runtime. GPU memory and power were not measured. Raw data includes model-load time, the first process call, warm repetitions, token IDs, hashes and every step.';
    paint(lanes[0].first);
  }
  id('ft-device').textContent = record.model+' · '+record.cpu+' · '+record.threads+' CPU threads · FP32 · PyTorch '+record.runtime.torch+'. License: '+record.license+'. Revision: '+record.revision+'. Each lane plays the warm run with median prefill time. Greedy decoding, up to '+record.maxOutputTokens+' output tokens. Clocks sum timed synchronous forward passes and token selection. Loading, tokenization, logging and queueing are excluded.';
  for (const [key,c] of Object.entries(record.cases)) {
    const first = c.runs.map(r=>r.steps[0].ns);
    const decoding = c.runs.flatMap(r=>r.steps.slice(1).map(s=>s.ns));
    const tr = node('tr');
    for (const txt of [names[key],milli(median(first))+' ['+milli(Math.min(...first))+'–'+milli(Math.max(...first))+']',milli(median(decoding)),mib(c.runs[c.shown].steps[0].kvBytes)]) tr.append(node('td','',txt));
    id('ft-stats').append(tr);
  }
  id('ft-time').oninput = event => { halt(true); paint(Number(event.target.value)*duration/1000); };
  id('ft-inspect-run').onchange = event => { selectRecording(event.target.value); paint(cursor); };
  ['ft-first','ft-next','ft-bundle'].forEach((name, index) => {
    id(name).onclick = () => { halt(true); selectRecording(lanes[index].key); paint(lanes[index].first); };
  });
  id('ft-play').onclick = () => {
    if (playing) { halt(true); return; }
    const from = paused && cursor<duration ? cursor : 0;
    let previous = performance.now();
    paint(from);
    id('ft-play').textContent = 'Pause replay';
    function advance(now) {
      const elapsed = Math.max(0, now-previous);
      previous = now;
      paint(cursor+elapsed*1e6*Number(id('ft-speed').value));
      if (cursor<duration) playing=requestAnimationFrame(advance);
      else halt();
    }
    playing=requestAnimationFrame(advance);
  };
  document.addEventListener('visibilitychange',()=>{if(document.hidden && playing)halt(true);});
  id('ft-download').onclick = () => {
    const blob = new Blob([JSON.stringify(record,null,2)],{type:'application/json'});
    const url = URL.createObjectURL(blob);
    const link=node('a');
    link.href=url;link.download='first-token-recorded-run.json';link.click();
    window.setTimeout(()=>URL.revokeObjectURL(url),2000);
  };
  chapter.querySelector('.ft-live').hidden=false;
  configure();
  mountDeviceRun(record, chapter.dataset.worker);
}
