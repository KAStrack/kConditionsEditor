const { chromium } = require('playwright');
const http=require('http'),fs=require('fs'),path=require('path');
const ROOT = require('path').resolve(__dirname, '..', '..');
const server=http.createServer((q,s)=>{let u=decodeURIComponent(q.url.split('?')[0]);if(u.endsWith('/'))u+='index.html';
 fs.readFile(path.join(ROOT,u),(e,d)=>{if(e){s.writeHead(404);return s.end();}
 s.writeHead(200,{'content-type':{'.html':'text/html','.js':'text/javascript','.css':'text/css','.json':'application/json'}[path.extname(u)]||'text/plain'});s.end(d);});});

const PAGE = `<!doctype html><meta charset=utf-8>
<link rel=stylesheet href=src/k-conditions-editor.css><link rel=stylesheet href=src/k-conditions-skins.css>
<textarea id=t rows=6 style="width:100%"></textarea>
<script src=src/k-conditions-evaluator.js></script>
<script src=src/k-conditions-sql.js></script>
<script src=src/k-conditions-editor.js></script>
<script src=docs/assets/demo-config.js></script>
<script>
window.ed = KConditionsEditor.attach('#t', {
  fields: window.DEMO_FIELDS, operators: window.DEMO_OPERATORS,
  output: 'sql', documentInComment: true, hideTextarea: false,
  sql: { dialect: 'mysql' }, startOpen: true
});
</script>`;

(async()=>{
await new Promise(r=>server.listen(8099,r));
fs.writeFileSync(path.join(ROOT,'_roundtrip.html'), PAGE);
const b=await chromium.launch();
const errs=[]; const p=await b.newPage({viewport:{width:1100,height:900}});
p.on('pageerror',e=>errs.push('pageerror: '+e.message));
p.on('console',m=>{if(m.type()==='error')errs.push('console: '+m.text());});

await p.goto('http://localhost:8099/_roundtrip.html');
await p.waitForSelector('.kce-line');

// build a rule
await p.locator('.kce-line').last().hover();
  await p.locator('.kce-add').last().click({ force: true });
const row = p.locator('.kce-condition').last();
await row.locator('select.kce-field').selectOption('state');
await row.locator('select.kce-operator').selectOption('is_gulf_state');
await p.waitForTimeout(200);

const sqlText = await p.locator('#t').inputValue();
console.log('--- textarea ---');
console.log(sqlText.split('\n').slice(0,2).join('\n').slice(0,200));
console.log('has doc comment:', /^\/\* kconditions:1\.0 /.test(sqlText));

// reload from that exact text: a fresh editor must recover the rule
const recovered = await p.evaluate((text) => {
  const ta = document.createElement('textarea');
  ta.value = text;
  document.body.appendChild(ta);
  const ed2 = KConditionsEditor.attach(ta, {
    fields: window.DEMO_FIELDS, operators: window.DEMO_OPERATORS,
    output: 'sql', documentInComment: true, startOpen: true, sql: { dialect: 'mysql' }
  });
  return { conditions: JSON.stringify(ed2.getDocument()) === JSON.stringify(window.ed.getDocument()) };
}, sqlText);
console.log('round-trips into a fresh editor:', recovered.conditions);

console.log('ERRORS:', errs.length ? errs : 'none');
await b.close(); server.close();
fs.unlinkSync(path.join(ROOT,'_roundtrip.html'));
})().catch(e=>{console.error('FAILED',e);process.exit(1);});
