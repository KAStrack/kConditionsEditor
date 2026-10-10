const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const { scratch: SCRATCH } = require('./harness.js');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u)]||'text/plain'});s.end(d);});});
const DOC={version:'1.0',root:{type:'group',operator:'and',negate:false,children:[
 {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Alpha'}]},
 {type:'group',operator:'or',negate:false,children:[
   {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'One'}]},
   {type:'condition',field:'name',operator:'eq',values:[{source:'literal',value:'Two'}]}]}]}};
const PAGE=(skin)=>`<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:20px;max-width:820px"><textarea id=t>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-editor.js></script>
<script>window.ed=KConditionsEditor.attach("#t",{fields:[{name:"name",label:"Name",type:"text"}],skin:"${skin}",previewStyle:"highlight",startOpen:true,collapsible:false});</script>`;

// The point of this test: assert the PAINTED colour, not that a class is set.
// 0.0.12 shipped with the class applied and the fill overridden by the row's
// own :hover, which a class-presence check cannot see.
function rgb(s){const m=/rgba?\(([^)]+)\)/.exec(s);if(!m)return null;const p=m[1].split(',').map(Number);return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
function reddish(c,onDark){ if(!c||c.a===0) return false; return onDark ? (c.r>c.g+8 && c.r>c.b+8) : (c.r>c.g+6 && c.r>c.b+6); }

(async()=>{
await new Promise(r=>server.listen(8081,r));
const b=await chromium.launch();const errs=[];let bad=0;
for (const skin of ['prose','boxed','equation','blackboard','ledger']) {
  SCRATCH('19.html', PAGE(skin));
  for (const scheme of ['light','dark']) {
    const ctx=await b.newContext({colorScheme:scheme,viewport:{width:820,height:520}});
    const p=await ctx.newPage();
    p.on('pageerror',e=>errs.push(skin+'/'+scheme+': '+e.message));
    p.on('console',m=>{if(m.type()==='error')errs.push(skin+'/'+scheme+': '+m.text());});
    await p.goto('http://localhost:8081/tests/browser/.scratch/19.html');await p.waitForSelector('.kce');
    const onDark = scheme==='dark' || skin==='blackboard';

    // hover the × of a single condition — the reported case
    const rm=p.locator('[data-fk="r.0:rm"]');
    await rm.hover(); await p.waitForTimeout(180);
    const bb=await rm.boundingBox();               // re-measure: hovering widens the row
    await p.mouse.move(bb.x+bb.width/2, bb.y+bb.height/2); await p.waitForTimeout(200);
    const got = await p.evaluate(()=>{
      const el=document.querySelector('.kce-condition.kce-will-remove');
      if(!el) return {none:true};
      const cs=getComputedStyle(el);
      return {bg:cs.backgroundColor, shadow:cs.boxShadow!=='none'};
    });
    const ok = !got.none && reddish(rgb(got.bg), onDark) && got.shadow;
    if(!ok) bad++;
    console.log((ok?'ok  ':'FAIL'), (skin+'/'+scheme).padEnd(20), 'row ×  bg='+(got.bg||'-'), 'border='+(got.shadow?'yes':'NO'));

    // and the group × still fills its rows
    const grm=p.locator('[data-fk="r.1:rm"]');
    await grm.hover(); await p.waitForTimeout(180);
    const gb=await grm.boundingBox();
    await p.mouse.move(gb.x+gb.width/2, gb.y+gb.height/2); await p.waitForTimeout(200);
    const g = await p.evaluate(()=>{
      const els=document.querySelectorAll('.kce-will-remove');
      const filled=Array.from(els).filter(e=>{
        const c=getComputedStyle(e).backgroundColor;const m=/rgba?\(([^)]+)\)/.exec(c);
        if(!m)return false;const q=m[1].split(',').map(Number);
        return (q[3]===undefined||q[3]>0) && q[0]>q[1]+6 && q[0]>q[2]+6;});
      return {total:els.length, filled:filled.length};
    });
    const gok = g.filled >= 1;
    if(!gok) bad++;
    console.log((gok?'ok  ':'FAIL'), (skin+'/'+scheme).padEnd(20), 'grp ×  '+g.filled+'/'+g.total+' tinted elements filled');
    await ctx.close();
  }
}
console.log('\nfailures:', bad);
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close();SCRATCH.remove('19.html');
if(bad) process.exit(1);
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
