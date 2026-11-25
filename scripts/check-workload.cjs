// Browser regression check. Playwright and Chrome are test-only dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const repo = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'memory-workload-'));
const output = process.argv[2] || temp;
fs.mkdirSync(output, { recursive: true });
const single = path.join(temp, 'preview.html');
execFileSync(process.execPath, [path.join(__dirname, 'build-preview.mjs'), single]);
const routes = new Map([['/preview.html', single], ['/memory/', path.join(repo, 'memory/index.html')]]);
for (const [directory, names] of Object.entries({
  memory: ['app.js', 'app.css', 'model.js', 'trace.js', 'workload-model.js', 'workload-plot.js', 'workload.js', 'workload.css', 'first-token.css', 'first-token.js'],
  'memory/observation': ['device-run.js','device-worker.js'],
  'memory/admission': ['admission.js', 'admission.css', 'scenario.js'],
  experiment: ['recorded-run.json'],
  shared: ['core.js', 'play.css', 'narration.js', 'narration.css', 'narration-voice.js', 'opus-frames.js', 'symbols.woff']
})) {
  for (const name of names) routes.set('/' + directory + '/' + name, path.join(repo, directory, name));
}
routes.set('/memory/admission/', path.join(repo, 'memory/admission/index.html'));
const mime = { '.json':'application/json', '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff' };
const server = http.createServer((req, res) => {
  const file = routes.get(new URL(req.url, 'http://localhost').pathname);
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': mime[path.extname(file)] });
  fs.createReadStream(file).pipe(res);
});

async function checkWidth(page) {
  const sizes = await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.clientWidth]);
  assert.ok(sizes[0] <= sizes[1] + 1, 'Page width ' + sizes.join(' / '));
}
async function capture(page, name) {
  await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
  await page.screenshot({ path: path.join(output, name + '.jpg'), type: 'jpeg', quality: 78 });
}
async function checkRecording(page, phone) {
  const byId = id => page.locator('#'+id);
  await byId('ft-play').waitFor();
  await page.locator('.ft-stage').screenshot({ path:path.join(output,phone ? 'phone-first-token.jpg':'desktop-first-token.jpg') });
  const recorded = JSON.parse(fs.readFileSync(path.join(repo, 'experiment/recorded-run.json'),'utf8'));
  const selected = name => {const c=recorded.cases[name]; return c.runs[c.shown].steps;};
  const short=selected('short'), long=selected('long');
  assert.equal(await byId('ft-factor').textContent(), (long[0].ns / short[0].ns).toFixed(1)+'×');
  assert.equal(await page.locator('.ft-cache').first().textContent(), (short[0].kvBytes/2**20).toFixed(2)+' MiB KV cache after input');
  await byId('ft-first').click();
  const answers = page.locator('.ft-answer');
  assert.equal(await answers.nth(0).innerText(), short[0].piece);
  assert.match(await answers.nth(1).innerText(), /Reading/);
  await byId('ft-next').click();
  assert.equal(await answers.nth(1).innerText(), long[0].piece);
  await byId('ft-play').click();
  await page.waitForFunction(() => document.querySelector('#ft-play').textContent === 'Replay both runs');
  assert.ok((await answers.nth(1).innerText()).includes(recorded.cases.long.runs[recorded.cases.long.shown].output));
  await page.locator('.ft-evidence > summary').click();
  assert.ok((await byId('ft-stats').innerText()).includes(Math.round(long[0].ns/1e6)+' ms'));
  const download = page.waitForEvent('download');
  await byId('ft-download').click();
  const file=await download;
  assert.equal(file.suggestedFilename(),'first-token-recorded-run.json');
  const record=JSON.parse(fs.readFileSync(await file.path(),'utf8'));
  assert.equal(record.cases.long.runs.length,5);
  await page.locator('.ft-evidence > summary').click();
}
async function runWorkload(browser, url, phone) {
  const context = await browser.newContext({
    viewport: phone ? { width: 390, height: 844 } : { width: 1400, height: 900 },
    hasTouch: phone, reducedMotion: phone ? 'reduce' : 'no-preference'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', e => errors.push(e.message));
  await page.goto(url);
  await page.locator('#trace-total').waitFor();
  const textOf = selector => page.locator(selector).innerText();
  const click = async selector => {
    const element = page.locator(selector);
    if (phone) await element.tap(); else await element.click();
  };
  assert.equal(await textOf('#trace-total'), '16.901 GiB');
  assert.match(await textOf('#trace-difference'), /KV cache grew from 0 to 1 GiB/);
  await capture(page, phone ? 'calculator-phone' : 'calculator-desktop');
  await click('#context-steps button:first-child');
  assert.equal(await textOf('#trace-total'), '15.901 GiB');
  await page.locator('#trace-sequences').selectOption('2');
  await page.locator('#trace-tokens').selectOption('8192');
  assert.match(await textOf('#trace-difference'), /KV cache grew from 0 to 2 GiB/);
  await click('#trace-baseline');
  assert.match(await textOf('#trace-difference'), /matches the baseline/);
  await click('.experiment-links a[href="#first-token"]');
  await checkRecording(page, phone);
  assert.ok(await page.locator('#run').isEnabled());
  assert.equal(await page.locator('#live-raw').isVisible(), false);
  await click('#workload-detail > summary');
  await page.locator('#load-plot').scrollIntoViewIfNeeded();
  assert.equal(await textOf('#load-peak'), '24.901 GiB');
  assert.match(await textOf('#plan-result-title'), /Request C.*810/);
  const plot = page.locator('#load-plot');
  const box = await plot.boundingBox();
  assert.ok(box.height > 185 && box.y < 844, 'Visible plot on the first screen.');
  const hasInk = await plot.evaluate(c => {
    const pixels = c.getContext('2d').getImageData(0, 0, c.width, c.height).data;
    return pixels.some((v, index) => index % 4 === 3 && v === 255);
  });
  assert.ok(hasInk, 'Chart is drawn.');
  await checkWidth(page);
  await capture(page, phone ? 'phone-original' : 'desktop-original');
  await click('#load-last');
  assert.match(await textOf('#load-event'), /809 tokens/);
  assert.equal(await textOf('#load-state'), '90,112 bytes free');
  await click('#load-first');
  assert.match(await textOf('#load-event'), /810 tokens/);
  assert.equal(await textOf('#load-state'), '40,960 bytes over budget');
  const selectedStep = await page.locator('#load-scrub').inputValue();
  await click('[data-plan="queue"]');
  assert.equal(await page.locator('#load-scrub').inputValue(), selectedStep);
  assert.equal(await textOf('#load-peak'), '23.901 GiB');
  assert.equal(await page.locator('#load-arrival').inputValue(), '7');
  assert.ok(await page.locator('#load-first').isDisabled());
  assert.ok(await page.locator('#load-original-key').isVisible());
  await capture(page, phone ? 'phone-queued' : 'desktop-queued');
  await click('[data-plan="precision"]');
  await click('#load-peak-jump');
  assert.equal(await textOf('#load-weights'), '7.451 GiB');
  assert.equal(await textOf('#load-c'), '1.000 GiB');
  assert.equal(await textOf('#load-total'), '17.451 GiB');
  await click('[data-plan="trim"]');
  assert.equal(await page.locator('#edit-c').inputValue(), '809');
  assert.equal(await textOf('#load-state'), '90,112 bytes free');
  await click('[data-plan="original"]');
  const arrival = page.locator('#load-arrival');
  if (phone) {
    const size = await arrival.boundingBox();
    await arrival.tap({ position: { x: 9 + 0.8 * (size.width - 18), y: size.height / 2 } });
    assert.equal(await arrival.inputValue(), '7');
  } else {
    await arrival.focus();
    await page.keyboard.press('ArrowRight');
    assert.equal(await arrival.inputValue(), '5');
  }
  await page.locator('#load-scrub').focus();
  await page.keyboard.press('Home');
  await page.keyboard.press('ArrowRight');
  assert.match(await textOf('#load-event'), /Event 1.*A admitted/);
  await plot.click({ position: { x: box.width * 0.65, y: box.height * 0.55 } });
  assert.ok(Number(await page.locator('#load-scrub').inputValue()) > 32768);
  await click('#load-play');
  await page.waitForFunction(() => document.getElementById('load-play').textContent === 'Pause replay' && Number(document.getElementById('load-scrub').value) > 0);
  await click('#load-play');
  assert.equal(await textOf('#load-play'), 'Resume replay');

  await click('#load-editor > summary');
  await page.locator('#edit-a').fill('32769');
  await click('#load-form button[type=submit]');
  assert.equal(await page.locator('#edit-a').evaluate(input => input.validity.rangeOverflow), true);
  for (const id of ['a', 'b', 'c']) await page.locator('#edit-' + id).fill('0');
  await page.locator('#edit-capacity').selectOption('16');
  await page.locator('#edit-reserve').selectOption('2');
  await click('#load-form button[type=submit]');
  assert.match(await textOf('#plan-result-title'), /already exceed/);
  await click('#load-first');
  assert.equal(await page.locator('#load-scrub').inputValue(), '0');
  assert.ok(await page.locator('#load-last').isDisabled());
  await click('#load-method > summary');
  assert.match(await textOf('#load-unit-cost'), /131,072 bytes/);
  assert.match(await textOf('#load-byte-receipt'), /16,000,000,000 bytes/);
  await checkWidth(page);

  await click('#memory-workshop > summary');
  await click('#trace-example');
  await page.locator('#trace-tokens').selectOption('8192');
  assert.equal(await textOf('#trace-state'), 'Estimated budget exceeded');
  await page.locator('#trace-sequences').selectOption('2');
  assert.match(await page.locator('#trace-cache-math').textContent(), /2 GiB/);
  await click('#trace-reset');
  await click('.trace-evidence > summary');
  assert.match(await textOf('#trace-changes'), /No inputs changed/);
  assert.ok(await page.getByRole('link', { name: /Inspect the separate medical AI research/ }).isVisible());
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel: 'chrome' });
    await runWorkload(browser, base + '/memory/', false);
    await runWorkload(browser, base + '/preview.html', true);
    for (const width of [320, 768]) {
      const page = await browser.newPage({ viewport: { width, height: 800 } });
      await page.goto(base + '/preview.html');
      await page.locator('#trace-total').waitFor();
      await page.locator('#ft-play').waitFor();
      await checkWidth(page);
      await page.close();
    }
    for (const width of [320, 390, 1280]) {
      const page = await browser.newPage({ viewport: { width, height: width < 500 ? 844 : 800 }, hasTouch: width < 500 });
      await page.goto(base + '/memory/admission/');
      const action = id => width < 500 ? page.locator(id).tap() : page.locator(id).click();
      const outcome = () => page.locator('#outcome').innerText();
      await page.locator('#wait').waitFor();
      assert.match(await page.locator('#consequence').innerText(), /Only 809 fit/);
      await action('#wait');
      assert.equal(await outcome(), 'Both histories stay intact.');
      await action('#finish');
      assert.match(await page.locator('[data-id="a"] .quantity').innerText(), /Finished/);
      assert.match(await page.locator('[data-id="c"] .quantity').innerText(), /8,192 tokens/);
      await action('#trim');
      assert.equal(await page.locator('[data-status="trimmed"]').count(), 2);
      assert.equal(await page.locator('[data-id="a"] .quantity').innerText(), '28,672 tokens');
      await checkWidth(page);
      if (width !== 320) await page.screenshot({path: path.join(output, 'admission-' + width + '.png'), fullPage:true});
      await action('#reset');
      assert.equal(await outcome(), 'Who gets the memory?');
      await page.close();
    }
    const paper = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
    await paper.goto(base + '/preview.html');
    assert.match(await paper.locator('#first-token').innerText(), /567 ms/);
    await paper.locator('#workload-detail > summary').click();
    assert.match(await paper.locator('.paper-load').innerText(), /40,960 bytes/);
    assert.equal(await paper.locator('#load-play').isVisible(), false);
    await paper.close();
    console.log('Passed workload replay, byte boundary, schedule, precision, trim, input, responsive layout, keyboard, touch, static fallback and workshop checks.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (output !== temp) fs.rmSync(temp, { recursive: true, force: true });
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
