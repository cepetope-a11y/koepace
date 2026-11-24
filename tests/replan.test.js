// レース中の目標変更（組み直し）の自動チェック
const fs = require('fs'), path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
function grab(a, b) { const i = html.indexOf(a), j = html.indexOf(b, i); return html.slice(i, j); }
const fnSrc = grab('  function lastRecorded(){', '\n  async function keepAwake') + '\n' +
  grab('  function anchor(){', '  function openChange(){');
let fails = 0, checks = 0;
const ok = (c, m) => { checks++; if (!c) { fails++; if (fails < 30) console.log('NG:', m); } };

function race(km, goal, interval) {
  const edges = []; for (let k = interval; k < km - 0.01; k += interval) edges.push(Math.round(k * 1000) / 1000); edges.push(km);
  return { km, goal, edges, times: edges.map(e => goal / km * e), rec: {}, replanIdx: null };
}
for (const [km, goal, interval] of [[42.195, 14400, 5], [42.195, 18000, 1], [21.0975, 7200, 3], [10, 3000, 1], [100, 43200, 5], [120, 50400, 1], [200, 172000, 5]]) {
  for (const late of [-120, 0, 30, 300, 900]) {
    for (const frac of [0.1, 0.3, 0.5, 0.8, 0.95]) {
      for (const recordLast of [false, true]) {
        for (const newGoalDelta of [-600, -300, 300, 600, 1200]) {
          const R = race(km, goal, interval);
          const t = goal * frac + late;
          // 過ぎた地点のうち最後の地点で「遅れ」を申告したことにする
          let li = -1; R.times.forEach((x, i) => { if (x + late <= t) li = i; });
          if (recordLast && li >= 0) R.rec[li] = { t: R.times[li] + late, diff: late };
          const f = new Function('R', 'elapsed', fnSrc + '\nreturn {anchor:anchor, replanTimes:replanTimes};')(R, () => t);
          const a = f.anchor();
          const ng = goal + newGoalDelta;
          if (ng <= a.t + (km - a.km) * 120) continue; // 画面側で止められる範囲（2分/km未満）は対象外
          const nt = f.replanTimes(ng);
          const tag = `${km}km 目標${goal} 遅れ${late} 経過${(frac*100)|0}% 申告${recordLast} 変更${newGoalDelta}`;
          ok(Math.abs(nt[nt.length - 1] - ng) < 1e-6, tag + ` ゴールが新しい目標にならない ${nt[nt.length-1]} vs ${ng}`);
          for (let i = 1; i < nt.length; i++) ok(nt[i] > nt[i - 1], tag + ` 組み直し後の予定が増えていない(${i})`);
          R.edges.forEach((e, i) => { if (e <= a.km) ok(nt[i] === R.times[i], tag + ` 過ぎた地点の予定が変わった(${i})`); });
          // 起点より先は同じペース
          const fut = R.edges.map((e, i) => [e, nt[i]]).filter(([e]) => e > a.km);
          for (let i = 1; i < fut.length; i++) { const p1 = (fut[i][1] - fut[i-1][1]) / (fut[i][0] - fut[i-1][0]); const p0 = (ng - a.t) / (km - a.km); ok(Math.abs(p1 - p0) < 1e-6, tag + ' この先のペースが一定でない'); }
          // 起点は「今」を越えない（未来の地点を起点にしない）
          ok(a.km === 0 || R.edges.indexOf(a.km) >= 0, tag + ' 起点が地点にない');
          if (!recordLast) ok(a.t <= t + 1e-6, tag + ' 起点の時刻が今より先');
        }
      }
    }
  }
}
console.log(`チェック ${checks}件、失敗 ${fails}件`);
process.exit(fails ? 1 : 0);
