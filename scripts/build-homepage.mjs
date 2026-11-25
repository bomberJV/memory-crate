// Export a small red-film cue sheet and the deeper project page from the same recording.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../',import.meta.url));
const destination = process.argv[2];
if (!destination) throw Error('Pass the destination public directory.');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const write = (file,body) => {
  const name = path.join(destination,file);
  fs.mkdirSync(path.dirname(name),{recursive:true});
  fs.writeFileSync(name,body);
};
const raw = read('experiment/recorded-run.json');
const record = JSON.parse(raw);
const cues = {};
for (const [key,c] of Object.entries(record.cases)) {
  let ns = 0;
  cues[key] = {count:c.inputIds.length, events:c.runs[c.shown].steps.map(s => {
    ns += s.ns;
    return [ns,s.piece];
  })};
}
write('home/red/first-token-data.js','// Generated from memory-crate experiment/recorded-run.json. Cumulative measured CPU nanoseconds.\nconst redTokenCues = '+JSON.stringify(cues)+';\n');
const base = 'projects/play/memory/first-token/';
const source = read('memory/index.html');
const first = source.indexOf('<section id="first-token"');
const end = source.indexOf('</section>',first);
if (first<0 || end<0) throw Error('Chapter missing from the project entry point.');
const chapter = source.slice(first,end+10)
  .replace('data-record="../experiment/recorded-run.json"','data-record="recorded-run.json"')
  .replace('data-worker="observation/device-worker.js"','data-worker="../observation/device-worker.js"')
  .replace('href="#inference-trace"','href="/projects/play/memory/#inference-trace"')
  .replace('<h2 id="ft-title">','<h1 id="ft-title">').replace('</em></h2>','</em></h1>');
const page = '<!doctype html>\n<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>Before the first word | Brandon Huang</title><meta name="description" content="Watch two recorded language model runs answer the same question."><link rel="stylesheet" href="/projects/play/shared/play.css"><link rel="stylesheet" href="chapter.css"><script defer src="chapter.js"></script></head><body><header><a class="brand" href="/"><b>B.</b>BRANDON FRANK HAN-CHWEEN HUANG</a><a href="/projects/">Projects</a></header><main>'+chapter+'</main><footer>By Brandon Frank Han-Chween Huang</footer></body></html>';
write(base+'index.html',page);
write(base+'chapter.css',read('memory/first-token.css'));
const model = read('memory/model.js').replace(/^export /gm,'');
const controller = read('memory/observation/device-run.js').replace(/^export /gm,'');
const view = read('memory/first-token.js').replace(/^import .*;\r?\n/gm,'').replace(/^export /gm,'');
write(base+'chapter.js', "(() => {\n'use strict';\n"+model+'\n'+controller+'\n'+view+'\nmountFirstToken();\n})();\n');
write(base+'recorded-run.json',raw);

const observation = 'projects/play/memory/observation/';
const capture = '../first-token/recorded-run.json';
write(observation+'index.html',read('memory/observation/index.html').replaceAll('../../experiment/recorded-run.json',capture));
for (const file of ['observation.css','observation.js','device-run.js','device-worker.js']) write(observation+file,read('memory/observation/'+file));
