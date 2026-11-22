import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import crypto from 'node:crypto';
import { cacheBytes } from '../memory/model.js';

const raw = fs.readFileSync(new URL('../experiment/recorded-run.json',import.meta.url));
const record = JSON.parse(raw);

test('the embedded artifact is the exact output of the recording job', () => {
  assert.equal(crypto.createHash('sha256').update(raw).digest('hex'),'e22e38be9ffc8f9c9197e79e57104095223ba7430e51c7e5cf98325060b50533');
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
    assert.equal(c.inputIds.length,key==='short'?75:727);
    for (const run of c.runs) {
      assert.deepEqual(run.steps.map(s=>s.id),shown.steps.map(s=>s.id));
      assert.equal(run.output,run.steps.map(s=>s.piece).join(''));
      assert.match(run.output,key==='edit'?/Platform 9/:/Platform 4/);
      run.steps.forEach((s,i)=>{
        assert.equal(s.phase,i?'decode':'prefill');
        assert.equal(s.positions,c.inputIds.length+i);
        assert.equal(s.kvBytes,cacheBytes(s.positions,1,record.architecture));
        assert.ok(s.ns>0 && s.rssBytes>s.kvBytes);
      });
    }
  }
  assert.equal(record.cases.edit.prompt,record.cases.long.prompt.replace('Lisbon | Platform 4','Lisbon | Platform 9'));
  assert.equal(record.cases.edit.inputIds.filter((id,i)=>id!==record.cases.long.inputIds[i]).length,1);
});
