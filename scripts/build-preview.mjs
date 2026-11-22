import fs from 'node:fs';
import path from 'node:path';
import vm from 'node:vm';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('../', import.meta.url));
const destination = process.argv[2];
if (!destination) throw Error('Pass the destination HTML path.');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
const parts = ['shared/core.js', 'memory/model.js', 'memory/workload-model.js', 'memory/trace.js', 'memory/first-token.js', 'memory/workload-plot.js', 'memory/workload.js', 'memory/app.js'];
// This buildless project uses single-line local imports and named declarations.
// Fail if a future module needs a full bundler.
const modules = parts.map(name => '// ' + name + '\n' +
  read(name).replace(/^import .*?;\r?\n/gm, '').replace(/^export /gm, ''));
const code = "(() => {\n'use strict';\n" + modules.join('\n').replace(
  "const STORAGE_KEY = 'brandon-memory-crate-v2';", "const STORAGE_KEY = 'brandon-memory-crate-preview-v2';"
) + '\n})();';
new vm.Script(code, { filename: 'memory-crate-preview.js' });
const sourceCSS = ['shared/play.css', 'memory/app.css', 'memory/workload.css', 'memory/first-token.css'].map(read).join('\n');
const css = sourceCSS.replace(/@font-face\{[^}]*\}/g, '');

let page = read('memory/index.html').replace(/<link rel="stylesheet"[^>]+>/g, '')
  .replace(/<script[^>]*>[\s\S]*?<\/script>/g, '')
  .replace(/<meta name="playground-narration"[^>]+>/g, '')
  .replace('class="brand" href="../index.html"', 'class="brand" href="https://brandonfhuang.com/"')
  .replaceAll('href="../index.html"', 'href="https://brandonfhuang.com/projects/"')
  .replace('href="../README.md"', 'href="https://github.com/bomberJV/memory-crate/pull/3"')
  .replace('</head>', () => '<style>' + css + '</style></head>');
const recording = read('experiment/recorded-run.json').replace(/</g, '\\u003c');
page = page.replace('</body>', () => '<script id="record-data" type="application/json">' + recording + '</script></body>');
page = page.replace('</body>', () => '<script>' + code.replace(/<\/script/gi, '<\\/script') + '</script></body>');
page = page.replace('<!doctype html>', '<!doctype html>\n<!-- Memory Crate by Brandon Frank Han-Chween Huang. Source and licenses: https://github.com/bomberJV/memory-crate . The single-file edition omits the separate recorded workshop narration. -->');
if (/<(?:script[^>]*src=|link[^>]*href=)/i.test(page) || /url\(['"]?\.\//i.test(page)) throw Error('Unbundled dependency in the offline preview.');
fs.mkdirSync(path.dirname(path.resolve(destination)), { recursive: true });
fs.writeFileSync(destination, page);
console.log('Wrote ' + path.basename(destination) + ' (' + Buffer.byteLength(page) + ' bytes).');
