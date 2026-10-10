const { chromium } = require('playwright');
const { scratch: SCRATCH, shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u)]||'text/plain'});s.end(d);});});
const DOC={version:'1.0',root:{type:'group',operator:'and',negate:false,children:[
 {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Alpha'}]},
 {type:'group',operator:'or',negate:true,children:[
   {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'One'}]},
   {type:'group',operator:'and',negate:false,children:[
     {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Deep1'}]},
     {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Deep2'}]}]}]},
 {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Omega'}]}]}};
const PAGE=(skin)=>`<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:820px"><textarea id=t>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-editor.js></script>
<script>window.ed=KConditionsEditor.attach('#t',{fields:[{name:'name',label:'Name',type:'text'}],skin:'${skin}',previewStyle:'highlight',startOpen:true,collapsible:false});</script>`;
(async()=>{
await new Promise(r=>server.listen(8087,r));
const b=await chromium.launch();const errs=[];
// what the highlight covers, described by the visible text of the tinted elements
const lit = p => p.evaluate(()=>Array.from(document.querySelectorAll('.kce-will-remove')).map(e=>{
  if (e.classList.contains('kce-paren')||e.classList.contains('kce-negate-marker')) return e.textContent;
  if (e.classList.contains('kce-condition')) return (e.querySelector('.kce-input')||{}).value || '?';
  if (e.classList.contains('kce-group')) return 'GROUP['+Array.from(e.querySelectorAll('.kce-input')).map(i=>i.value).join(',')+']';
  if (e.classList.contains('kce-group-tools')) return 'tools';
  return e.className;
}));
for (const skin of ['prose','boxed']) {
  SCRATCH('18.html', PAGE(skin));
  const p=await b.newPage({viewport:{width:820,height:700},deviceScaleFactor:2});
  p.on('pageerror',e=>errs.push(skin+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(skin+': '+m.text());});
  await p.goto('http://localhost:8087/tests/browser/.scratch/18.html');await p.waitForSelector('.kce');
  console.log('\n== '+skin);
  console.log('at rest              :', JSON.stringify(await lit(p)));

  // a plain condition's ×
  const row0 = p.locator('.kce-condition').first();
  await row0.hover(); await row0.locator('.kce-remove').hover(); await p.waitForTimeout(160);
  console.log('hover × on Alpha     :', JSON.stringify(await lit(p)));
  if (skin==='prose') await p.locator('.kce').screenshot({path:SHOT('remove-row.png')});

  // the nested group's × (should take Deep1 + Deep2 + its brackets)
  const gtools = p.locator('[data-node="r.1.1"] .kce-remove, [data-node="r.1.1"].kce-group .kce-remove').first();
  await gtools.evaluate(el=>el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false})));
  await p.waitForTimeout(160);
  console.log('hover × on inner grp :', JSON.stringify(await lit(p)));

  // the outer NOT group's × (should take everything below it)
  await p.evaluate(()=>document.querySelectorAll('.kce-will-remove').forEach(e=>e.classList.remove('kce-will-remove')));
  const outer = p.locator('[data-node="r.1"] .kce-remove').first();
  await outer.evaluate(el=>el.dispatchEvent(new MouseEvent('mouseenter',{bubbles:false})));
  await p.waitForTimeout(160);
  console.log('hover × on NOT group :', JSON.stringify(await lit(p)));
  if (skin==='prose') await p.locator('.kce').screenshot({path:SHOT('remove-group.png')});

  // leaving clears it
  await outer.evaluate(el=>el.dispatchEvent(new MouseEvent('mouseleave',{bubbles:false})));
  await p.waitForTimeout(120);
  console.log('after mouseleave     :', JSON.stringify(await lit(p)));

  // keyboard focus previews too
  await p.locator('[data-fk="r.1:rm"]').evaluate(el=>el.focus()); await p.waitForTimeout(140);
  console.log('on focus             :', (await lit(p)).length, 'elements tinted');
  await p.locator('[data-fk="r.1:rm"]').evaluate(el=>el.blur()); await p.waitForTimeout(120);
  console.log('on blur              :', (await lit(p)).length, 'elements tinted');

  // r.1 must not catch r.10-style siblings — check the prefix test directly
  console.log('prefix test r.1 vs r.10:', await p.evaluate(()=>{
    const id='r.1'; return ['r.1','r.1.0','r.10','r.10.2','r.2'].map(o=>o===id||o.indexOf(id+'.')===0).join(',');
  }), '(want true,true,false,false,false)');
  await p.close();
}
console.log('\nERRORS:', errs.length?errs:'none');
await b.close();server.close();SCRATCH.remove('18.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
