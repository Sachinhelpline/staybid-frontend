import { chromium } from 'playwright-core';
const b = await chromium.launch({ executablePath:'/opt/pw-browsers/chromium' });
const BASE='http://127.0.0.1:3964';
const WIDTHS=[320,360,390,768,834,1024,1280,1440,1920];
const ROUTES=['/circle','/circle/dashboard','/circle/model3','/circle/model4','/trade'];
function lum(s){ const m=(s||'').match(/[\d.]+/g); if(!m) return -1; const c=m.slice(0,3).map(Number); return Math.round(0.2126*c[0]+0.7152*c[1]+0.0722*c[2]); }
let fails=0, checks=0;
for (const theme of ['light','dark']) {
  for (const path of ROUTES) {
    for (const w of WIDTHS) {
      const ctx = await b.newContext({ viewport:{width:w,height:900}, colorScheme:theme });
      await ctx.addInitScript((t)=>{ try{ sessionStorage.setItem('sb_welcome_shown','1'); localStorage.setItem('sb_theme',t); document.documentElement.setAttribute('data-theme',t);}catch(e){} }, theme);
      const p = await ctx.newPage();
      await p.route(/fonts\.(googleapis|gstatic)\.com/, r=>r.abort());
      try { await p.goto(BASE+path,{waitUntil:'domcontentloaded',timeout:15000}); } catch(e){ console.log(`ERR ${path} @${w} ${theme}`); await ctx.close(); continue; }
      await p.waitForTimeout(1400);
      const r = await p.evaluate(()=>{
        const over=document.documentElement.scrollWidth-document.documentElement.clientWidth;
        // sample a representative card + the page bg to check light-card-on-light / dark-on-dark (no clash)
        const card=document.querySelector('.sbc-mkt-card,.sbc-model,.sbc-dash-strip,.sbc-home-portfolio,[class*="rounded"]');
        const cb=card?getComputedStyle(card).backgroundColor:null;
        const pageBg=getComputedStyle(document.body).backgroundColor;
        return { over, cardBg:cb, pageBg };
      });
      checks++;
      const cl=lum(r.cardBg), pl=lum(r.pageBg);
      // clash = card and page on OPPOSITE ends of luminance (dark card lum<70 on light page lum>180, or vice versa)
      const clash = (cl>=0&&pl>=0) && ((theme==='light'&&cl<70&&pl>150) || (theme==='dark'&&cl>180&&pl<70));
      if (r.over>1 || clash) { fails++; console.log(`FAIL ${path} @${w} ${theme}: overflow=${r.over} cardLum=${cl} pageLum=${pl}${clash?' CLASH':''}`); }
      await ctx.close();
    }
  }
}
console.log(`\nQA: ${checks} checks, ${fails} failed`);
await b.close();
