const { chromium } = require('playwright');
const { shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
(async()=>{
await new Promise(r=>server.listen(8099,r));
const b=await chromium.launch();
const errs=[]; const p=await b.newPage({viewport:{width:1100,height:1000},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});

await p.goto('http://localhost:8099/docs/index.html');
await p.waitForSelector('.kce-line');

// choice labels should show, not raw codes
const summary = await p.locator('.kce-summary-text').textContent().catch(()=>null);
console.log('rows mention Gulf state:', (await p.locator('.kce-condition').allTextContents()).some(t=>t.includes('Gulf')));

// debug: view source
await p.locator('.kce-devtools-toggle').click();
await p.waitForTimeout(200);
console.log('source panel visible:', !(await p.locator('.kce-devtools').isHidden()));
console.log('doc tab starts with:', (await p.locator('.kce-devtools-body').textContent()).slice(0,40).replace(/\n/g,' '));
await p.locator('.kce-devtools-tab', { hasText: 'SQL' }).click();
await p.waitForTimeout(150);
const sqlText = await p.locator('.kce-devtools-body').textContent();
console.log('SQL tab:'); console.log(sqlText.split('\n').slice(0,4).join('\n'));
await p.locator('.kce-devtools-tab', { hasText: 'Summary' }).click();
await p.waitForTimeout(150);
console.log('summary tab:', (await p.locator('.kce-devtools-body').textContent()).slice(0,120));
await p.screenshot({path:SHOT('debug-panel.png'), clip:{x:0,y:250,width:1100,height:700}});

// playground: switch output to SQL
await p.goto('http://localhost:8099/docs/demo.html');
await p.waitForSelector('.kce-line');
await p.selectOption('#output','sql');
await p.waitForTimeout(300);
const ta = await p.locator('#conditions').inputValue();
const hidden = await p.locator('#conditions-doc').inputValue();
console.log('textarea now SQL:', ta.slice(0,90));
console.log('hidden field holds JSON:', hidden.trim().startsWith('{'));
await p.selectOption('#dialect','postgres');
await p.waitForTimeout(300);
console.log('after dialect switch:', (await p.locator('#conditions').inputValue()).slice(0,80));
console.log('sql section:', (await p.locator('#sql-output').textContent()).split('\n')[0].slice(0,90));

// choice label in an enum dropdown
await p.goto('http://localhost:8099/docs/demo.html');
await p.waitForSelector('.kce-line');
const stateRow = p.locator('.kce-condition').filter({hasText:'State'}).first();
console.log('state row text:', (await stateRow.textContent()).trim());

console.log('ERRORS:', errs.length ? errs : 'none');
await b.close(); server.close();
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
