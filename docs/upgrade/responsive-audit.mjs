// ═══════════════════════════════════════════════════════════════════════════
// responsive-audit.mjs — the reusable full-matrix responsive/a11y harness.
//
// One committed tool for the whole UI/UX program. For a given route it measures,
// in BOTH themes across the full device matrix, four hard gates:
//   • horizontal overflow (page must never scroll sideways)
//   • WCAG AA text contrast (composited over the real bg stack)
//   • lucide SVG-icon contrast (currentColor vs its tile)
//   • decorative-emoji scan (a global keep-set of brand/content glyphs is allowed)
// plus two responsive-fit gates:
//   • no readable text block wider than MAX_LINE (ultra-wide line-length)
//   • min rendered font floor (nothing below FONT_FLOOR px)
//
// Device matrix (px): 280 Fold-cover · 320 · 360 · 390 · 414 · 768 · 834 iPad ·
//   1024 · 1280 · 1440 · 1536 · 1920 · 2560.
//
// Usage: node docs/upgrade/responsive-audit.mjs <baseURL> [routeGlob]
// Routes + fixtures are declared in ROUTES below (generic API fallback provided).
// This is a MEASUREMENT tool — it never mutates the app.
// ═══════════════════════════════════════════════════════════════════════════
import { chromium } from 'playwright-core';

const BASE = process.argv[2] || 'http://localhost:3960';
const ONLY = process.argv[3] || '';
const WIDTHS = [280, 320, 360, 390, 414, 768, 834, 1024, 1280, 1440, 1536, 1920, 2560];
const THEMES = ['light', 'dark'];
const MAX_LINE = 1500;   // a single text block wider than this reads as "stretched"
const FONT_FLOOR = 10;   // px — flag genuinely-tiny text (< floor). 10px micro-labels
                         // sit at the design's --fs-micro floor and pass.

// brand/content glyphs intentionally kept program-wide (hybrid rule)
const KEEP = new Set(['←','→','↗','↘','↩','⇅','⇄','↔','›','‹','·','–','—','✓','✕','×','★','☆','♥','♡',
  '👋','✨','🔥','🏠','🔑','🏷','🏔','🏨','◎','📍','📱','🎉','🛏','●','○','▶','◀','🥇','🥈','🥉','😊','😐','😞']);

function lin(c){c/=255;return c<=0.03928?c/12.92:Math.pow((c+0.055)/1.055,2.4);}
function lum({r,g,b}){return 0.2126*lin(r)+0.7152*lin(g)+0.0722*lin(b);}
function ratio(a,b){const l1=lum(a),l2=lum(b);const hi=Math.max(l1,l2),lo=Math.min(l1,l2);return (hi+0.05)/(lo+0.05);}
function parse(str){if(!str)return null;const m=String(str).match(/rgba?\(([^)]+)\)/);if(!m)return null;const p=m[1].split(',').map(s=>parseFloat(s.trim()));return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]};}
function comp(fg,bg){const a=fg.a;return {r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)};}

// { route, scope (CSS root of the surface), auth?, ls?, fixtures: {urlSubstr: json} }
const GENERIC = { ok:true, config:null, locks:[], properties:[], tables:[], creators:[], users:[], bookings:[], rows:[] };
const ROUTES = [
  { route:'/circle', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma"}'},
    fixtures:{ 'circle/properties': { cities:['Dehradun'], properties:[{id:'p1',title:'Cave View Villa',city:'Dehradun',state:'UK',locationLabel:'Rajpur, Dehradun',images:[],monthlyRate:30000,roiMin:15,roiMax:28,occupancyLabel:'High',badges:['Trending'],operationModel:'managed',status:'open',roomTypes:[{id:'r1',name:'Deluxe',monthlyRate:30000,availableUnits:3}]}] } } },
  { route:'/circle/dashboard', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma","phone":"+919812345678"}',sb_circle_locks_v1:'["p1"]'},
    fixtures:{ 'circle/properties':{properties:[{id:'p1',title:'Cave View Villa',city:'Dehradun',state:'UK',images:[],monthlyRate:30000,roiMin:15,roiMax:28,status:'open',roomTypes:[{id:'r1',monthlyRate:30000}]}]}, 'owned-summary':{ownsUnits:true,unitCount:2,hotelCount:1}, 'locks':{locks:[{property_id:'p1'}]} } },
  { route:'/admin/reports', scope:'body', admin:true,
    fixtures:{ 'admin':{ kpis:{}, ledger:[], payouts:[], bookings:[], holds:[], hotels:[], topCreators:[], codes:[], complaints:[], feedback:[], flags:[], users:[], creators:[] } } },
  { route:'/admin/rls', scope:'body', admin:true,
    fixtures:{ 'admin/rls':{ serviceRole:true, tables:[{table:'users',rls_enabled:true,policy_count:2,policies:[]},{table:'bookings',rls_enabled:true,policy_count:1,policies:[]},{table:'otp_codes',rls_enabled:false,policy_count:0,policies:[]}] } } },
  { route:'/circle/model2/browse', scope:'body', ls:{sb_token:'t',sb_user:'{"id":"u1","name":"Asha Verma"}'},
    fixtures:{ 'city-access':{ activeCities:[], cityAccessPrice:999 }, 'b2b/marketplace':{ listings:[{id:'l1',listing_id:'l1',hotel_id:'h1',hotel_name:'Cave View',hotel_city:'Dehradun',city:'Dehradun',room_name:'Deluxe',buy_per_night:2000,market:{adr:2800,low:2400,high:3200}}] } } },
  { route:'/circle/model3', scope:'body',
    fixtures:{ 'circle/marketplace': { hotels:[{id:'h1',name:'Cave View Resort',city:'Dehradun',state:'UK',starRating:4,image:null,fromWholesale:2100,rooms:[{id:'r1',name:'Deluxe',type:'deluxe',image:null,capacity:2,fromWholesale:2100}]}] } } },
  { route:'/circle/model4', scope:'body',
    fixtures:{ 'b2b/marketplace': { listings:[{id:'l1',hotel_name:'Cave View',hotel_city:'Dehradun',unit_number:'12',date_from:'2026-08-01',date_to:'2026-08-04',nights:3,ask_total:9000}] } } },
  { route:'/admin/host', scope:'body', admin:true,
    fixtures:{ 'admin/host':{ kpis:{leads:3,leadsNew:1,portfolios:2,portfoliosActive:1,portfolioRevenue:1000,propertySubmissions:2,propertySubmissionsPending:1,inquiries:1,inquiriesNew:1,projects:1,orders:1,storeGmv:1,jobs:1,jobsActive:1,workforceRevenue:1,channels:1,channelsNew:1}, leads:[], portfolios:[], propertySubmissions:[], inquiries:[], projects:[], orders:[], jobs:[], channels:[] } } },
];

const browser = await chromium.launch({ executablePath: '/opt/pw-browsers/chromium' });
const summary = [];

for (const cfg of ROUTES) {
  if (ONLY && !cfg.route.includes(ONLY)) continue;
  const rowFails = [];
  for (const theme of THEMES) {
    for (const w of WIDTHS) {
      const ctx = await browser.newContext({ viewport:{width:w,height:900}, colorScheme:theme });
      const ls = { ...(cfg.ls||{}), sb_theme:theme };
      if (cfg.admin) { Object.assign(ls, { sb_admin_token:'t.t.t', sb_admin_user:'{"id":"a1","name":"Admin","role":"super_admin"}', sb_token:'t.t.t', sb_user:'{"id":"a1","name":"Admin","role":"super_admin"}' }); }
      await ctx.addInitScript((data)=>{ try{ for(const [k,v] of Object.entries(data.ls)) localStorage.setItem(k,v); sessionStorage.setItem('sb_welcome_shown','1'); }catch(e){} }, { ls });
      const page = await ctx.newPage();
      await page.route('**/api/**', route=>{
        const u = route.request().url();
        for (const [sub,json] of Object.entries(cfg.fixtures||{})) if (u.includes(sub)) return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(json)});
        return route.fulfill({status:200,contentType:'application/json',body:JSON.stringify(GENERIC)});
      });
      try { await page.goto(`${BASE}${cfg.route}`, { waitUntil:'domcontentloaded', timeout:20000 }); } catch(e){}
      await page.evaluate((th)=>document.documentElement.setAttribute('data-theme',th), theme);
      await page.waitForTimeout(900);

      const r = await page.evaluate((args)=>{
        const { scope, KEEParr, MAX_LINE, FONT_FLOOR } = args;
        const KEEP = new Set(KEEParr);
        const root = document.querySelector(scope) || document.body;
        const de = document.documentElement;
        const overflow = de.scrollWidth > de.clientWidth + 1 ? { s:de.scrollWidth, c:de.clientWidth } : null;
        // helpers
        const P=(str)=>{ if(!str)return null; const m=String(str).match(/rgba?\(([^)]+)\)/); if(!m)return null; const p=m[1].split(',').map(x=>parseFloat(x.trim())); return {r:p[0],g:p[1],b:p[2],a:p[3]===undefined?1:p[3]}; };
        const bodyBg = P(getComputedStyle(document.body).backgroundColor) || {r:255,g:255,b:255,a:1};
        const emoji=[], tooWide=[], tiny=[];
        const RE=/[\u{1F000}-\u{1FAFF}\u{2600}-\u{27BF}\u{2190}-\u{21FF}\u{2B00}-\u{2BFF}\u{2300}-\u{23FF}✅✔✖]/gu;
        const walk=document.createTreeWalker(root,NodeFilter.SHOW_TEXT); let n;
        while((n=walk.nextNode())){ const t=n.textContent||''; const el=n.parentElement; if(!el||el.closest('script,style'))continue;
          const cs=getComputedStyle(el); const fs=parseFloat(cs.fontSize)||16;
          if(cs.position==='fixed'&&cs.pointerEvents==='none')continue; // fixed dev-version chip
          const bad=[...(t.match(RE)||[])].filter(ch=>!KEEP.has(ch));
          if(bad.length && fs<40) emoji.push({t:t.trim().slice(0,18),bad});
          if(fs>0 && fs<FONT_FLOOR && t.trim()) tiny.push({t:t.trim().slice(0,18),fs:+fs.toFixed(1)});
          if(t.trim().length>40){ const rect=el.getBoundingClientRect(); if(rect.width>MAX_LINE) tooWide.push({t:t.trim().slice(0,18),w:Math.round(rect.width)}); }
        }
        // contrast (text)
        const els=Array.from(root.querySelectorAll('*')); const cfails=[];
        for(const el of els){ if(!el.childNodes)continue; if(el.tagName==='OPTION'||el.tagName==='SELECT')continue;
          const direct=Array.from(el.childNodes).some(c=>c.nodeType===3&&c.textContent.trim().length>0); if(!direct)continue;
          const cs=getComputedStyle(el); if(cs.visibility==='hidden'||cs.display==='none'||parseFloat(cs.opacity)===0)continue;
          if(cs.position==='fixed'&&cs.pointerEvents==='none')continue;
          // A gradient OR a backdrop-filter (frosted glass) ancestor cannot be flat-composited,
          // so a computed contrast number would be wrong — skip those (documented limitation).
          const stk=[]; let cur=el, grad=false; while(cur){const s=getComputedStyle(cur); if(s.backgroundImage&&s.backgroundImage!=='none')grad=true; if((s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none'))grad=true; stk.push(s.backgroundColor); cur=cur.parentElement;}
          if(grad)continue;
          const fg=P(cs.color); if(!fg)continue;
          let bg={...bodyBg}; for(let i=stk.length-1;i>=0;i--){const b=P(stk[i]); if(b&&b.a>0){const a=b.a; bg={r:b.r*a+bg.r*(1-a),g:b.g*a+bg.g*(1-a),b:b.b*a+bg.b*(1-a)};}}
          const L=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
          const a=fg.a; const over={r:fg.r*a+bg.r*(1-a),g:fg.g*a+bg.g*(1-a),b:fg.b*a+bg.b*(1-a)};
          const l1=L(over),l2=L(bg),hi=Math.max(l1,l2),lo=Math.min(l1,l2); const cr=(hi+0.05)/(lo+0.05);
          const fs=parseFloat(cs.fontSize),fw=parseInt(cs.fontWeight)||400; const large=fs>=24||(fs>=18.66&&fw>=700); const min=large?3.0:4.5;
          if(cr<min-0.05) cfails.push({t:(el.textContent||'').trim().slice(0,16),cr:+cr.toFixed(2)});
        }
        // icon contrast — composite the FULL bg stack to the ground (same as text),
        // so an icon on a faint same-hue tint reads against the real card, not the tint.
        const L=(c)=>{const f=(v)=>{v/=255;return v<=0.03928?v/12.92:Math.pow((v+0.055)/1.055,2.4);};return 0.2126*f(c.r)+0.7152*f(c.g)+0.0722*f(c.b);};
        const ifails=[]; root.querySelectorAll('svg').forEach(svg=>{
          const col=P(getComputedStyle(svg).color); if(!col)return;
          const stk=[]; let cur=svg.parentElement, grad=false;
          while(cur){const s=getComputedStyle(cur); if(s.backgroundImage&&s.backgroundImage!=='none')grad=true; if((s.backdropFilter&&s.backdropFilter!=='none')||(s.webkitBackdropFilter&&s.webkitBackdropFilter!=='none'))grad=true; stk.push(s.backgroundColor); cur=cur.parentElement;}
          if(grad)return; // gradient/glass tile — can't measure a flat bg; visual check covers it
          let bg={...bodyBg}; for(let i=stk.length-1;i>=0;i--){const b=P(stk[i]); if(b&&b.a>0){const a=b.a; bg={r:b.r*a+bg.r*(1-a),g:b.g*a+bg.g*(1-a),b:b.b*a+bg.b*(1-a)};}}
          const a=col.a; const over={r:col.r*a+bg.r*(1-a),g:col.g*a+bg.g*(1-a),b:col.b*a+bg.b*(1-a)};
          const l1=L(over),l2=L(bg),hi=Math.max(l1,l2),lo=Math.min(l1,l2); const cr=(hi+0.05)/(lo+0.05);
          if(cr<2.9) ifails.push(+cr.toFixed(2));
        });
        return { overflow, emoji:emoji.slice(0,6), tooWide:tooWide.slice(0,4), tiny:tiny.slice(0,4), cfails:cfails.slice(0,6), ifails:ifails.slice(0,6) };
      }, { scope: cfg.scope, KEEParr:[...KEEP], MAX_LINE, FONT_FLOOR });

      const issues = [];
      if (r.overflow) issues.push(`OVERFLOW ${r.overflow.s}>${r.overflow.c}`);
      if (r.emoji.length) issues.push(`EMOJI ${JSON.stringify(r.emoji)}`);
      if (r.cfails.length) issues.push(`TEXT ${JSON.stringify(r.cfails)}`);
      if (r.ifails.length) issues.push(`ICON ${JSON.stringify(r.ifails)}`);
      if (r.tooWide.length) issues.push(`WIDE ${JSON.stringify(r.tooWide)}`);
      if (r.tiny.length) issues.push(`TINY ${JSON.stringify(r.tiny)}`);
      if (issues.length) rowFails.push(`  [${theme} ${w}] ${issues.join(' | ')}`);
      await ctx.close();
    }
  }
  const ok = rowFails.length===0;
  summary.push({ route: cfg.route, ok, n: rowFails.length });
  console.log(`\n### ${cfg.route} — ${ok?'CLEAN':rowFails.length+' issue-rows'}`);
  rowFails.forEach(l=>console.log(l));
}
console.log('\n\n═══ SUMMARY ═══');
summary.forEach(s=>console.log(`${s.ok?'✓':'✗'} ${s.route}${s.ok?'':' ('+s.n+')'}`));
console.log(summary.every(s=>s.ok) ? '\nALL ROUTES CLEAN across 13 widths × 2 themes' : `\n${summary.filter(s=>!s.ok).length} route(s) need work`);
await browser.close();
