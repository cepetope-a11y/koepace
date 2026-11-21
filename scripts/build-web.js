// web/index.html（ウェブ試作と同じ画面）を、アプリに埋め込める形（web/page.ts）に変換する
// 使い方：npm run web
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
const out = '// 自動生成ファイル。直接編集せず、web/index.html を直してから npm run web を実行する\n' +
  'export const PAGE_HTML = ' + JSON.stringify(html) + ';\n';
fs.writeFileSync(path.join(__dirname, '..', 'web', 'page.ts'), out);
console.log('web/page.ts を更新しました（' + html.length + '文字）');
