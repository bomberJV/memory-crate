import { mountDeviceRun } from './device-run.js';

(async () => {
  const el = id => document.getElementById(id);
  const main = document.querySelector('main');
  const add = (tag, parent, text, cls) => {
    const node = document.createElement(tag);
    if (cls) node.className = cls;
    if (text !== undefined) node.textContent = text;
    parent.append(node);
    return node;
  };
  const milliseconds = n => Math.round(n).toLocaleString('en-US')+' ms';
  const embedded = el('capture');
  let record;
  try {
    if (embedded) record = JSON.parse(embedded.textContent);
    else {
      const res = await fetch(main.dataset.record);
      if (!res.ok) throw Error('Recording unavailable');
      record = await res.json();
    }
  } catch { el('status').textContent = 'The recording could not load. Reload to try again.'; return; }
  if (embedded) el('raw').href = URL.createObjectURL(new Blob([embedded.textContent],{type:'application/json'}));
  const runs = [record.cases.short,record.cases.long];
  const samples = runs.map(r => r.runs[r.shown].steps);
  const span = Math.ceil(Math.max(...samples.map(steps => steps.reduce((n,s)=>n+s.ns/1e6,0)))/500)*500;
  const names = ['Departure notice','Full station board'];
  for (const [i,c] of runs.entries()) {
    const sample = samples[i], first = sample[0].ns/1e6;
    const row = add('div', el('traces'), undefined, 'row');
    const title = add('div', row, undefined, 'row-title');
    add('strong',title,names[i]); add('span',title,c.inputIds.length+' tokens · '+milliseconds(first),'stats');
    const track = add('div',row,undefined,'track');
    track.setAttribute('aria-hidden','true');
    add('i',track,undefined,'prefill').style.width = (100*first/span)+'%';
    let time=0;
    for (const [j,step] of sample.entries()) {
      time += step.ns/1e6;
      if (j) add('i',track,undefined,'tick').style.left = (100*time/span)+'%';
    }
    const answer = sample.filter(s=>s.id!==record.eos).map(s=>s.piece).join('');
    add('p',row,'“'+answer+'…”','output');
    const disclosure = add('details',el('inputs'));
    add('summary',disclosure,names[i]+' · full input'); add('pre',disclosure,c.prompt);
  }
  const scale = add('div',el('traces'),undefined,'scale');
  add('span',scale,'0 s'); add('span',scale,(span/2000)+' s'); add('span',scale,(span/1000)+' s');
  const key = add('div',el('traces'),undefined,'key');
  add('span',key,'Reading the input'); add('span',key,'Subsequent output tokens');
  el('finding').textContent = 'Both answers begin with “'+samples[0][0].piece.trim()+'”. With the full board, that token arrives '+((samples[1][0].ns-samples[0][0].ns)/1e9).toFixed(2)+' seconds later.';
  el('method').textContent = record.model+' · '+record.license+' · '+record.revision+'. Recorded in '+record.dtype+' on '+record.cpu+' with '+record.threads+' threads. Each trace is the run with the median first-token time among '+runs[0].runs.length+' warm repetitions. The excerpts show the first '+record.maxOutputTokens+' tokens.';
  mountDeviceRun(record, 'device-worker.js');
})();
