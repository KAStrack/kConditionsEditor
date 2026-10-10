const { chromium } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const DOC = {version:'1.0', root:{type:'group',operator:'and',negate:false,children:[
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'A'}]},
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'B'}]},
  {type:'group',operator:'or',negate:false,children:[
    {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'C1'}]},
    {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'C2'}]}]},
  {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'D'}]}]}};
const PAGE = (skin) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px"><textarea id=t rows=3>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
window.ed = KConditionsEditor.attach('#t', { fields:[{name:'name',label:'Name',type:'text'}],
  skin:'${skin}', startOpen:true, collapsible:false });
</script>`;
(async()=>{
await new Promise(r=>server.listen(8096,r));
const b=await chromium.launch(); const errs=[];
async function page(skin){
  SCRATCH('13.html', PAGE(skin));
  const p=await b.newPage({viewport:{width:900,height:800}});
  p.on('pageerror',e=>errs.push(skin+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(skin+': '+m.text());});
  await p.goto('http://localhost:8096/tests/browser/.scratch/13.html'); await p.waitForSelector('.kce');
  return p;
}
const order = p => p.evaluate(()=>window.ed.getDocument().root.children.map(
  c => c.type==='group' ? '('+c.children.map(x=>x.values[0].value).join('/')+')' : c.values[0].value).join(' '));

for (const skin of ['prose','boxed']) {
  const p = await page(skin);
  console.log('\n== '+skin);
  console.log('start        :', await order(p));

  // move-down button on the first row
  await p.locator('.kce-condition').first().hover();
  await p.locator('[data-fk="r.0:move-down"]').click(); await p.waitForTimeout(140);
  console.log('A down       :', await order(p));

  // ends are disabled
  console.log('first up dis :', await p.locator('[data-fk="r.0:move-up"]').isDisabled(),
              '| last down dis:', await p.locator('[data-fk="r.3:move-down"]').isDisabled());

  // move the group up with its own control
  const gk = '[data-fk="r.2:move-up"]';
  await p.locator(gk).scrollIntoViewIfNeeded();
  await p.locator(gk).evaluate(el => el.click()); await p.waitForTimeout(140);
  console.log('group up     :', await order(p));

  // Alt+ArrowDown from inside a row
  await p.locator('.kce-condition').first().locator('select.kce-field').focus();
  await p.keyboard.press('Alt+ArrowDown'); await p.waitForTimeout(140);
  console.log('alt-down     :', await order(p));
  console.log('focus follows:', await p.evaluate(()=>document.activeElement.getAttribute('data-fk')));

  // drag the last top-level row to the top with pointer events
  const grips = p.locator('.kce-tree .kce-grip');
  const n = await grips.count();
  const src = grips.nth(n-1);
  const sb = await src.boundingBox();
  const firstRow = await p.locator('.kce-condition').first().boundingBox();
  await p.mouse.move(sb.x+5, sb.y+5);
  await p.mouse.down();
  await p.mouse.move(sb.x+5, sb.y-10, {steps:3});
  await p.mouse.move(firstRow.x+5, firstRow.y-4, {steps:8});
  const ind = await p.locator('.kce-drop-indicator').count();
  await p.mouse.up(); await p.waitForTimeout(160);
  console.log('drag (ind='+ind+') :', await order(p));

  // undo the drag
  await p.evaluate(()=>window.ed.undo()); await p.waitForTimeout(140);
  console.log('undo drag    :', await order(p));
  await p.close();
}
console.log('\nERRORS:', errs.length?errs:'none');
await b.close(); server.close(); SCRATCH.remove('13.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
