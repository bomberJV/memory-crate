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
  memory: ['app.js', 'app.css', 'model.js', 'trace.js', 'workload-model.js', 'workload-plot.js', 'workload.js', 'workload.css'],
  shared: ['core.js', 'play.css', 'narration.js', 'narration.css', 'narration-voice.js', 'opus-frames.js', 'symbols.woff']
})) {
  for (const name of names) routes.set('/' + directory + '/' + name, path.join(repo, directory, name));
}
const mime = { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css', '.woff': 'font/woff' };
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
      await checkWidth(page);
      await page.close();
    }
    const paper = await browser.newPage({ javaScriptEnabled: false, viewport: { width: 320, height: 640 } });
    await paper.goto(base + '/preview.html');
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
