import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { cacheBytes } from '../memory/model.js';

const raw = fs.readFileSync(new URL('../experiment/recorded-run.json',import.meta.url));
const record = JSON.parse(raw);

test('the embedded artifact is the exact output of the recording job', () => {
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'4f90c1ae55c16b623802f4369d1746471b57b3cd286153a6c293413752b9af35');
  assert.equal(record.device,'CPU');
  assert.equal(record.weightsBytes,538060032);
  assert.equal(record.tokenizerRevision,record.revision);
  assert.ok(record.hashes['model.safetensors'] && record.hashes['tokenizer.json']);
  assert.equal(record.firstCall.steps[0].phase,'prefill');
});

test('every repetition has the real deterministic output, timing and KV tensor receipt', () => {
  for (const [key,c] of Object.entries(record.cases)) {
    assert.equal(c.runs.length,5);
    const shown=c.runs[c.shown];
    const times=c.runs.map(r=>r.steps[0].ns).sort((a,b)=>a-b);
    assert.equal(shown.steps[0].ns,times[2]);
    assert.equal(c.inputIds.length,key==='short'?64:434);
    for (const run of c.runs) {
      assert.deepEqual(run.steps.map(s=>s.id),shown.steps.map(s=>s.id));
      assert.equal(run.output,run.steps.map(s=>s.piece).join(''));
      assert.match(run.output,/\b30\b/);
      run.steps.forEach((s,i)=>{
        assert.equal(s.phase,i?'decode':'prefill');
        assert.equal(s.positions,c.inputIds.length+i);
        assert.equal(s.kvBytes,cacheBytes(s.positions,1,record.architecture));
        assert.ok(s.ns>0 && s.rssBytes>s.kvBytes);
      });
    }
  }
  const config = JSON.parse(record.cases.long.prompt.split('\n\n'+record.question)[0].replace('Model configuration:\n',''));
  assert.equal(config.num_hidden_layers,record.architecture.layers);
  assert.equal(record.cases.short.prompt,'Model configuration:\n"num_hidden_layers": '+config.num_hidden_layers+'\n\n'+record.question);
  assert.ok(record.cases.long.prompt.endsWith(record.question));
});
