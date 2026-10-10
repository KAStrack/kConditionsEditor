const { chromium } = require('playwright');
const { shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
(async()=>{await new Promise(r=>server.listen(8099,r));
const b=await chromium.launch();const errs=[];
const p=await b.newPage({viewport:{width:1000,height:900},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push(e.message));p.on('console',m=>{if(m.type()==='error')errs.push(m.text());});
await p.goto('http://localhost:8099/docs/skins.html');await p.waitForSelector('.kce');await p.waitForTimeout(300);
console.log(await p.evaluate(()=>JSON.stringify(Array.from(document.querySelectorAll('.kce')).map(e=>({
 skin:e.getAttribute('data-kce-skin'), adds:e.querySelectorAll('.kce-add').length, conns:e.querySelectorAll('.kce-connector-btn').length })))));
for (const [i,name] of [[0,'boxed'],[1,'equation'],[4,'prose']]) {
  await p.locator('.skin-block').nth(i).screenshot({path:SHOT(`adds-${name}.png`)});
}
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close();})().catch(e=>{console.error(e);process.exit(1);});
