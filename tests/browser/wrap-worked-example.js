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
    { name:'name',  label:'Name',  type:'text' },
    { name:'state', label:'State', type:'enum', choices:{CA:'California',LA:'Louisiana'} }
  ],
  startOpen: true, collapsible: false
});
</script>`;
(async()=>{
await new Promise(r=>server.listen(8099,r));
fs.writeFileSync(path.join(ROOT,'_wrap.html'), PAGE);
const b=await chromium.launch();const errs=[];
const p=await b.newPage({viewport:{width:900,height:700},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:8099/_wrap.html');await p.waitForSelector('.kce-line');

const say = () => p.evaluate(() => window.ed.describe());
async function reveal() { await p.mouse.move(5,5); await p.locator('.kce-condition').last().locator('.kce-sel-field').hover(); }
async function press(sel) { await reveal(); await p.locator(sel).last().click(); await p.waitForTimeout(140); }
async function setRow(n, field, val) {
  const r = p.locator('.kce-condition').nth(n);
  await r.locator('select.kce-field').selectOption(field);
  await p.waitForTimeout(120);
  const inp = r.locator('.kce-input').first();
  if (await inp.count()) await inp.fill(val); else await r.locator('select.kce-literal').selectOption(val);
  await p.waitForTimeout(140);
}

// "Name is B"
await p.locator('.kce-adds-starter .kce-add').click(); await p.waitForTimeout(140);
await setRow(0,'name','B');
// OR -> "Name is N"
await press('.kce-add-or:not(.kce-add-wrap)'); await setRow(1,'name','N');
console.log('1. after OR :', await say());

// the wrap button should now offer AND(…)
console.log('2. buttons  :', await p.evaluate(() => { const l = document.querySelectorAll('.kce-adds');
  return Array.from(l).map(a => Array.from(a.children).map(b=>b.textContent).join(' ')); }));

// AND(…) -> closes the OR group and starts a new strand
await press('.kce-add-wrap');
console.log('3. after AND(…):', await say());

// "State is CA", then OR -> "State is LA"
await setRow(2,'state','CA');
await press('.kce-add-or:not(.kce-add-wrap)'); await setRow(3,'state','LA');
console.log('4. final    :', await say());
console.log('   shape    :', await p.evaluate(() => JSON.stringify(window.ed.getDocument().root)));
await p.mouse.move(5,5); await p.waitForTimeout(200);
await p.locator('.kce').screenshot({path:SHOT('wrap-result.png')});
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close(); fs.unlinkSync(path.join(ROOT,'_wrap.html'));
})().catch(e=>{console.error('FAILED',e.message);process.exit(1);});
