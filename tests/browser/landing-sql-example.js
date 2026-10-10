const { chromium } = require('playwright');
const { shot: SHOT } = require('./harness.js');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
(async()=>{
await new Promise(r=>server.listen(8099,r));
const b=await chromium.launch();
const errs=[]; const p=await b.newPage({viewport:{width:1000,height:1000},deviceScaleFactor:2});
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});
await p.goto('http://localhost:8099/docs/index.html');
await p.waitForSelector('#sql-conditions');
await p.waitForTimeout(300);
const v = await p.locator('#sql-conditions').inputValue();
console.log('field visible:', await p.locator('#sql-conditions').isVisible());
console.log('first line:', v.split('\n')[0].slice(0,110));
console.log('sql line   :', v.split('\n')[1]);
await p.selectOption('#sql-dialect','postgres');
await p.waitForTimeout(300);
console.log('after switch:', (await p.locator('#sql-conditions').inputValue()).split('\n')[1]);
// edit through the builder and confirm the field follows
const eds = await p.locator('.kce').count();
console.log('editors on page:', eds);
const conn = p.locator('.kce').nth(1).locator('.kce-connector-btn').first();
await conn.click(); await p.waitForTimeout(250);
console.log('after AND->OR:', (await p.locator('#sql-conditions').inputValue()).split('\n').slice(1,3).join(' ').slice(0,90));
const box = await p.locator('#sql-form').boundingBox();
await p.screenshot({path:SHOT('sql-example.png'), clip:{x:0,y:box.y-120,width:1000,height:640}});
console.log('ERRORS:', errs.length ? errs : 'none');
await b.close(); server.close();
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
