export function mountDeviceRun(record, workerPath) {
  const el = id => document.getElementById(id);
  const milliseconds = value => Math.round(value).toLocaleString('en-US') + ' ms';
  const run = el('run'), stop = el('stop');
  function showHostedLink() {
    const host = 'https://the-third-conversation.brainyalbatross8.chatgpt.site/';
    if (location.origin === new URL(host).origin || el('hosted-device-link')) return;
    const link = document.createElement('a');
    link.id = 'hosted-device-link';
    link.href = host;
    link.textContent = 'Open the hosted browser experiment';
    run.parentNode.append(link);
  }
  if (!self.isSecureContext || typeof Worker === 'undefined' || typeof WebAssembly === 'undefined' || typeof BigInt64Array === 'undefined' || (location.protocol === 'file:' && !el('worker-source'))) {
    run.hidden = true;
    el('device-note').textContent = 'Live measurement requires a supported browser and a secure website. The recorded traces above are available here.';
    showHostedLink();
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
  function fail() { clean(); el('status').textContent = 'The live run could not finish on this device. The recorded traces are still available above.'; showHostedLink(); }
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
      worker = new Worker(workerURL || workerPath,{type:'module'});
      armTimeout();
      const activeWorker = worker;
      worker.onerror = () => { if (worker === activeWorker) fail(); };
      worker.onmessage = ({data}) => {
        if (worker !== activeWorker) return;
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
      worker.postMessage({ids:record.cases.short.inputIds,limit:record.maxOutputTokens});
    } catch { fail(); }
  };
  addEventListener('pagehide',clean);
}
