const { chromium, devices } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const DOC = {version:'1.0', root:{type:'group',operator:'and',negate:false,children:[
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'A'}]},
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'B'}]},
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'C'}]}]}};
const PAGE = `<!doctype html><meta charset=utf-8><meta name=viewport content="width=device-width,initial-scale=1">
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:12px"><textarea id=t rows=3>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
window.ed = KConditionsEditor.attach('#t', { fields:[{name:'name',label:'Name',type:'text'}], startOpen:true, collapsible:false });
</script>`;
(async()=>{
await new Promise(r=>server.listen(8092,r));
SCRATCH('16.html', PAGE);
const b=await chromium.launch(); const errs=[];
const ctx = await b.newContext({ ...devices['Pixel 5'] });
const p = await ctx.newPage();
p.on('pageerror',e=>errs.push(e.message));
p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:8092/tests/browser/.scratch/16.html'); await p.waitForSelector('.kce');
const order = () => p.evaluate(()=>window.ed.getDocument().root.children.map(c=>c.values[0].value).join(''));
console.log('touch device, hasTouch:', await p.evaluate(()=>'ontouchstart' in window));
console.log('start :', await order());

// Grips are opacity 0 at rest but still hit-testable; drive real touch pointers.
const g = await p.locator('.kce-grip').nth(2).boundingBox();
const dst = await p.locator('.kce-condition').first().boundingBox();
await p.evaluate(async ([g, dst]) => {
  const el = document.elementFromPoint(g.x + g.width/2, g.y + g.height/2);
  const opts = (x, y) => ({ pointerId: 1, pointerType: 'touch', isPrimary: true,
    clientX: x, clientY: y, bubbles: true, cancelable: true });
  const cx = g.x + g.width/2, cy = g.y + g.height/2;
  el.dispatchEvent(new PointerEvent('pointerdown', opts(cx, cy)));
  el.dispatchEvent(new PointerEvent('pointermove', opts(cx, cy - 12)));
  el.dispatchEvent(new PointerEvent('pointermove', opts(cx, dst.y + 1)));
  await new Promise(r => setTimeout(r, 30));
  el.dispatchEvent(new PointerEvent('pointerup', opts(cx, dst.y + 1)));
}, [g, dst]);
await p.waitForTimeout(200);
console.log('after touch drag:', await order(), '(want CAB)');
console.log('touch-action on grip:', await p.evaluate(()=>getComputedStyle(document.querySelector('.kce-grip')).touchAction));
console.log('ERRORS:', errs.length?errs:'none');
await b.close(); server.close(); SCRATCH.remove('16.html');
})().catch(e=>{console.error('FAILED',e.message);process.exit(1);});
