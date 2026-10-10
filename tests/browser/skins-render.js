const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});
(async()=>{
await new Promise(r=>server.listen(8099,r));
const b=await chromium.launch();
const errs=[];
const p=await b.newPage({viewport:{width:1100,height:900}});
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});

// --- prose (default) on the landing page ---
await p.goto('http://localhost:8099/docs/index.html');
await p.waitForSelector('.kce-line');
const skin = await p.locator('.kce').first().getAttribute('data-kce-skin');
console.log('index default skin:', skin);
console.log('lines:', await p.locator('.kce-line').count(),
            'conditions:', await p.locator('.kce-condition').count(),
            'connectors:', await p.locator('.kce-connector').count(),
            'parens:', await p.locator('.kce-paren').count());

// toggle a connector AND -> OR
const conn = p.locator('.kce-connector-btn').first();
const before = await conn.textContent();
await conn.click();
await p.waitForTimeout(120);
console.log('connector toggle:', before, '->', (await p.locator('.kce-connector-btn').first().textContent()));
await p.locator('.kce-connector-btn').first().click();

// root tools: add a condition and a group
// the add buttons only exist once their line is hovered
await p.locator('.kce-line').last().hover();
await p.locator('.kce-add-and').last().click({ force: true });
await p.waitForTimeout(150);
await p.locator('.kce-line').last().hover();
await p.locator('.kce-add-or').last().click({ force: true });
console.log('after adds, conditions:', await p.locator('.kce-condition').count());

// NOT toggle on a nested group (inline tools)
const notBtn = p.locator('.kce-toggle-not').first();
if (await notBtn.count()) await notBtn.click({ force: true });
await p.waitForTimeout(120);
console.log('negate markers:', await p.locator('.kce-negate-marker').count());

// remove a condition
await p.locator('.kce-condition .kce-remove').last().click({ force: true });
console.log('after remove, conditions:', await p.locator('.kce-condition').count());

// textarea JSON must round-trip and evaluate
const raw = await p.locator('#conditions').inputValue();
const parsed = JSON.parse(raw);
console.log('json ok; root children:', parsed.root.children.length, '| generator:', parsed.generator);
console.log('evaluation panel:', (await p.locator('#eval-output').textContent()).split('\n')[0]);

// --- every skin still renders on skins.html ---
await p.goto('http://localhost:8099/docs/skins.html');
await p.waitForSelector('.kce');
const perSkin = await p.evaluate(() => Array.from(document.querySelectorAll('.kce')).map(e => ({
  skin: e.getAttribute('data-kce-skin'),
  rows: e.querySelectorAll('.kce-condition').length,
  groups: e.querySelectorAll('.kce-group').length,
  lines: e.querySelectorAll('.kce-line').length
})));
console.log('skins page:', JSON.stringify(perSkin));

// boxed still has its header toggle and works
const boxed = p.locator('[data-kce-skin="boxed"]').first();
await boxed.locator('.kce-logic-btn[data-op="or"]').first().click();
console.log('boxed root op after click:', await boxed.locator('.kce-group').first().getAttribute('data-op'));

// --- other pages load clean ---
for (const page of ['demo.html','docs.html','design-lab.html']) {
  await p.goto('http://localhost:8099/docs/'+page);
  await p.waitForTimeout(400);
  console.log(page, 'ok');
}

console.log('ERRORS:', errs.length ? errs : 'none');
await b.close(); server.close();
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
