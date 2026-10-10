const { chromium } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const PAGE = (skin) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px"><textarea id=t rows=3></textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
window.ed = KConditionsEditor.attach('#t', {
  fields:[{name:'name',label:'Name',type:'text'},{name:'state',label:'State',type:'enum',choices:{CA:'California',LA:'Louisiana'}}],
  skin:'${skin}', startOpen:true, collapsible:false, historyIdle: 200
});
</script>`;
(async()=>{
await new Promise(r=>server.listen(8097,r));
const b=await chromium.launch(); const errs=[];
async function page(skin){
  SCRATCH('12.html', PAGE(skin));
  const p=await b.newPage({viewport:{width:900,height:800}});
  p.on('pageerror',e=>errs.push(skin+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(skin+': '+m.text());});
  await p.goto('http://localhost:8097/tests/browser/.scratch/12.html'); await p.waitForSelector('.kce');
  return p;
}
const say = p => p.evaluate(()=>window.ed.describe());
async function reveal(p){ await p.mouse.move(5,5); await p.locator('.kce-condition').last().locator('.kce-sel-field').hover(); }
async function press(p,sel){ await reveal(p); await p.locator(sel).last().click(); await p.waitForTimeout(140); }
async function setRow(p,n,field,val){
  const r=p.locator('.kce-condition').nth(n);
  await r.locator('select.kce-field').selectOption(field); await p.waitForTimeout(120);
  const inp=r.locator('.kce-input').first();
  if(await inp.count()) await inp.fill(val); else await r.locator('select.kce-literal').selectOption(val);
  await p.waitForTimeout(260);
}

// ---- undo ----
let p = await page('prose');
await p.locator('.kce-adds-starter .kce-add').click(); await p.waitForTimeout(120);
await setRow(p,0,'name','Ben');
await press(p,'.kce-add-and:not(.kce-add-wrap)');
await setRow(p,1,'state','CA');
console.log('built      :', await say(p));
const hist = () => p.evaluate(()=>({at:window.ed.history.at, len:window.ed.history.stack.length, undo:window.ed.canUndo(), redo:window.ed.canRedo()}));
console.log('history    :', await hist());
await p.evaluate(()=>window.ed.undo()); await p.waitForTimeout(120);
console.log('undo 1     :', await say(p));
await p.evaluate(()=>window.ed.undo()); await p.waitForTimeout(120);
console.log('undo 2     :', await say(p));
await p.evaluate(()=>window.ed.redo()); await p.waitForTimeout(120);
console.log('redo 1     :', await say(p));

// typing coalescing: type 5 chars fast -> one entry
await p.evaluate(()=>{ window.ed.clear(); });
await p.waitForTimeout(50);
await p.locator('.kce-adds-starter .kce-add').click(); await p.waitForTimeout(120);
const before = (await hist()).len;
const inp = p.locator('.kce-condition').first().locator('.kce-input').first();
await inp.click();
await inp.type('Nanci', {delay: 30});
await p.waitForTimeout(400);
const after = (await hist()).len;
console.log('typing     : 5 chars added', after-before, 'history entries (want 1)');
await p.evaluate(()=>window.ed.undo()); await p.waitForTimeout(120);
console.log('undo typing:', await say(p));

// focus survives an operator change
await p.evaluate(()=>window.ed.redo()); await p.waitForTimeout(120);
await p.locator('.kce-condition').first().locator('select.kce-operator').selectOption('contains');
await p.waitForTimeout(160);
console.log('focus after op change:', await p.evaluate(()=>document.activeElement && document.activeElement.getAttribute('data-fk')));
await p.close();

console.log('ERRORS:', errs.length?errs:'none');
await b.close(); server.close(); SCRATCH.remove('12.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
