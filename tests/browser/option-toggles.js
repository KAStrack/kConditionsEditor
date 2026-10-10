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
const PAGE = (opts) => `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px"><textarea id=t rows=3>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script><script>
window.ed = KConditionsEditor.attach('#t', Object.assign(
  { fields:[{name:'name',label:'Name',type:'text'}], startOpen:true, collapsible:false }, ${opts}));
</script>`;
(async()=>{
await new Promise(r=>server.listen(8093,r));
const b=await chromium.launch(); const errs=[];
async function probe(label, opts){
  SCRATCH('15.html', PAGE(opts));
  const p=await b.newPage({viewport:{width:900,height:600}});
  p.on('pageerror',e=>errs.push(label+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(label+': '+m.text());});
  await p.goto('http://localhost:8093/tests/browser/.scratch/15.html'); await p.waitForSelector('.kce');
  const out = await p.evaluate(()=>({
    undoBtn: document.querySelectorAll('.kce-undo').length,
    grips: document.querySelectorAll('.kce-grip').length,
    moves: document.querySelectorAll('.kce-move').length,
    history: !!window.ed.history,
    canUndoFn: typeof window.ed.undo === 'function'
  }));
  // a mutation still works with history off
  await p.evaluate(()=>window.ed.moveChild(window.ed.doc.root, 0, 1));
  await p.waitForTimeout(120);
  out.afterMove = await p.evaluate(()=>window.ed.getDocument().root.children.map(c=>c.values[0].value).join(''));
  console.log(label.padEnd(22), JSON.stringify(out));
  await p.close();
}
await probe('defaults', '{}');
await probe('history:false', '{history:false}');
await probe('allowDrag:false', '{allowDrag:false}');
await probe('allowReorder:false', '{allowReorder:false}');
await probe('readOnly', '{readOnly:true}');
console.log('ERRORS:', errs.length?errs:'none');
await b.close(); server.close(); SCRATCH.remove('15.html');
})().catch(e=>{console.error('FAILED',e.message);process.exit(1);});
