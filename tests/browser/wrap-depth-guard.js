const { chromium } = require('playwright');
const { scratch: SCRATCH } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
const PAGE = (skin, maxDepth) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px"><textarea id=t rows=3></textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
window.ed = KConditionsEditor.attach('#t', { fields:[{name:'name',label:'Name',type:'text'}],
  skin:'${skin}', maxDepth:${maxDepth}, startOpen:true, collapsible:false });
</script>`;
(async()=>{
await new Promise(r=>server.listen(8098,r));
const b=await chromium.launch();const errs=[];
async function run(skin, maxDepth, label){
  SCRATCH('11.html', PAGE(skin, maxDepth));
  const p=await b.newPage({viewport:{width:900,height:700}});
  p.on('pageerror',e=>errs.push(label+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(label+': '+m.text());});
  await p.goto('http://localhost:8098/tests/browser/.scratch/11.html');await p.waitForSelector('.kce');
  const reveal=async()=>{await p.mouse.move(5,5);await p.locator('.kce-condition').last().locator('.kce-sel-field').hover();};
  const press=async(s)=>{await reveal();await p.locator(s).last().click({force:true});await p.waitForTimeout(120);};
  await p.locator('.kce-add').first().click({force:true}); await p.waitForTimeout(120);
  await press('.kce-add-or:not(.kce-add-wrap)');
  // now root(or) with 2 -> wrap available (depth0+height1 < maxDepth)
  const seen=[];
  for (let i=0;i<6;i++){
    const n = await p.locator('.kce-add-wrap').count();
    seen.push(n);
    if(!n) break;
    await press('.kce-add-wrap');
    await press('.kce-add-'+(await p.evaluate(()=>window.ed.getDocument().root.operator))+':not(.kce-add-wrap)');
  }
  const doc = await p.evaluate(()=>JSON.stringify(window.ed.getDocument().root));
  let d=0,max=0;(function walk(n,dep){max=Math.max(max,dep);(n.children||[]).forEach(c=>walk(c,dep+1));})(JSON.parse(doc),0);
  console.log(label, '| wrap-btn counts per round:', seen.join(','), '| final node depth:', max, '| maxDepth:', maxDepth);
  await p.close();
}
await run('prose', 3, 'prose maxDepth=3');
await run('boxed', 6, 'boxed maxDepth=6');
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close(); SCRATCH.remove('11.html');
})().catch(e=>{console.error('FAILED',e.message);process.exit(1);});
