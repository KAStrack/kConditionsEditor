const { chromium } = require('playwright');
const { shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
(async()=>{await new Promise(r=>server.listen(8099,r));
const b=await chromium.launch();const errs=[];
const p=await b.newPage({viewport:{width:1000,height:900},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:8099/docs/index.html');await p.waitForSelector('.kce-line');
const ed = p.locator('.kce').first();

console.log('clear visible with a rule:', await ed.locator('.kce-clear-start').isVisible());
await ed.locator('.kce-clear-start').click();
await p.waitForTimeout(150);
console.log('prompt shown:', await ed.locator('.kce-clear-prompt').isVisible(),
            '| question:', (await ed.locator('.kce-clear-question').textContent()));
await ed.locator('.kce-footer').scrollIntoViewIfNeeded();
await p.waitForTimeout(150);
await ed.locator('.kce-footer').screenshot({path:SHOT('clear-confirm.png')});

// cancel restores, rule intact
await ed.locator('.kce-clear-cancel').click();
await p.waitForTimeout(150);
console.log('after cancel, still asking:', await ed.locator('.kce-clear-prompt').isVisible(),
            '| conditions kept:', await ed.locator('.kce-condition').count());

// escape also backs out
await ed.locator('.kce-clear-start').click();
await p.waitForTimeout(120);
await p.keyboard.press('Escape');
await p.waitForTimeout(150);
console.log('escape cancels:', !(await ed.locator('.kce-clear-prompt').isVisible()));

// clicking elsewhere backs out
await ed.locator('.kce-clear-start').click();
await p.waitForTimeout(120);
await p.locator('h1').click();
await p.waitForTimeout(150);
console.log('outside click cancels:', !(await ed.locator('.kce-clear-prompt').isVisible()));

// confirm actually clears
await ed.locator('.kce-clear-start').click();
await p.waitForTimeout(120);
await ed.locator('.kce-clear-yes').click();
await p.waitForTimeout(250);
console.log('after clear -> conditions:', await ed.locator('.kce-condition').count(),
            '| summary:', (await p.evaluate(() => document.querySelector('.kce-summary-text').textContent)));
console.log('clear control hidden when empty:', !(await ed.locator('.kce-clear-start').isVisible()));
console.log('textarea:', (await p.locator('#conditions').inputValue()).replace(/\s+/g,' ').slice(0,80));
console.log('starter still offered:', await ed.locator('.kce-adds-starter .kce-add').isVisible());
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close();})().catch(e=>{console.error(e);process.exit(1);});
