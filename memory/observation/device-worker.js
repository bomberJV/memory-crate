// The worker and its dependencies are loaded only after the visitor requests a run.
const runtime = '3.8.1';
const modelId = 'HuggingFaceTB/SmolLM2-135M-Instruct';
const revision = '12fd25f77366fa6b3b4b768ec3050bf629380bac';
self.onmessage = async ({ data }) => {
  try {
    const loading = performance.now();
    const { AutoModelForCausalLM, AutoTokenizer, Tensor, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.8.1/dist/transformers.min.js');
    env.allowLocalModels = false;
    env.backends.onnx.wasm.numThreads = 1;
    env.backends.onnx.wasm.proxy = false;
    const options = { revision, device: 'wasm', dtype: 'q8', progress_callback(event) {
      if (event.status === 'progress' && event.file?.endsWith('.onnx') && event.total > 0) {
        const percent = Math.floor(100 * event.loaded / event.total);
        if (percent !== lastPercent) { lastPercent = percent; self.postMessage({type:'progress', percent}); }
      }
    } };
    let lastPercent = -1;
    const [model, tokenizer] = await Promise.all([AutoModelForCausalLM.from_pretrained(modelId, options), AutoTokenizer.from_pretrained(modelId, {revision})]);
    const inputs = new Tensor('int64', BigInt64Array.from(data.ids, BigInt), [1,data.ids.length]);
    const mask = new Tensor('int64', new BigInt64Array(data.ids.length).fill(1n), [1,data.ids.length]);
    const report = {model:modelId, revision, runtime:'Transformers.js '+runtime, backend:'WebAssembly CPU', weights:'q8', threads:1,
      userAgent:navigator.userAgent, observedAt:new Date().toISOString(), inputIds:data.ids, maxNewTokens:data.limit,
      decoding:'greedy', loadingMs:performance.now()-loading, runs:[]};
    for (let run = 0; run < 4; run++) {
      self.postMessage({type:'start', run});
      let prompt = true;
      const ids = [], timestampsMs = [];
      const streamer = { put(batch) {
        if (prompt) { prompt = false; return; }
        const end = performance.now() - start;
        for (const token of batch[0]) { ids.push(Number(token)); timestampsMs.push(end); }
        if (!run) self.postMessage({type:'token', text:tokenizer.decode(ids,{skip_special_tokens:true})});
      }, end() {} };
      const start = performance.now();
      const result = await model.generate({input_ids:inputs, attention_mask:mask, do_sample:false, max_new_tokens:data.limit, streamer});
      const outputIds = result.tolist()[0].slice(data.ids.length).map(Number);
      if (!ids.length || ids.length !== outputIds.length || ids.some((id,i)=>id!==outputIds[i])) throw Error('Incomplete token trace');
      report.runs.push({phase:run?'warm':'first', outputIds, timestampsMs, firstToken:tokenizer.decode(outputIds.slice(0,1),{skip_special_tokens:false}), text:tokenizer.decode(ids,{skip_special_tokens:true})});
    }
    self.postMessage({type:'complete',report});
    await model.dispose();
  } catch (error) { self.postMessage({type:'error',detail:String(error?.message || error).slice(0,300)}); }
};
