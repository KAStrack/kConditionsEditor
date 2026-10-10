const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const { scratch: SCRATCH, shot: SHOT } = require('./harness.js');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css'}[path.extname(u)]||'text/plain'});s.end(d);});});
const C=(f,v)=>({type:'condition',field:f,operator:'eq',values:[{source:'literal',value:v}]});
const DOC={version:'1.0',root:{type:'group',operator:'and',negate:false,children:[
  C('name','A'),
  {type:'group',operator:'or',negate:false,children:[C('name','X'),C('name','Y')]},
  C('name','B')]}};
const PAGE=(skin)=>`<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<body style="font-family:system-ui;padding:24px;max-width:900px"><textarea id=t>${JSON.stringify(DOC)}</textarea>
<script src=src/k-conditions-evaluator.js></script><script src=src/k-conditions-editor.js></script>
<script>window.ed=KConditionsEditor.attach("#t",{fields:[{name:'name',label:'Name',type:'text'}],skin:'${skin}',previewStyle:'highlight',startOpen:true,collapsible:false});</script>`;
const state = p => p.evaluate(()=>({
  tinted: Array.from(document.querySelectorAll('.kce-will-group')).map(e=>
    e.classList.contains('kce-condition') ? (e.querySelector('.kce-input')||{}).value
    : e.classList.contains('kce-group') ? 'GROUP'
    : e.classList.contains('kce-paren') ? e.textContent : e.className.split(' ')[0]),
  tintHue: (document.querySelector('.kce-will-group')||{classList:{contains:()=>false}}).classList.contains('is-or')?'or':'and',
  ghostHue: (document.querySelector('.kce-ghost')||{classList:{contains:()=>false}}).classList.contains('is-or')?'or':'and',
  ghosts: document.querySelectorAll('.kce-ghost').length
}));
(async()=>{
await new Promise(r=>server.listen(8075,r));
const b=await chromium.launch();const errs=[];
for (const skin of ['prose','boxed']) {
  SCRATCH('22.html', PAGE(skin));
  const p=await b.newPage({viewport:{width:900,height:700},deviceScaleFactor:2});
  p.on('pageerror',e=>errs.push(skin+': '+e.message));
  p.on('console',m=>{if(m.type()==='error')errs.push(skin+': '+m.text());});
  await p.goto('http://localhost:8075/tests/browser/.scratch/22.html');await p.waitForSelector('.kce');
  console.log('\n== '+skin);

  // The add buttons are max-width:0 until revealed. In flow that means hovering
  // their line; in the tree layout the connector holding them is itself zero
  // wide until then, so the thing to hover is the row above it.
  async function aim(fk, label){
    const el=p.locator('[data-fk="'+fk+'"]');
    if(!await el.count()){ console.log('   '+label.padEnd(30),'(no such button)'); return; }
    await p.mouse.move(5,5); await p.waitForTimeout(120);
    const row = await el.evaluate(e=>{
      let h=e.closest('.kce-line');
      if(!h){ const conn=e.closest('.kce-connector'); h=(conn&&conn.previousElementSibling)||conn||e.parentElement; }
      const r=h.getBoundingClientRect(); return {x:r.x,y:r.y,w:r.width,h:r.height};
    });
    await p.mouse.move(row.x+8, row.y+row.h/2); await p.waitForTimeout(200);
    const bb=await el.boundingBox();                   // re-measure: hover widens the row
    await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(220);
    const st=await state(p);
    console.log('   '+label.padEnd(30), JSON.stringify(st));
    // the button must not move while previewing, or the hover would flicker
    const bb2=await el.boundingBox();
    if (Math.abs(bb2.y-bb.y)>0.5) console.log('   !! button moved by', (bb2.y-bb.y).toFixed(1)+'px');
    return st;
  }
  await aim('r:add-and-0','+AND mid-list (insert)');
  await aim('r:add-or-2','+OR on last row (wrap)');
  await aim('r:add-and-2','+AND on last row (insert)');
  await aim('r:wrap-or','OR(…) (bracket everything)');
  if (skin==='prose') {
    await aim('r:add-or-2','(shot)');
    await p.locator('.kce').screenshot({path:SHOT('preview-or.png')});
    await aim('r:wrap-or','(shot)');
    await p.locator('.kce').screenshot({path:SHOT('preview-wrapall.png')});
  }
  // leaving clears everything
  await p.mouse.move(5,5); await p.waitForTimeout(200);
  console.log('   after leaving              ', JSON.stringify(await state(p)));
  // and the preview must not survive the click that acts on it
  await aim('r:add-and-0','(pre-click)');
  await p.mouse.down(); await p.mouse.up(); await p.waitForTimeout(250);
  console.log('   after clicking +AND        ', JSON.stringify(await state(p)),
              '| rows now', await p.evaluate(()=>window.ed.getDocument().root.children.length));
  await p.close();
}

// The fourth planAdd branch: +OR beside a group that is already an OR extends
// it rather than nesting another. Needs the group to be the last child.
{
  const DOC2={version:'1.0',root:{type:'group',operator:'and',negate:false,children:[
    C('name','A'),
    {type:'group',operator:'or',negate:false,children:[C('name','X'),C('name','Y')]}]}};
  SCRATCH('22.html', PAGE('prose').replace(JSON.stringify(DOC), JSON.stringify(DOC2)));
  const p=await b.newPage({viewport:{width:900,height:700}});
  p.on('pageerror',e=>errs.push('extend: '+e.message));
  await p.goto('http://localhost:8075/tests/browser/.scratch/22.html');await p.waitForSelector('.kce');
  const el=p.locator('[data-fk="r:add-or-1"]');
  const row=await el.evaluate(e=>{const h=e.closest('.kce-line');const r=h.getBoundingClientRect();return {x:r.x,y:r.y,h:r.height};});
  await p.mouse.move(row.x+8,row.y+row.h/2); await p.waitForTimeout(200);
  const bb=await el.boundingBox(); await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.waitForTimeout(220);
  console.log('\n== extend\n   +OR beside an OR group        ', JSON.stringify(await state(p)), '(want X,Y tinted or)');
  await p.close();
}
console.log('\nERRORS:', errs.length?errs:'none');
await b.close();server.close();SCRATCH.remove('22.html');
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
