// 通知の文面と「着いた」（ウォッチから）の自動チェック
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
let fails = 0, checks = 0; const ok = (c, m) => { checks++; if (!c) { fails++; console.log('NG:', m); } };
const toSec = (s) => { const p = s.split(':').map(Number); return p.length === 3 ? p[0] * 3600 + p[1] * 60 + p[2] : p[0] * 60 + p[1]; };
(async () => {
  const b = await chromium.launch();
  for (const [dist, km, interval, profile] of [['フル', 42.195, '5kmごと', '均等'], ['フル', 42.195, '1kmごと', '前半抑えめ'], ['ハーフ', 21.0975, '5kmごと', '前半貯金'], ['10km', 10, '1kmごと', '均等']]) {
    const pg = await b.newPage({ viewport: { width: 420, height: 900 }, locale: 'ja-JP' });
    pg.on('pageerror', e => { fails++; console.log('ERR', e.message); });
    await pg.addInitScript(() => { window.__m = []; window.ReactNativeWebView = { postMessage: (s) => window.__m.push(JSON.parse(s)) }; });
    await pg.goto('file://' + path.join(__dirname, '..', 'web', 'index.html'));
    await pg.click(`#distPills button:has-text("${dist}")`);
    await pg.click(`#intPills button:has-text("${interval}")`);
    await pg.click(`#profPills button:has-text("${profile}")`);
    await pg.click('#toReady'); await pg.click('#startBtn'); await pg.waitForTimeout(300);
    const tag = `${dist} ${interval} ${profile}`;
    let m = (await pg.evaluate(() => window.__m)).filter(x => x.type === 'schedule' && x.running).pop();
    ok(m && m.notify === true, tag + ' 通知がオンで送られていない');
    const it = m.items;
    for (let i = 0; i < it.length; i++) {
      // タイトルの時刻＝読み上げの時刻
      const tt = toSec(it[i].title.split(' ').pop());
      ok(Math.abs(tt - it[i].ms / 1000) <= 0.5, `${tag} 地点${i} タイトルの時刻 ${it[i].title} と予定 ${it[i].ms / 1000}秒が違う`);
      // 次の区間ペース＝次の地点までの時間÷距離
      if (i < it.length - 1) {
        const mm = it[i].body.match(/次の([\d.]+)km (\d+:\d+)\/km/);
        ok(!!mm, `${tag} 地点${i} 本文にペースがない: ${it[i].body}`);
        if (mm) { const kmOf = (j) => /ゴール/.test(it[j].title) ? km : parseFloat(it[j].title); const gap = kmOf(i + 1) - kmOf(i), p = toSec(mm[2]); const real = (it[i + 1].ms - it[i].ms) / 1000 / gap;
          ok(Math.abs(+mm[1] - gap) < 0.051, `${tag} 地点${i} 区間の距離 ${mm[1]} が実際 ${gap} と違う`);
          ok(Math.abs(p - real) <= 0.5 + 1e-9, `${tag} 地点${i} ペース ${mm[2]} が実際 ${real.toFixed(2)}秒/km と違う`); }
      } else ok(/目標/.test(it[i].body), tag + ' ゴールの本文に目標がない');
    }
    // ウォッチの「着いた」：最初の地点の予定より30秒遅れで押されたことにする
    const start = await pg.evaluate(() => JSON.parse(localStorage.getItem('paceProtoV1')).R.start);
    await pg.evaluate((at) => window.koeArrive(at), start + it[0].ms + 30000);
    await pg.waitForTimeout(100);
    const rec = await pg.evaluate(() => JSON.parse(localStorage.getItem('paceProtoV1')).R.rec);
    ok(rec[0] && Math.abs(rec[0].diff - 30) < 0.01, `${tag} 着いたの記録が30秒遅れになっていない ${JSON.stringify(rec)}`);
    m = (await pg.evaluate(() => window.__m)).filter(x => x.type === 'schedule' && x.running).pop();
    ok(/申告 \+0:30/.test(m.items[1].body), `${tag} 申告後の本文に差が出ていない: ${m.items[1].body}`);
    // 1分以内の2回目は無視
    await pg.evaluate((at) => window.koeArrive(at), start + it[0].ms + 40000);
    const rec2 = await pg.evaluate(() => JSON.parse(localStorage.getItem('paceProtoV1')).R.rec);
    ok(Object.keys(rec2).length === 1, tag + ' 1分以内の2回目が記録された');
    await pg.close();
  }
  await b.close();
  console.log(`チェック ${checks}件、失敗 ${fails}件`); process.exit(fails ? 1 : 0);
})();
