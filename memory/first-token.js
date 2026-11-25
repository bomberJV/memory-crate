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
  const sum = values => values.reduce((a,b) => a+b,0);
  const median = values => {
    const sorted = [...values].sort((a,b) => a-b);
    const middle = Math.floor(sorted.length/2);
    return sorted.length%2 ? sorted[middle] : (sorted[middle-1]+sorted[middle])/2;
  };
  const names = {short:'Departure notice', long:'Full station board', edit:'Amended board'};
  let amended = false;
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
    header.append(node('span','',names[lane.key]+' · '+lane.count+' tokens'),node('small','','First token · '+milli(lane.first)));
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
    wrapper.append(header,lane.answer,track);
    return wrapper;
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
        else {
          for (const s of visible) {
            if (s.piece.trim() === '4' || s.piece.trim() === '9') lane.answer.append(node('mark','',s.piece));
            else lane.answer.append(document.createTextNode(s.piece));
          }
          if (count === record.maxOutputTokens) lane.answer.append(document.createTextNode('…'));
        }
        lane.answer.dataset.reading = String(count === 0);
        lane.shown = count;
      }
      lane.marker.style.left = 'calc('+pct*100+'% - 1px)';
      lane.shade.style.left = pct*100+'%';
    }
    id('ft-time').value = String(Math.round(pct*1000));
    id('ft-time').setAttribute('aria-valuetext',milli(cursor)+' of '+milli(duration));
    id('ft-clock').textContent = milli(cursor);
  }
  function halt(resume=false) {
    cancelAnimationFrame(playing);
    playing = 0;
    paused = resume;
    id('ft-play').textContent = resume ? 'Resume replay' : 'Replay both runs';
  }
  function configure() {
    halt();
    lanes = [assemble('short'),assemble(amended ? 'edit' : 'long')];
    duration = Math.max(...lanes.map(lane => lane.end));
    id('ft-lanes').replaceChildren(...lanes.map(makeLane));
    id('ft-factor').textContent = (lanes[1].first/lanes[0].first).toFixed(1)+'×';
    id('ft-platform').textContent = amended ? '9' : '4';
    id('ft-edit').textContent = amended ? 'Restore platform 4' : 'Change 4 to 9';
    id('ft-edit').setAttribute('aria-pressed', String(amended));
    id('ft-caption').textContent = amended
      ? 'One input digit changed on the full board. The model changed its answer to platform 9. Both responses are recorded.'
      : 'Hatching shows the time spent reading the prompt. Each solid segment produces one more token. Both runs start together in the replay and were measured separately on the same CPU.';
    const c = record.cases[lanes[1].key];
    id('ft-input').textContent = lanes.map(l => {
      const item=record.cases[l.key];
      return names[l.key]+'\n\n'+item.prompt+'\n\nOutput token IDs: '+l.steps.map(s=>s.id).join(' · ');
    }).join('\n\n————————\n\n');
    const sample = c.runs[c.shown].steps[0];
    id('ft-method').textContent = 'After prefill the selected board has '+num.format(sample.kvBytes)+' bytes of KV tensors. Its cache geometry predicts '+num.format(cacheBytes(c.inputIds.length,1,record.architecture))+' bytes. The process resident set sampled at that boundary was '+mib(sample.rssBytes)+'. Model parameter payload: '+mib(record.weightsBytes)+'. RSS includes the runtime. GPU memory and power were not measured. Raw data includes model-load time, the first process call, warm repetitions, token IDs, hashes and every step.';
    paint(amended ? duration : lanes[0].end);
  }
  id('ft-device').textContent = record.model+' · '+record.cpu+' · '+record.threads+' CPU threads · FP32 · PyTorch '+record.runtime.torch+'. License: '+record.license+'. Revision: '+record.revision+'. Each lane plays the warm run with median prefill time. Greedy decoding, up to '+record.maxOutputTokens+' output tokens. Clocks sum timed synchronous forward passes and token selection. Loading, tokenization, logging and queueing are excluded.';
  for (const [key,c] of Object.entries(record.cases)) {
    const first = c.runs.map(r=>r.steps[0].ns);
    const decoding = c.runs.flatMap(r=>r.steps.slice(1).map(s=>s.ns));
    const tr = node('tr');
    for (const txt of [names[key],milli(median(first))+' ['+milli(Math.min(...first))+'–'+milli(Math.max(...first))+']',milli(median(decoding)),mib(c.runs[c.shown].steps[0].kvBytes)]) tr.append(node('td','',txt));
    id('ft-stats').append(tr);
  }
  id('ft-edit').onclick = () => { amended=!amended; configure(); };
  id('ft-time').oninput = event => { halt(true); paint(Number(event.target.value)*duration/1000); };
  id('ft-first').onclick = () => { halt(true); paint(lanes[0].first); };
  id('ft-next').onclick = () => { halt(true); paint(lanes[1].first); };
  id('ft-play').onclick = () => {
    if (playing) { halt(true); return; }
    const from = paused && cursor<duration ? cursor : 0;
    const start = performance.now();
    paint(from);
    id('ft-play').textContent = 'Pause replay';
    function advance(now) {
      paint(from+(now-start)*1e6);
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
