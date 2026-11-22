// Test-only dependency supplied by the browser job. The static app has no runtime dependencies.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const http = require('node:http');
const { execFileSync } = require('node:child_process');
const { chromium } = require('playwright-core');

const root = path.resolve(__dirname, '..');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'ferry-test-'));
const output = process.argv[2] || temp;
fs.mkdirSync(output, { recursive: true });
const packed = path.join(temp, 'preview.html');
execFileSync(process.execPath, [path.join(__dirname, 'build-preview.mjs'), packed]);
const files = new Map([['/preview.html', packed], ['/memory/', path.join(root, 'memory/index.html')]]);
for (const [directory, names] of [
  ['memory', ['app.js', 'app.css', 'model.js', 'trace.js', 'ferry.js', 'ferry-model.js', 'ferry.css', 'harbor.webp', 'ferry.webp']],
  ['shared', ['core.js', 'play.css', 'narration.js', 'narration.css', 'narration-voice.js', 'opus-frames.js', 'symbols.woff']]
]) for (const name of names) files.set('/' + directory + '/' + name, path.join(root, directory, name));
const types = { '.html': 'text/html', '.js': 'text/javascript', '.css':'text/css', '.webp':'image/webp', '.woff':'font/woff' };
const server = http.createServer((req, res) => {
  const file = files.get(new URL(req.url, 'http://localhost').pathname);
  if (!file || !fs.existsSync(file)) return res.writeHead(404).end();
  res.writeHead(200, { 'Content-Type': types[path.extname(file)] });
  fs.createReadStream(file).pipe(res);
});

async function waitPhase(page, phase) {
  await page.waitForFunction(wanted => document.querySelector('#crossing').dataset.phase === wanted, phase);
}
async function picture(page, name) {
  await page.evaluate(() => window.scrollTo({ top:0, behavior:'instant' }));
  await page.screenshot({ type:'jpeg', quality:76, path:path.join(output, name + '.jpg') });
}
async function checkPageFits(page) {
  const dimensions = await page.evaluate(() => ({
    viewport: document.documentElement.clientWidth,
    content: document.documentElement.scrollWidth,
    imagesReady: Array.from(document.querySelectorAll('#crossing img')).every(image => image.complete && image.naturalWidth > 0)
  }));
  assert.ok(dimensions.content <= dimensions.viewport + 1, JSON.stringify(dimensions));
  assert.ok(dimensions.imagesReady, 'Harbor and ferry artwork loaded.');
}
async function play(browser, base, mobile) {
  const context = await browser.newContext({
    viewport: mobile ? {width:390, height:844} : {width:1400,height:900},
    hasTouch:mobile, reducedMotion:mobile ? 'reduce' : 'no-preference'
  });
  const page = await context.newPage();
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  // Exercise a mounted site and the exact self-contained edition delivered to the visitor.
  await page.goto(base + (mobile ? '/preview.html' : '/memory/'));
  await waitPhase(page, 'start');
  await page.locator('.harbor-art').evaluate(img => img.decode());
  await page.locator('.ship-cutout').evaluate(img => img.decode());
  await checkPageFits(page);
  await picture(page, mobile ? 'phone-opening' : 'desktop-opening');
  if (mobile) {
    const button = await page.locator('#open-letter').boundingBox();
    assert.ok(button.y + button.height <= 844, 'Envelope reachable on the first phone screen.');
    await page.locator('#open-letter').tap();
  } else {
    await page.locator('#open-letter').focus();
    await page.keyboard.press('Enter');
  }
  await waitPhase(page, 'reading');
  assert.match(await page.locator('#nell-message').innerText(), /twice/);
  if (mobile) assert.match(await page.locator('#ferry-motion').innerText(), /Play motion/);
  await page.locator('#wind-log').click();
  await waitPhase(page, 'blocked');
  assert.match(await page.locator('#drive-count').innerText(), /809 \/ 8,192/);
  assert.match(await page.locator('#reel-reading').innerText(), /810/);
  assert.match(await page.locator('#memory-receipt').textContent(), /40,960/);
  await page.locator('#one-back').click();
  await waitPhase(page, 'reading');
  assert.equal(await page.locator('#ferry-scrub').inputValue(), '809');
  await page.locator('#ferry-scrub').focus();
  await page.keyboard.press('ArrowRight');
  await waitPhase(page, 'blocked');

  await page.locator('[data-recover="compact"]').click();
  await waitPhase(page, 'signal');
  assert.match(await page.locator('[data-value-from="total"]').textContent(), /9\.451 GiB/);
  // The focusable heading comes before the lamps in document order.
  await page.keyboard.press('Tab');
  assert.equal(await page.evaluate(() => document.activeElement.dataset.pier), 'clock');
  await page.keyboard.press('Enter');
  assert.match(await page.locator('#bell-feedback').innerText(), /one bell.*two bells/);
  await picture(page, mobile ? 'phone-lamps' : 'desktop-lamps');
  const before = await page.locator('#ship-position').getAttribute('style');
  if (mobile) await page.locator('[data-pier="glass"]').tap();
  else await page.locator('[data-pier="glass"]').click();
  await waitPhase(page, 'home');
  assert.match(await page.locator('#arrival-copy').innerText(), /Glasshouse/);
  assert.notEqual(await page.locator('#ship-position').getAttribute('style'), before);
  assert.ok(await page.locator('.pier-glass.is-home').count());
  await page.locator('#margin-note > summary').click();
  assert.match(await page.locator('#margin-kept').innerText(), /sandwich/);
  await page.locator('#try-other-route').click();
  await waitPhase(page, 'blocked');
  await page.locator('[data-recover="slips"]').click();
  await waitPhase(page, 'signal');
  assert.match(await page.locator('#drive-count').innerText(), /256 \/ 8,192/);
  assert.match(await page.locator('[data-value-from="total"]').textContent(), /15\.932 GiB/);
  await page.locator('[data-pier="glass"]').click();
  await page.locator('#margin-note > summary').click();
  assert.ok(await page.locator('#margin-missing').isVisible());
  assert.equal(await page.locator('#margin-kept').isVisible(), false);
  await page.locator('#play-again').click();
  await waitPhase(page, 'reading');
  assert.match(await page.locator('#nell-message').innerText(), /once/);
  await checkPageFits(page);

  // Existing trace remains usable after the story, including the real reset and medical handoff.
  await page.locator('#memory-workshop > summary').click();
  await page.locator('#trace-example').click();
  await page.locator('#trace-tokens').selectOption('8192');
  assert.equal(await page.locator('#trace-state').innerText(), 'Estimated budget exceeded');
  await page.locator('#trace-sequences').selectOption('2');
  assert.match(await page.locator('#trace-cache-math').textContent(), /2 GiB/);
  await page.locator('#trace-reset').click();
  assert.match(await page.locator('#trace-changes').innerText(), /No inputs changed/);
  assert.ok(await page.getByRole('link', { name:/Inspect the separate medical AI research/ }).isVisible());
  assert.deepEqual(errors, []);
  await context.close();
}

(async () => {
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  const base = 'http://127.0.0.1:' + server.address().port;
  let browser;
  try {
    browser = await chromium.launch({ channel:'chrome' });
    await play(browser, base, false);
    await play(browser, base, true);
    const staticPage = await browser.newPage({ javaScriptEnabled:false, viewport:{width:320,height:640} });
    await staticPage.goto(base + '/preview.html');
    await staticPage.locator('.paper-crossing summary').click();
    assert.match(await staticPage.locator('.paper-crossing details p').innerText(), /glasshouse/);
    assert.equal(await staticPage.locator('#open-letter').isVisible(), false);
    await staticPage.close();
    console.log('Passed desktop, phone, reduced-motion, keyboard, touch, static story, both routes, replay and workshop checks.');
  } finally {
    if (browser) await browser.close();
    server.closeAllConnections();
    await new Promise(resolve => server.close(resolve));
    if (output !== temp) fs.rmSync(temp, { recursive:true, force:true });
  }
})().catch(error => { console.error(error); process.exitCode=1; });
