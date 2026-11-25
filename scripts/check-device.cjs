const assert = require('node:assert/strict');
const fs = require('node:fs');
const http = require('node:http');
const path = require('node:path');
const { chromium } = require('playwright-core');
const html = fs.readFileSync(process.argv[2]);
const out = process.argv[3];
const server = http.createServer((req,res)=>{res.writeHead(200,{'Content-Type':'text/html; charset=utf-8'}); res.end(html);});
(async()=>{
  await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));
  const browser=await chromium.launch({channel:'chrome'});
  try {
    const url='http://127.0.0.1:'+server.address().port+'/';
    const page=await browser.newPage({viewport:{width:390,height:844}});
    const heavy=[];
    page.context().on('request',r=>{if (/huggingface\.co|jsdelivr\.net/.test(r.url())) heavy.push(r.url());});
    await page.goto(url);
    await page.locator('a[href="#first-token"]').first().click();
    await page.locator('#ft-play').waitFor();
    assert.equal(await page.locator('.ft-lane').count(),2);
    assert.equal(await page.locator('#ft-factor').innerText(),'11.5×');
    assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
    assert.deepEqual(heavy,[]);
    await page.locator('#first-token').screenshot({path:path.join(out,'device-phone.png')});
    await page.setViewportSize({width:1280,height:840});
    await page.locator('#first-token').screenshot({path:path.join(out,'device-desktop.png')});
    page.on('console',m=>{if(m.type()==='error') console.log(m.text().slice(0,500));});
    page.on('worker',w=>w.on('console',m=>console.log(m.text().slice(0,200))));
    await page.locator('#run').click();
    await page.waitForFunction(()=>document.querySelector('#status').textContent.includes('Measured on this device') || document.querySelector('#status').textContent.includes('could not finish'),null,{timeout:210000});
    assert.match(await page.locator('#status').innerText(),/Measured on this device/);
    assert.ok(await page.locator('#live-raw').isVisible());
    const report=await page.locator('#live-raw').evaluate(async a=>(await fetch(a.href)).json());
    assert.deepEqual(report.runs.map(r=>r.phase),['first','warm','warm','warm']);
    for(const run of report.runs) {
      assert.ok(run.firstToken.length); assert.equal(run.outputIds.length,run.timestampsMs.length); assert.ok(run.text.length);
      assert.ok(run.timestampsMs[0]>0 && run.timestampsMs.every((v,i,a)=>!i || v>=a[i-1]));
    }
    fs.writeFileSync(path.join(out,'verified-device-run.json'),JSON.stringify(report,null,2));
    console.log('Live ONNX browser generation verified. Output: '+report.runs[0].text);
    const unavailable=await browser.newPage();
    await unavailable.addInitScript(()=>{window.Worker=undefined;});
    await unavailable.goto(url);
    await unavailable.locator('#ft-play').waitFor();
    assert.equal(await unavailable.locator('#run').isVisible(),false);
    assert.equal(await unavailable.locator('.ft-answer').count(),2);
    await unavailable.locator('#ft-first').click();
    assert.equal(await unavailable.locator('.ft-answer').first().innerText(),'The');
  } finally {await browser.close();server.closeAllConnections();server.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
