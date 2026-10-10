const { chromium } = require('playwright');
const { shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px">
<textarea id=t rows=3></textarea>
<script src=src/k-conditions-evaluator.js></script>
<script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script>
<script>
window.ed = KConditionsEditor.attach('#t', {
  fields: [
    { name:'state', label:'State', type:'enum', choices:{CA:'California',TX:'Texas'} },
    { name:'name',  label:'Name',  type:'text' }
  ],
  startOpen: true, collapsible: false
});
</script>`;
(async()=>{
await new Promise(r=>server.listen(8099,r));
fs.writeFileSync(path.join(ROOT,'_adds.html'), PAGE);
const b=await chromium.launch();
const errs=[]; const p=await b.newPage({viewport:{width:900,height:700},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
await p.goto('http://localhost:8099/_adds.html');
await p.waitForSelector('.kce-line');

const summary = () => p.evaluate(() => window.ed.describe());
const shape   = () => p.evaluate(() => JSON.stringify(window.ed.getDocument().root));

// empty -> starter
console.log('start:', await summary());
await p.locator('.kce-add').first().click();
await p.waitForTimeout(120);
// row 1: State = CA
let r1 = p.locator('.kce-condition').first();
await r1.locator('select.kce-field').selectOption('state');
await p.waitForTimeout(120);
console.log('after first:', await summary());

// +AND -> second condition in same group
// The buttons are zero-width until their line is hovered, so approach the way
// a pointer does: onto the line first, then to the button.
await p.mouse.move(5, 5);
await p.locator('.kce-condition').last().locator('.kce-sel-field').hover();
await p.locator('.kce-add-and:not(.kce-add-wrap)').last().click();
await p.waitForTimeout(120);
let r2 = p.locator('.kce-condition').nth(1);
await r2.locator('select.kce-field').selectOption('name');
await r2.locator('.kce-input').first().fill('Ben');
await p.waitForTimeout(150);
console.log('after +AND:', await summary());

// +OR on the last row -> wraps it into an OR group
await p.mouse.move(5, 5);
await p.locator('.kce-condition').last().locator('.kce-sel-field').hover();
await p.locator('.kce-add-or:not(.kce-add-wrap)').last().click();
await p.waitForTimeout(150);
let r3 = p.locator('.kce-condition').nth(2);
await r3.locator('select.kce-field').selectOption('name');
await r3.locator('.kce-input').first().fill('Nanci');
await p.waitForTimeout(150);
console.log('after +OR:', await summary());
console.log('nested group created:', (await shape()).includes('"operator":"or"'));

// mid-list +AND count vs last-row buttons
console.log('add buttons per position:', await p.evaluate(() =>
  Array.from(document.querySelectorAll('.kce-adds')).map(a => Array.from(a.children).map(b=>b.textContent).join('')) ));

// value preserved across an operator change
await r3.locator('select.kce-operator').selectOption('contains');
await p.waitForTimeout(150);
console.log('after eq->contains:', await summary());

await p.screenshot({path:SHOT('adds.png'), clip:{x:0,y:0,width:900,height:340}});
console.log('ERRORS:', errs.length ? errs : 'none');
await b.close(); server.close();
fs.unlinkSync(path.join(ROOT,'_adds.html'));
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
