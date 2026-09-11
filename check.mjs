#!/usr/bin/env node
/* ==========================================================================
   check.mjs — the pre-handoff gate.
   Run this before you send anyone a link. It catches the long tail that
   otherwise comes back as "there's a small gap here".

   npm i -D playwright axe-core && npx playwright install chromium
   node check.mjs case-study.html

   Exits non-zero if anything fails, so it drops into CI unchanged.
   ========================================================================== */

import { chromium } from 'playwright';
import { readFileSync, readdirSync, mkdirSync, existsSync } from 'node:fs';
import { resolve, dirname, join, basename, extname } from 'node:path';
import { createRequire } from 'node:module';
import { createServer } from 'node:http';

const require = createRequire(import.meta.url);
const file = resolve(process.argv[2] ?? 'case-study.html');
const dir = dirname(file);
const shots = join(dir, '.shots');
const WIDTHS = [1440, 1100, 820, 400];

let failures = 0;
const fail = (m) => { failures++; console.log(`  FAIL  ${m}`); };
const pass = (m) => console.log(`  ok    ${m}`);

/* --------------------------------------------------------------------------
   1. DESIGN LINT (static)
   The constraint that makes the other layers hold: no raw colours and no
   off-scale sizes anywhere except tokens.css.
   -------------------------------------------------------------------------- */

function designLint(){
  console.log('\nDESIGN LINT');
  const files = readdirSync(dir).filter(f => /\.(css|html)$/.test(f) && f !== 'tokens.css');
  // px values that are legitimately raw: hairlines, zero, and outline offsets.
  const OK_PX = new Set(['0px','1px','2px','3px']);

  for (const f of files){
    const body = readFileSync(join(dir, f), 'utf8')
      .replace(/<svg[\s\S]*?<\/svg>/g, '')   // SVG geometry is not design
      .replace(/\/\*[\s\S]*?\*\//g, '')      // comments may quote bad values on purpose
      .replace(/<!--[\s\S]*?-->/g, '');

    const hex = [...body.matchAll(/#[0-9a-fA-F]{3,8}\b/g)].map(m => m[0]);
    const fn  = [...body.matchAll(/\b(?:rgba?|hsla?|color-mix)\([^)]*\)/g)].map(m => m[0]);
    const cols = [...hex, ...fn];
    cols.length ? fail(`${f}: ${cols.length} raw colour(s): ${[...new Set(cols)].slice(0,6).join(' ')}`)
                : pass(`${f}: no raw colours`);

    const px = [...body.matchAll(/(?<![\w-])(\d+(?:\.\d+)?px)/g)]
      .map(m => m[1]).filter(v => !OK_PX.has(v));
    px.length ? fail(`${f}: ${px.length} off-scale size(s): ${[...new Set(px)].join(' ')}`)
              : pass(`${f}: no off-scale sizes`);
  }

  // A class in the markup with no rule anywhere is silent: the element just
  // renders unstyled. This is how a row of arrows ends up stacked, and how
  // ten icons render as nothing. Cheapest check in the file.
  const htmlFiles = readdirSync(dir).filter(f => f.endsWith('.html'));
  const allCss = readdirSync(dir).filter(f => f.endsWith('.css'))
    .map(f => readFileSync(join(dir, f), 'utf8')).join('\n');
  for (const f of htmlFiles){
    const src = readFileSync(join(dir, f), 'utf8');
    const styleBlocks = [...src.matchAll(/<style[^>]*>([\s\S]*?)<\/style>/g)].map(m => m[1]).join('\n');
    const defined = new Set(
      [...(allCss + styleBlocks).matchAll(/\.(-?[A-Za-z_][A-Za-z0-9_-]*)/g)].map(m => m[1])
    );
    const used = new Set();
    for (const m of src.matchAll(/class="([^"]+)"/g)) m[1].split(/\s+/).forEach(c => c && used.add(c));
    const orphans = [...used].filter(c => !defined.has(c));
    orphans.length ? fail(`${f}: ${orphans.length} class(es) used but never defined: ${orphans.join(' ')}`)
                   : pass(`${f}: every class is defined`);
  }
}

/* --------------------------------------------------------------------------
   2. RUNTIME CHECKS
   -------------------------------------------------------------------------- */

const OVERFLOW_PROBE = () => {
  // An element that paints outside its parent's box is the bug class that
  // produced the stage-card spill. Absolutely positioned and decorative
  // elements are expected to escape, so they are excluded.
  const bad = [];
  const VOID = new Set(['BR','HR','WBR','IMG','INPUT','SOURCE']);
  const label = el => el.tagName.toLowerCase() +
    (el.id ? '#' + el.id : '') +
    (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '');

  for (const el of document.querySelectorAll('body *')){
    if (VOID.has(el.tagName)) continue;          // zero-box elements measure oddly
    const cs = getComputedStyle(el);
    if (cs.position === 'absolute' || cs.position === 'fixed') continue;
    if (cs.display === 'inline') continue;       // inline boxes legitimately overhang
    if (el.closest('[aria-hidden="true"]')) continue;
    const p = el.parentElement;
    if (!p || p === document.body) continue;
    const pcs = getComputedStyle(p);
    if (pcs.overflow !== 'visible' || pcs.position === 'absolute') continue;
    const r = el.getBoundingClientRect(), pr = p.getBoundingClientRect();
    if (!r.height || !pr.height || !r.width) continue;
    const spill = Math.round(Math.max(r.bottom - pr.bottom, pr.top - r.top));
    if (spill > 2) bad.push(`${label(el)} spills ${spill}px out of ${label(p)}`);
  }
  return [...new Set(bad)].slice(0, 8);
};

const CONTRAST_SAMPLE = () => {
  // Flags text that is both small and low contrast. axe covers this too,
  // but this reports the actual offending selector in one line.
  const lum = c => {
    const [r,g,b] = c.match(/\d+(\.\d+)?/g).slice(0,3).map(Number)
      .map(v => { v/=255; return v <= .03928 ? v/12.92 : ((v+.055)/1.055) ** 2.4 });
    return .2126*r + .7152*g + .0722*b;
  };
  const out = [];
  for (const el of document.querySelectorAll('p,span,a,em,strong,h1,h2,h3,h4,li,div,td,th,button,figcaption')){
    if (!el.childNodes.length) continue;
    const txt = [...el.childNodes].filter(n => n.nodeType === 3).map(n => n.textContent.trim()).join('');
    if (!txt) continue;
    const cs = getComputedStyle(el);
    const size = parseFloat(cs.fontSize);
    const bold = parseInt(cs.fontWeight, 10) >= 700;
    const large = size >= 24 || (size >= 18.66 && bold);
    let bg = cs.backgroundColor, node = el, gradient = false;
    while (bg === 'rgba(0, 0, 0, 0)' && node.parentElement){
      if ((getComputedStyle(node).backgroundImage || '').includes('gradient')){ gradient = true; break }
      node = node.parentElement; bg = getComputedStyle(node).backgroundColor;
    }
    if (gradient) continue;   // cannot be computed reliably; verify by eye
    if (bg === 'rgba(0, 0, 0, 0)') bg = 'rgb(255,255,255)';
    const L1 = lum(cs.color), L2 = lum(bg);
    const ratio = (Math.max(L1,L2) + .05) / (Math.min(L1,L2) + .05);
    const need = large ? 3 : 4.5;
    if (ratio < need) out.push(`${el.tagName.toLowerCase()}.${(el.className||'').toString().trim().split(/\s+/)[0]} ${ratio.toFixed(2)}:1 (needs ${need}) "${txt.slice(0,28)}"`);
  }
  return [...new Set(out)].slice(0, 8);
};

/* Serve over http. file:// blocks axe from reading stylesheets, and it is
   not how the page will actually be delivered.                             */
const MIME = { '.html':'text/html', '.css':'text/css', '.js':'text/javascript',
               '.svg':'image/svg+xml', '.png':'image/png', '.woff2':'font/woff2' };
function serve(){
  return new Promise(ok => {
    const s = createServer((req, res) => {
      const name = decodeURIComponent(req.url.split('?')[0]).replace(/^\/+/, '') || basename(file);
      try {
        const buf = readFileSync(join(dir, name));
        res.writeHead(200, { 'content-type': MIME[extname(name)] ?? 'application/octet-stream' });
        res.end(buf);
      } catch { res.writeHead(404); res.end('not found') }
    });
    s.listen(0, '127.0.0.1', () => ok({ s, port: s.address().port }));
  });
}

async function runtime(){
  if (!existsSync(shots)) mkdirSync(shots, { recursive: true });
  const { s: server, port } = await serve();
  const url = `http://127.0.0.1:${port}/${basename(file)}`;
  const browser = await chromium.launch();
  let axePath = null;
  try { axePath = require.resolve('axe-core/axe.min.js') } catch {}

  for (const width of WIDTHS){
    console.log(`\n@ ${width}px`);
    const page = await browser.newPage({ viewport: { width, height: 900 } });
    const jsErrors = [];
    page.on('pageerror', e => jsErrors.push(e.message));
    page.on('console', m => m.type() === 'error' && jsErrors.push(m.text()));

    await page.goto(url);
    await page.evaluate(() => document.querySelectorAll('.reveal').forEach(e => e.classList.add('in')));
    await page.waitForTimeout(350);

    // a. no horizontal scroll
    const wide = await page.evaluate(() => {
      const vw = document.documentElement.clientWidth;
      if (document.documentElement.scrollWidth <= vw + 1) return null;
      const out = [];
      for (const el of document.querySelectorAll('body *')){
        const cs = getComputedStyle(el);
        if (cs.position === 'fixed') continue;
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.right > vw + 1){
          out.push(el.tagName.toLowerCase() +
            (el.id ? '#' + el.id : '') +
            (typeof el.className === 'string' && el.className ? '.' + el.className.trim().split(/\s+/).join('.') : '') +
            ` right=${Math.round(r.right)} vw=${vw}`);
        }
      }
      return out.slice(0, 4);
    });
    wide ? wide.forEach(w => fail(`horizontal scroll: ${w}`)) : pass('no horizontal scroll');

    // b. nothing spills its parent
    const spills = await page.evaluate(OVERFLOW_PROBE);
    spills.length ? spills.forEach(s => fail(s)) : pass('no element spills its parent');

    // c. contrast
    const contrast = await page.evaluate(CONTRAST_SAMPLE);
    contrast.length ? contrast.forEach(c => fail(`contrast: ${c}`)) : pass('contrast passes');

    // d. nothing fixed is sitting on top of a heading
    const covered = await page.evaluate(async () => {
      const out = [];
      // Only check what a user can actually navigate to: in-page anchor
      // targets, and the first eyebrow/heading inside each. Scrolling an
      // arbitrary mid-page h3 to the top is not a real scenario.
      const targets = new Set();
      for (const a of document.querySelectorAll('a[href^="#"]')){
        const t = document.getElementById(a.getAttribute('href').slice(1));
        if (!t) continue;
        for (const sel of ['.eyebrow', 'h1,h2,h3']){
          const el = t.querySelector(sel);
          if (el) targets.add(el);
        }
      }
      // smooth scrolling animates, so measuring straight after
      // scrollIntoView reads the OLD position and passes falsely.
      const prev = document.documentElement.style.scrollBehavior;
      document.documentElement.style.scrollBehavior = 'auto';
      const settle = () => new Promise(r => requestAnimationFrame(() => requestAnimationFrame(r)));
      for (const h of targets){
        const r = h.getBoundingClientRect();
        if (r.width < 1 || r.height < 1) continue;
        h.scrollIntoView({ block:'start' });
        await settle();
        const r2 = h.getBoundingClientRect();
        const hit = document.elementFromPoint(r2.left + 4, r2.top + r2.height/2);
        if (hit && hit !== h && !h.contains(hit) && !hit.contains(h)){
          out.push(`${h.textContent.trim().slice(0,24)} covered by ` +
            hit.tagName.toLowerCase() + (typeof hit.className === 'string' && hit.className
              ? '.' + hit.className.trim().split(/\s+/)[0] : ''));
        }
      }
      window.scrollTo(0,0);
      document.documentElement.style.scrollBehavior = prev;
      return [...new Set(out)].slice(0,5);
    });
    covered.length ? covered.forEach(c => fail(`occluded: ${c}`)) : pass('no heading occluded');

    // d2. every icon actually renders. An svg with no size is invisible and
    // otherwise silent: no overflow, no contrast issue, no console error.
    const deadIcons = await page.evaluate(() => {
      const out = [];
      for (const svg of document.querySelectorAll('svg')){
        // display:none is a deliberate choice (e.g. a diagram that
        // linearises on narrow screens), not a broken icon.
        if (svg.checkVisibility && !svg.checkVisibility({ checkVisibilityCSS: true })) continue;
        const r = svg.getBoundingClientRect();
        if (r.width < 2 || r.height < 2){
          const p = svg.parentElement;
          out.push((p && typeof p.className === 'string' && p.className
            ? '.' + p.className.trim().split(/\s+/)[0] : svg.tagName) +
            ` renders ${Math.round(r.width)}x${Math.round(r.height)}`);
        }
      }
      return [...new Set(out)].slice(0, 5);
    });
    deadIcons.length ? deadIcons.forEach(d => fail(`invisible icon: ${d}`))
                     : pass('all icons render');

    // e. content is visible without JS-dependent reveal completing
    const invisible = await page.evaluate(() => {
      let n = 0;
      for (const el of document.querySelectorAll('main *')){
        const cs = getComputedStyle(el);
        if (parseFloat(cs.opacity) === 0 && el.textContent.trim()) n++;
      }
      return n;
    });
    invisible ? fail(`${invisible} element(s) still at opacity 0`) : pass('all content visible');

    // e. axe
    if (axePath){
      await page.addScriptTag({ path: axePath });
      const res = await page.evaluate(async () =>
        (await window.axe.run(document, { runOnly: ['wcag2a','wcag2aa'] })).violations
          .flatMap(v => v.nodes.slice(0,3).map(n =>
            `${v.id}: ${n.target.join(' ')} ${(n.any?.[0]?.message ?? '').slice(0,90)}`)));
      res.length ? res.forEach(v => fail(`axe: ${v}`)) : pass('axe: no violations');
    } else {
      console.log('  skip  axe (npm i -D axe-core to enable)');
    }

    // f. no JS errors
    jsErrors.length ? jsErrors.forEach(e => fail(`js: ${e}`)) : pass('no js errors');

    // g. screenshots for eyeballing
    for (const s of await page.$$('section[id]')){
      const id = await s.getAttribute('id');
      await s.screenshot({ path: join(shots, `${width}-${id}.png`) });
    }
    await page.close();
  }
  await browser.close();
  server.close();
}

/* ------------------------------------------------------------------------ */

designLint();
await runtime();

console.log(`\n${failures ? `${failures} FAILURE(S)` : 'ALL CHECKS PASSED'}`);
console.log(`screenshots: ${shots}`);
process.exit(failures ? 1 : 0);
