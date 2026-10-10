const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const { scratch: SCRATCH, shot: SHOT } = require('./harness.js');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u)]||'text/plain'});s.end(d);});});
const C=(f,v)=>({type:'condition',field:f,operator:'eq',values:[{source:'literal',value:v}]});
// Ben's screenshot: ((Name=B OR Name=N) AND (State=AL OR State=CA OR State=FL)) OR Name=rob
const DOC={version:'1.0',root:{type:'group',operator:'or',negate:false,children:[
 {type:'group',operator:'and',negate:false,children:[
   {type:'group',operator:'or',negate:false,children:[C('name','B'),C('name','N')]},
   {type:'group',operator:'or',negate:false,children:[C('state','AL'),C('state','CA'),C('state','FL')]}]},
 C('name','rob')]}};
const PAGE=(opt)=>`<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px"><textarea id=t>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-editor.js></script><script>
window.ed=KConditionsEditor.attach("#t",{fields:[
 {name:'name',label:'Name',type:'text'},
 {name:'state',label:'State',type:'enum',choices:{AL:'Alabama',CA:'California',FL:'Florida'}}],
 startOpen:true,collapsible:false,connectorPlacement:"inline"${opt}});
</script>`;
// report each group's connector x positions
const cols = p => p.evaluate(()=>{
  const out={};
  document.querySelectorAll('.kce-connector[data-conn-group]').forEach(c=>{
    const k=c.getAttribute('data-conn-group');
    (out[k]=out[k]||[]).push(Math.round(c.getBoundingClientRect().left));
  });
  return out;
});
const spread = o => Object.keys(o).map(k=>k+':['+o[k].join(',')+']'+(new Set(o[k]).size===1?' aligned':' RAGGED by '+(Math.max(...o[k])-Math.min(...o[k]))+'px')).join('\n              ');
(async()=>{
await new Promise(r=>server.listen(8079,r));
const b=await chromium.launch();const errs=[];
for (const [label,opt] of [['off',', alignConnectors:false'],['group',", alignConnectors:'group'"],['on','']]) {
  SCRATCH('20.html', PAGE(opt));
  const p=await b.newPage({viewport:{width:900,height:640},deviceScaleFactor:2});
  p.on('pageerror',e=>errs.push(label+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(label+': '+m.text());});
  await p.goto('http://localhost:8079/tests/browser/.scratch/20.html');await p.waitForSelector('.kce');
  await p.waitForTimeout(200);
  console.log('\nalignConnectors:'+label+'\n              '+spread(await cols(p)));
  await p.mouse.move(5,5); await p.waitForTimeout(150);
  await p.locator('.kce').screenshot({path:SHOT('align-'+label+'.png')});

  if (label==='on') {
    // typing must keep the column true as the input autosizes
    const inp=p.locator('.kce-condition').first().locator('.kce-input').first();
    await inp.click(); await inp.fill('a much longer name'); await p.waitForTimeout(300);
    console.log('after typing  '+spread(await cols(p)));
    // and so must a narrower viewport
    await p.setViewportSize({width:620,height:640}); await p.waitForTimeout(300);
    console.log('after resize  '+spread(await cols(p)));
  }
  await p.close();
}
console.log('\nERRORS:', errs.length?errs:'none');
await b.close();server.close();SCRATCH.remove('20.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
