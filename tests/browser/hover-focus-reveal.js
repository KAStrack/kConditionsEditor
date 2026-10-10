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

const vis = () => p.evaluate(() => {
  const ed = document.querySelector('[data-kce-skin="prose"]');
  return Array.from(ed.querySelectorAll('.kce-adds')).map(a => a.getBoundingClientRect().width > 2);
});
console.log('adds visible at rest:', await vis());

const prose = p.locator('[data-kce-skin="prose"]');
await prose.locator('.kce-line').first().hover();
await p.waitForTimeout(200);
console.log('after hovering line 1 :', await vis());
await prose.locator('.kce-line').nth(1).hover();
await p.waitForTimeout(200);
console.log('after hovering line 2 :', await vis());

// keyboard reachability
const focusable = await p.evaluate(() => {
  const a = document.querySelector('[data-kce-skin="prose"] .kce-add');
  a.focus();
  return { focused: document.activeElement === a, width: a.getBoundingClientRect().width > 2 };
});
console.log('reveals on focus:', JSON.stringify(focusable));

// tree skin: hovering a condition reveals the connector's button after it
// Move the real mouse to a point we have hit-tested ourselves, rather than
// using locator.hover(): its actionability check reports the tree container as
// intercepting, while elementFromPoint at the same spot returns a descendant of
// the row. The point of this test is what a hovering user gets, so drive the
// pointer and check the painted result.
const eqPoint = await p.evaluate(() => {
  const ed = document.querySelector('[data-kce-skin="equation"]');
  const c = ed.querySelector('.kce-condition');
  c.scrollIntoView({ block: 'center' });
  const b = c.getBoundingClientRect();
  const x = b.left + b.width / 2, y = b.top + b.height / 2;
  const hit = document.elementFromPoint(x, y);
  return { x, y, inside: !!hit && (hit === c || c.contains(hit)) };
});
if (!eqPoint.inside) throw new Error('equation row is not hit-testable at its centre');
await p.mouse.move(eqPoint.x, eqPoint.y);
await p.waitForTimeout(200);
console.log('tree, hover condition ->', await p.evaluate(() => {
  const ed = document.querySelector('[data-kce-skin="equation"]');
  return Array.from(ed.querySelectorAll('.kce-adds')).map(a => a.getBoundingClientRect().width > 2);
}));

// Park the pointer somewhere neutral and let any add-preview ghost from the
// previous hover come out of the DOM first. A ghost row is inserted into the
// line list, so measuring while one is up indexes the wrong line — and it is
// what made this step flaky: the DOM kept changing under the actionability
// check as the ghost appeared and vanished.
await p.mouse.move(5, 5);
// The focus check above left an add button focused, and the add preview fires
// on focus as well as hover (deliberately — a keyboard user gets the preview
// too), so its ghost is still up. Blur it as well as moving the pointer.
await p.evaluate(() => document.activeElement && document.activeElement.blur());
await p.waitForFunction(() => !document.querySelector('.kce-ghost'), null, { timeout: 2000 });
const prosePoint = await p.evaluate(() => {
  const ed = document.querySelector('[data-kce-skin="prose"]');
  const l = ed.querySelectorAll('.kce-line')[1];
  l.scrollIntoView({ block: 'center' });
  // Aim at the line's own content, not its box: a flow line is a full-width
  // block whose left edge is the parent's indent padding, so a point there
  // belongs to the container rather than the line.
  const target = l.querySelector('.kce-condition') || l.firstElementChild || l;
  const b = target.getBoundingClientRect();
  const x = b.left + Math.min(12, b.width / 2), y = b.top + b.height / 2;
  const hit = document.elementFromPoint(x, y);
  return {
    x, y,
    inside: !!hit && (hit === l || l.contains(hit)),
    hit: hit ? hit.tagName + '.' + hit.className : null,
    target: target.className
  };
});
if (!prosePoint.inside) throw new Error('prose line is not hit-testable: ' + JSON.stringify(prosePoint));
await p.mouse.move(prosePoint.x, prosePoint.y);
await p.waitForTimeout(200);
console.log('prose line 2 hovered ->', await vis());
await p.locator('.skin-block').nth(4).screenshot({path:SHOT('adds-hover.png')});
console.log('ERRORS:', errs.length?errs:'none');
await b.close();server.close();})().catch(e=>{console.error(e);process.exit(1);});
