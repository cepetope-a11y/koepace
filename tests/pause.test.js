// 一時停止・再開と、通知の「着いた」の地点指定の自動チェック
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
let fails = 0, checks = 0; const ok = (c, m) => { checks++; if (!c) { fails++; console.log('NG:', m); } };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 420, height: 900 } });
  pg.on('pageerror', e => { fails++; console.log('ERR', e.message); });
  await pg.addInitScript(() => { window.__m = []; window.ReactNativeWebView = { postMessage: (s) => window.__m.push(JSON.parse(s)) }; });
  await pg.goto('file://' + path.join(__dirname, '..', 'web', 'index.html'));
  await pg.click('#toReady'); await pg.click('#startBtn'); await pg.waitForTimeout(300);
  const st = () => pg.evaluate(() => JSON.parse(localStorage.getItem('paceProtoV1')).R);
  const last = async () => (await pg.evaluate(() => window.__m)).filter(x => x.type === 'schedule').pop();
  const hold = async (sel, ms) => { const bb = await pg.locator(sel).boundingBox(); await pg.mouse.move(bb.x + bb.width / 2, bb.y + bb.height / 2); await pg.mouse.down(); await pg.waitForTimeout(ms); await pg.mouse.up(); await pg.waitForTimeout(150); };
  const r0 = await st(); const m0 = await last();
  // 一時停止
  await hold('#setBtn', 1000); await pg.click('#pauseBtn'); await pg.waitForTimeout(100);
  const r1 = await st(); const m1 = await last();
  ok(!!r1.pausedAt, '一時停止の時刻が記録されていない');
  ok(m1.running === true && m1.items.length === 0, '一時停止中に予定がアプリへ渡っている');
  ok(await pg.textContent('#pauseBtn') === '再開する', 'ボタンが「再開する」にならない');
  await pg.click('#cBack'); await pg.waitForTimeout(50);
  ok(await pg.isVisible('#pauseNote'), '走行画面に一時停止中の表示がない');
  ok(!(await pg.isVisible('#passBtn')), '一時停止中に着いたボタンが出ている');
  const tA = await pg.textContent('#timeVal'); await pg.waitForTimeout(2200); const tB = await pg.textContent('#timeVal');
  ok(tA === tB, `一時停止中に時間が進んだ ${tA} → ${tB}`);
  // 一時停止中のウォッチの着いたは無視
  await pg.evaluate((at) => window.koeArrive(at, 0), Date.now());
  ok(Object.keys((await st()).rec).length === 0, '一時停止中の着いたが記録された');
  // 再開
  await hold('#setBtn', 1000); await pg.click('#pauseBtn'); await pg.waitForTimeout(100);
  const r2 = await st(); const m2 = await last();
  const paused = r2.start - r0.start;
  ok(!r2.pausedAt && paused >= 2000, '再開でスタート時刻が止めた分ずれていない: ' + paused);
  ok(m2.race === m0.race && m2.race === r0.start, '再開で別のレース扱いになっている');
  ok(m2.items.length === m0.items.length && m2.items.every((x, i) => x.ms === m0.items[i].ms && x.point === i), '再開後の予定（スタートからの時間）が変わった');
  ok(m2.start === r2.start, 'アプリに新しいスタート時刻が渡っていない');
  ok(JSON.stringify(r2.times) === JSON.stringify(r0.times), '再開で予定時刻が変わった');
  // 通知の「着いた」は、その通知の地点として記録（予定よりかなり遅れても）
  const it = m2.items; const late = (it[1].ms - it[0].ms) * 0.8; // 次の地点との中間を大きく過ぎた遅れ
  await pg.evaluate(([at, pi]) => window.koeArrive(at, pi), [r2.start + it[0].ms + late, 0]);
  const r3 = await st();
  ok(r3.rec[0] && Math.abs(r3.rec[0].diff - late / 1000) < 0.01 && !r3.rec[1], '大きく遅れた着いたが通知の地点（1つ目）に記録されない: ' + JSON.stringify(r3.rec));
  await b.close();
  console.log(`チェック ${checks}件、失敗 ${fails}件`); process.exit(fails ? 1 : 0);
})();
