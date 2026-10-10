const {chromium}=require('playwright');const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
(async()=>{
await new Promise(r=>server.listen(8078,r));
const b=await chromium.launch();const errs=[];
const skins=['prose','equation','blackboard','ledger','boxed'];

// landing page picker
let p=await b.newPage({viewport:{width:1100,height:900}});
p.on('pageerror',e=>errs.push('index: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('index: '+m.text());});
await p.goto('http://localhost:8078/docs/index.html'); await p.waitForSelector('.kce'); await p.waitForTimeout(400);
const before = await p.evaluate(()=>JSON.stringify(window.__ed ? null : document.querySelector('#conditions').value.length));
for (const s of skins) {
  await p.selectOption('#demo-skin', s); await p.waitForTimeout(250);
  const info = await p.evaluate(()=>{
    const root=document.querySelector('.kce');
    return {skin:root.getAttribute('data-kce-skin'),
            rows:root.querySelectorAll('.kce-condition').length,
            lines:root.querySelectorAll('.kce-line').length,
            groups:root.querySelectorAll('.kce-group').length};
  });
  console.log('index  ', s.padEnd(11), JSON.stringify(info));
}
const after = await p.evaluate(()=>document.querySelector('#conditions').value.length);
console.log('index   rule preserved across all five skins:', after > 50);
await p.close();

// playground picker + theme
p=await b.newPage({viewport:{width:1200,height:900}});
p.on('pageerror',e=>errs.push('demo: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('demo: '+m.text());});
await p.goto('http://localhost:8078/docs/demo.html'); await p.waitForSelector('.kce'); await p.waitForTimeout(400);
for (const s of skins) {
  await p.selectOption('#skin', s); await p.waitForTimeout(220);
  const got = await p.evaluate(()=>document.querySelector('.kce').getAttribute('data-kce-skin'));
  console.log('demo   ', s.padEnd(11), got===s ? 'ok' : 'MISMATCH '+got);
}
for (const t of ['light','dark','']) {
  await p.selectOption('#theme', t); await p.waitForTimeout(200);
  const got = await p.evaluate(()=>document.querySelector('.kce').getAttribute('data-kce-theme'));
  console.log('demo    theme', (t||'(system)').padEnd(9), String(got));
}
// a rebuild (output switch) must keep the chosen skin
await p.selectOption('#skin','ledger'); await p.waitForTimeout(200);
await p.selectOption('#output','sql'); await p.waitForTimeout(400);
console.log('demo    skin survives a rebuild:', await p.evaluate(()=>document.querySelector('.kce').getAttribute('data-kce-skin')));
await p.close();
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close();
})().catch(e=>{console.error('FAILED',e.message,e.stack);process.exit(1);});
