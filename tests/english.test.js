// 英語表示の確認（node tests/english.test.js）：各画面で日本語が残っていないか、エラーがないか
const { chromium } = require('/opt/node-tools/node_modules/playwright');
(async()=>{const b=await chromium.launch(); const p=await b.newPage({viewport:{width:400,height:860},colorScheme:'light',timezoneId:'America/New_York',locale:'en-US'});
const errs=[]; p.on('pageerror',e=>errs.push(String(e)));
let fails=0;
async function check(name){const r=await p.evaluate(()=>{const out=[]; const w=document.createTreeWalker(document.body,NodeFilter.SHOW_TEXT); let n;
  while((n=w.nextNode())){const el=n.parentElement; if(!el||el.closest('script,style'))continue; if(!n.nodeValue.trim())continue;
    const vis=el.offsetParent!==null||getComputedStyle(el).position==='fixed'; if(/[ぁ-んァ-ン一-龥]/.test(n.nodeValue)&&vis)out.push(n.nodeValue.trim().slice(0,60));}
  document.querySelectorAll('[aria-label]').forEach(e=>{if(/[ぁ-んァ-ン一-龥]/.test(e.getAttribute('aria-label')))out.push('aria:'+e.getAttribute('aria-label'));});
  return out;}); const bad=r.filter(x=>x!=='日本語'); if(bad.length){fails++; console.log('NG:',name,bad);} }
await p.goto('file://'+require('path').join(__dirname,'..','web','index.html')); await p.waitForTimeout(300);
await check('setup');
await p.click('#v-setup [data-open-settings]'); await check('settings'); await p.click('#closeSettings2');
await p.click('#toReady'); await p.waitForTimeout(200); await check('ready');
await p.click('#startBtn'); await p.waitForTimeout(300); await check('run');
await p.click('#passBtn'); await p.waitForTimeout(200); await check('run-recorded');
const bb=await (await p.$('#setBtn')).boundingBox(); await p.mouse.move(bb.x+bb.width/2,bb.y+bb.height/2); await p.mouse.down(); await p.waitForTimeout(1300); await p.mouse.up(); await p.waitForTimeout(200);
await p.click('#cPlus'); await check('change');
await p.click('#pauseBtn'); await p.waitForTimeout(200); await check('paused');
await p.click('#pauseBtn'); await p.waitForTimeout(300);
const sb=await (await p.$('#setBtn')).boundingBox(); await p.mouse.move(sb.x+sb.width/2,sb.y+sb.height/2); await p.mouse.down(); await p.waitForTimeout(1300); await p.mouse.up(); await p.waitForTimeout(200);
const st=await (await p.$('#stopBtn')).boundingBox(); await p.mouse.move(st.x+st.width/2,st.y+st.height/2); await p.mouse.down(); await p.waitForTimeout(2500); await p.mouse.up(); await p.waitForTimeout(300);
await check('result');
if(errs.length){fails++; console.log('NG: エラー',errs);}
console.log(`英語表示：画面8つ、失敗 ${fails}件`); await b.close(); process.exit(fails?1:0);})();
