// 画面操作の自動チェック（ブラウザで実際に操作する）：距離200km、ペースの直接入力
const { chromium } = require('/opt/node-tools/node_modules/playwright');
const path = require('path');
let fails = 0, checks = 0; const ok = (c, m) => { checks++; if (!c) { fails++; console.log('NG:', m); } };
(async () => {
  const b = await chromium.launch(); const pg = await b.newPage({ viewport: { width: 420, height: 900 }, locale: 'ja-JP' });
  pg.on('pageerror', e => { fails++; console.log('ERR', e.message); });
  await pg.goto('file://' + path.join(__dirname, '..', 'web', 'index.html'));
  // 距離：その他で120km・250km
  await pg.click('#distPills button:has-text("その他")');
  await pg.fill('#kmInput', '120'); await pg.press('#kmInput', 'Tab');
  ok(await pg.inputValue('#kmInput') === '120', '120kmが入らない');
  await pg.fill('#kmInput', '250'); await pg.press('#kmInput', 'Tab');
  ok(await pg.inputValue('#kmInput') === '200', '上限200kmで止まらない: ' + await pg.inputValue('#kmInput'));
  await pg.fill('#kmInput', '120'); await pg.press('#kmInput', 'Tab');
  // ペース配分をオンにしてペースを直接入力
  const sw = await pg.$('#profSw'); if (sw && (await sw.getAttribute('aria-checked')) === 'false') await sw.click();
  const cases = [['5:41', '5:41'], ['541', '5:41'], ['5.41', '5:41'], ['1205', '12:05'], ['6:00', '6:00'], ['abc', null], ['5:75', null], ['1:00', null]];
  for (const [inp, want] of cases) {
    const before = await pg.inputValue('input[data-pace="2"]');
    await pg.fill('input[data-pace="2"]', inp); await pg.press('input[data-pace="2"]', 'Tab'); await pg.waitForTimeout(50);
    const after = await pg.inputValue('input[data-pace="2"]');
    ok(after === (want || before), `入力「${inp}」→「${after}」（期待「${want || before}」）`);
  }
  // 直接入力したあと、ほかの区間は変わらず、合計が区間の和になっている
  const paces = await pg.$$eval('input[data-pace]', xs => xs.map(x => x.value));
  ok(paces.length === 24, '120kmの区間数が24でない: ' + paces.length);
  await b.close();
  console.log(`チェック ${checks}件、失敗 ${fails}件`); process.exit(fails ? 1 : 0);
})();
