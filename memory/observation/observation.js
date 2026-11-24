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
  const run = el('run'), stop = el('stop');
  if (!self.isSecureContext || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined' || typeof BigInt64Array === 'undefined' || location.protocol === 'file:') {
    run.hidden = true;
    el('device-note').textContent = 'Live measurement requires a supported browser and a secure website. The recorded traces above are available here.';
    if (location.protocol === 'file:') {
      const link = add('a',run.parentNode,'Open the browser experiment');
      link.href = 'https://the-third-conversation.brainyalbatross8.chatgpt.site/';
    }
    return;
  }
  run.disabled = false;
  let worker = null, liveURL = '', workerURL = '', watchdog;
  function clean() {
    clearTimeout(watchdog);
    if (worker) worker.terminate();
    if (workerURL) URL.revokeObjectURL(workerURL);
    worker = null; workerURL = ''; run.disabled = false; stop.hidden = true;
  }
  function fail() { clean(); el('status').textContent = 'The live run could not finish on this device. The recorded traces are still available above.'; }
  function armTimeout() { clearTimeout(watchdog); watchdog = setTimeout(fail, 180000); }
  stop.onclick = () => { clean(); el('status').textContent = 'Live run stopped.'; run.focus(); };
  run.onclick = () => {
    if (worker) return;
    el('live-output').hidden = true; el('live-result').hidden = true; el('live-raw').hidden = true;
    if (liveURL) URL.revokeObjectURL(liveURL);
    run.disabled = true; stop.hidden = false; el('status').textContent = 'Loading the browser runtime and model…';
    try {
      const source = el('worker-source');
      if (source) workerURL = URL.createObjectURL(new Blob([source.textContent],{type:'text/javascript'}));
      worker = new Worker(workerURL || 'device-worker.js',{type:'module'});
      armTimeout();
      worker.onerror = fail;
      worker.onmessage = ({data}) => {
        armTimeout();
        if (data.type==='error') { console.error('Device inference:', data.detail); fail(); return; }
        if (data.type==='progress') el('status').textContent = 'Loading model weights · '+data.percent+'%';
        if (data.type==='start') el('status').textContent = data.run ? 'Measuring warm repetition '+data.run+' of 3…' : 'Generating the first answer on this device…';
        if (data.type==='token') { el('live-output').hidden = false; el('live-output').textContent = data.text; }
        if (data.type==='complete') {
          clean();
          const report=data.report, first=report.runs[0], warm=report.runs.slice(1).map(r=>r.timestampsMs[0]).sort((a,b)=>a-b);
          el('status').textContent = 'Measured on this device · 8-bit weights · WebAssembly CPU';
          el('live-output').hidden=false; el('live-output').textContent=first.text;
          el('live-result').hidden=false;
          el('live-result').textContent = 'First token “'+first.firstToken+'” · '+milliseconds(first.timestampsMs[0])+' on the first generation. Warm median '+milliseconds(warm[1])+' (range '+milliseconds(warm[0])+'–'+milliseconds(warm[2])+'). Loading took '+(report.loadingMs/1000).toFixed(1)+' s.';
          liveURL=URL.createObjectURL(new Blob([JSON.stringify(report,null,2)],{type:'application/json'}));
          el('live-raw').href=liveURL; el('live-raw').hidden=false;
        }
      };
      worker.postMessage({ids:runs[0].inputIds,limit:record.maxOutputTokens});
    } catch { fail(); }
  };
  addEventListener('pagehide',clean);
})();
