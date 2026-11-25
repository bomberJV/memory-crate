import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
const root = fileURLToPath(new URL('../',import.meta.url));
const dest = process.argv[2];
if (!dest) throw Error('Pass an output HTML filename.');
const read = file => fs.readFileSync(path.join(root,file),'utf8');
const base = 'memory/observation/';
const script = s => s.replace(/<\/script/gi,'<\\/script');
const controller = read(base+'device-run.js').replace(/^export /gm,'');
const view = read(base+'observation.js').replace(/^import .*?;\r?\n/gm,'');
const page = read(base+'index.html')
  .replace('<link rel="stylesheet" href="observation.css">',()=>'<style>'+read(base+'observation.css')+'</style>')
  .replace('<script type="module" src="observation.js"></script>','')
  .replace('</body>',()=>'<script type="application/json" id="capture">'+read('experiment/recorded-run.json').replace(/</g,'\\u003c')+'</script>\n'+
    '<script type="text/plain" id="worker-source">'+script(read(base+'device-worker.js'))+'</script>\n<script>'+script(controller+'\n'+view)+'</script></body>');
fs.mkdirSync(path.dirname(path.resolve(dest)),{recursive:true});
fs.writeFileSync(dest,page);
