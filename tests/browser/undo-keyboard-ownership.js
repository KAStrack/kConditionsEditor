const { chromium } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const DOC = {version:'1.0', root:{type:'group',operator:'and',negate:false,children:[
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'A'}]},
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'B'}]}]}};
const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px">
<p id=outside tabindex=0>Something else on the page</p>
<textarea id=t rows=3>${JSON.stringify(DOC)}</textarea>
<textarea id=t2 rows=3>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
var f=[{name:'name',label:'Name',type:'text'}];
window.ed = KConditionsEditor.attach('#t', {fields:f, startOpen:true, collapsible:false});
window.ed2 = KConditionsEditor.attach('#t2', {fields:f, startOpen:true, collapsible:false});
</script>`;
(async()=>{
await new Promise(r=>server.listen(8089,r));
SCRATCH('17.html', PAGE);
const b=await chromium.launch(); const errs=[];
const p=await b.newPage({viewport:{width:900,height:900}});
p.on('pageerror',e=>errs.push(e.message)); p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:8089/tests/browser/.scratch/17.html'); await p.waitForSelector('.kce');
const ed1 = p.locator('.kce').first(), ed2 = p.locator('.kce').nth(1);
const say  = () => p.evaluate(()=>window.ed.describe());
const say2 = () => p.evaluate(()=>window.ed2.describe());

// THE REPORTED CASE: click +AND (which rebuilds the tree), then press Ctrl+Z.
await ed1.locator('.kce-condition').last().locator('.kce-sel-field').hover();
await ed1.locator('.kce-add-and:not(.kce-add-wrap)').last().click();
await p.waitForTimeout(160);
console.log('after +AND      :', await say());
console.log('focus kept      :', await p.evaluate(()=>document.activeElement.getAttribute('data-fk')));
await p.keyboard.press('Control+z'); await p.waitForTimeout(160);
console.log('ctrl+z          :', await say(), '<- should have dropped the new row');
await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(160);
console.log('ctrl+shift+z    :', await say());

// Focus deliberately blown away, editor still the last thing clicked in
await p.evaluate(()=>document.activeElement.blur());
console.log('activeElement   :', await p.evaluate(()=>document.activeElement.tagName));
await p.keyboard.press('Control+z'); await p.waitForTimeout(160);
console.log('ctrl+z w/o focus:', await say(), '<- still ours');

// A second editor on the page must not react to the first one's keystrokes
await ed2.locator('.kce-condition').last().locator('.kce-sel-field').hover();
await ed2.locator('.kce-add-and:not(.kce-add-wrap)').last().click();
await p.waitForTimeout(160);
const snap1 = await say();
await p.keyboard.press('Control+z'); await p.waitForTimeout(160);
console.log('ed2 undo        :', await say2());
console.log('ed1 untouched   :', (await say()) === snap1);

// Clicking outside every editor hands Ctrl+Z back to the page
await p.locator('#outside').click();
const before1 = await say(), before2 = await say2();
await p.keyboard.press('Control+z'); await p.waitForTimeout(160);
console.log('outside: both untouched:', (await say())===before1 && (await say2())===before2);

// Cmd+Z (metaKey) works too
await ed1.locator('.kce-condition').first().locator('select.kce-field').click();
await p.keyboard.press('Meta+z'); await p.waitForTimeout(160);
console.log('meta+z          :', await say());
console.log('ERRORS:', errs.length?errs:'none');
await b.close(); server.close(); SCRATCH.remove('17.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
