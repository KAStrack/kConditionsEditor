const { chromium } = require('playwright');
const { scratch: SCRATCH, shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const DOC = {version:'1.0', root:{type:'group',operator:'and',negate:false,children:[
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Alpha'}]},
  {type:'group',operator:'or',negate:false,children:[
    {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'One'}]},
    {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Two'}]},
    {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Three'}]}]},
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Omega'}]}]}};
const PAGE = (skin) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px"><textarea id=t rows=3>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
window.ed = KConditionsEditor.attach('#t', { fields:[{name:'name',label:'Name',type:'text'}],
  skin:'${skin}', startOpen:true, collapsible:false });
</script>`;
(async()=>{
await new Promise(r=>server.listen(8095,r));
const b=await chromium.launch(); const errs=[];
const inner = p => p.evaluate(()=>window.ed.getDocument().root.children[1].children.map(c=>c.values[0].value).join(' '));
const top = p => p.evaluate(()=>window.ed.getDocument().root.children.map(c=>c.type==='group'?'(...)':c.values[0].value).join(' '));

for (const skin of ['prose','boxed']) {
  SCRATCH('14.html', PAGE(skin));
  const p=await b.newPage({viewport:{width:900,height:800},deviceScaleFactor:2});
  p.on('pageerror',e=>errs.push(skin+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(skin+': '+m.text());});
  await p.goto('http://localhost:8095/tests/browser/.scratch/14.html'); await p.waitForSelector('.kce');
  console.log('\n== '+skin);
  console.log('inner start :', await inner(p), '| top:', await top(p));

  // Drag "Three" (r.1.2) to the top of its own group. Grips are on rows in
  // document order; r.1.2 is the 4th condition row.
  const rows = p.locator('.kce-condition');
  const src = rows.nth(3).locator('.kce-grip');
  const dst = rows.nth(1);
  const sb = await src.boundingBox(); const db = await dst.boundingBox();
  await p.mouse.move(sb.x+5, sb.y+5); await p.mouse.down();
  await p.mouse.move(sb.x+5, sb.y-8, {steps:3});
  await p.mouse.move(db.x+5, db.y+1, {steps:8});
  await p.waitForTimeout(80);
  if (skin === 'prose') await p.screenshot({path:SHOT('drag-inflight.png'), clip:{x:0,y:0,width:640,height:340}});
  await p.mouse.up(); await p.waitForTimeout(160);
  console.log('after drag  :', await inner(p), '| top:', await top(p));

  // Escape mid-drag cancels
  const src2 = p.locator('.kce-condition').nth(3).locator('.kce-grip');
  const b2 = await src2.boundingBox();
  await p.mouse.move(b2.x+5, b2.y+5); await p.mouse.down();
  await p.mouse.move(b2.x+5, b2.y-40, {steps:6});
  await p.keyboard.press('Escape'); await p.mouse.up(); await p.waitForTimeout(140);
  console.log('escape drag :', await inner(p), '(unchanged)');

  // Ctrl+Z from a button, not a text input
  await p.locator('[data-fk="r.1.0:move-down"]').evaluate(el=>el.focus());
  await p.keyboard.press('Control+z'); await p.waitForTimeout(140);
  console.log('ctrl+z      :', await inner(p));
  await p.keyboard.press('Control+Shift+z'); await p.waitForTimeout(140);
  console.log('ctrl+shift+z:', await inner(p));

  // Ctrl+Z inside a text input is left to the browser (document unchanged by us)
  const ta = p.locator('.kce-condition').nth(1).locator('.kce-input').first();
  await ta.click();
  const lenBefore = await p.evaluate(()=>window.ed.history.stack.length);
  await p.keyboard.press('Control+z'); await p.waitForTimeout(140);
  console.log('ctrl+z in field: our stack untouched:', (await p.evaluate(()=>window.ed.history.stack.length)) === lenBefore);
  await p.close();
}
console.log('\nERRORS:', errs.length?errs:'none');
await b.close(); server.close(); SCRATCH.remove('14.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
