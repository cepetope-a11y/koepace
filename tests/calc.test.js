// ペース計算の自動チェック：web/index.html の計算部分をそのまま取り出して、たくさんの条件で確かめる
// 使い方：node tests/calc.test.js
const fs = require('fs');
const path = require('path');
const html = fs.readFileSync(path.join(__dirname, '..', 'web', 'index.html'), 'utf8');
function grab(start, end) { const i = html.indexOf(start); const j = html.indexOf(end, i); if (i < 0 || j < 0) throw new Error('見つからない: ' + start); return html.slice(i, j); }
const src = grab('  var DISTS=', '  var R=null;') + grab('  function kmLabel(', '\n') + '\n' +
  grab('  function dist(){', '  /* ---------- 声') +
  'return {S:S, DISTS:DISTS, plan:plan, segPlan:segPlan, kmSchedule:kmSchedule, clockAt:clockAt, gunStartMs:gunStartMs, setLang:function(l){LANG=l;}, dl:dl, dU:dU, dV:dV, pv:pv, MI:MI};';
const mk = () => new Function(src)();

let fails = 0, checks = 0;
function ok(cond, msg) { checks++; if (!cond) { fails++; if (fails <= 30) console.log('NG:', msg); } }
const EPS = 1e-6;

for (const id of ['full', 'half', '10k', 'custom']) {
  for (const customKm of (id === 'custom' ? [1, 3.3, 5, 7.5, 12.3, 30, 42.195, 50, 100, 120, 160.9, 200] : [0])) {
    for (const interval of [1, 2, 3, 5]) {
      for (const profile of ['even', 'neg', 'pos']) {
        for (const paceSec of [180, 240, 300, 360, 420, 480, 600, 900, 1200]) {
          for (const adjCase of [0, 1, 2]) {
            const m = mk(); const S = m.S;
            S.dist = id; S.customKm = customKm; S.interval = interval; S.profile = profile;
            const km = id === 'custom' ? customKm : m.DISTS.find(d => d.id === id).km;
            S.goal = Math.round(paceSec * km);
            S.adj = adjCase === 0 ? {} : adjCase === 1 ? { 0: 5, 2: -10 } : { 1: 15, 3: 5, 5: -5 };
            const p = m.plan(); const sp = p.seg;
            const tag = `${id} ${customKm||''}km 間隔${interval} ${profile} ${paceSec}s/km adj${adjCase}`;
            // 最後の地点は必ずゴール距離
            ok(Math.abs(p.edges[p.edges.length - 1] - km) < EPS, tag + ' 最後の地点がゴールでない');
            // 地点は増えていく・間隔は設定どおり（最後だけ短くてよい）
            for (let i = 0; i < p.edges.length; i++) {
              const prev = i ? p.edges[i - 1] : 0, gap = p.edges[i] - prev;
              ok(gap > 0.009, tag + ` 地点${i}の間隔が0以下`);
              if (i < p.edges.length - 1) ok(Math.abs(gap - interval) < 1e-6, tag + ` 地点${i}の間隔が${gap}`);
              else ok(gap <= interval + 1e-6, tag + ' 最後の間隔が長すぎる');
            }
            // 予定時刻は増えていく・ゴール時刻は計画の合計と一致
            for (let i = 0; i < p.times.length; i++) ok(p.times[i] > (i ? p.times[i - 1] : 0), tag + ` 予定時刻が増えていない(${i})`);
            ok(Math.abs(p.times[p.times.length - 1] - p.goal) < 1e-6, tag + ' ゴール時刻が合計と違う');
            // 区間の合計＝全体の距離
            ok(Math.abs(sp.lens.reduce((a, b) => a + b, 0) - km) < 1e-9, tag + ' 区間の合計距離が違う');
            // 調整なしなら、ゴールは目標どおり（どの配分でも）
            const clamped = sp.paces.some(x => x <= 120 + 1e-9);
            if (adjCase === 0 && !clamped) ok(Math.abs(p.goal - S.goal) < 1e-6, tag + ` 目標${S.goal}とゴール${p.goal}が違う`);
            // 調整ありなら、ゴールの差＝調整秒×区間の距離の合計
            if (adjCase > 0 && !clamped) {
              let exp = S.goal; for (const [k, v] of Object.entries(S.adj)) if (+k < sp.lens.length) exp += v * sp.lens[+k];
              ok(Math.abs(p.goal - exp) < 1e-6, tag + ` 調整後のゴール${p.goal}が期待${exp}と違う`);
            }
            // 均等なら、どの地点も 目標/距離×地点
            if (profile === 'even' && adjCase === 0) p.edges.forEach((e, i) => ok(Math.abs(p.times[i] - S.goal / km * e) < 1e-6, tag + ` 均等の予定時刻がずれる(${i})`));
            // 前半抑えめは後ろほど速く、前半貯金は後ろほど遅く
            if (adjCase === 0 && sp.paces.length > 1 && !clamped) for (let i = 1; i < sp.paces.length; i++) {
              if (profile === 'neg') ok(sp.paces[i] < sp.paces[i - 1], tag + ' 前半抑えめなのに後半が速くなっていない');
              if (profile === 'pos') ok(sp.paces[i] > sp.paces[i - 1], tag + ' 前半貯金なのに後半が遅くなっていない');
            }
            ok(p.times.every(Number.isFinite), tag + ' 数値でない時刻がある');
          }
        }
      }
    }
  }
}

// 1kmごとのタイムスケジュール：読み上げ間隔1kmの計画と同じ時刻になるか、ゴールは計画の合計か
for (const id of ['full', 'half', '10k', 'custom']) {
  for (const customKm of (id === 'custom' ? [1, 1.5, 3.3, 30, 42.195, 100, 120, 200] : [0])) {
    for (const profile of ['even', 'neg', 'pos']) {
      for (const paceSec of [180, 300, 420, 600, 1200]) {
        for (const adjCase of [0, 1]) {
          const m = mk(); const S = m.S;
          S.dist = id; S.customKm = customKm; S.profile = profile; S.interval = 5;
          const km = id === 'custom' ? customKm : m.DISTS.find(d => d.id === id).km;
          S.goal = Math.round(paceSec * km); S.adj = adjCase ? { 0: 10, 3: -5 } : {};
          const ks = m.kmSchedule(); const p5 = m.plan(); S.interval = 1; const p1 = m.plan();
          const tag = `スケジュール ${id} ${customKm||''}km ${profile} ${paceSec}s adj${adjCase}`;
          ok(ks.edges.length === p1.edges.length, tag + ' 地点の数が違う');
          for (let i = 0; i < ks.edges.length; i++) {
            ok(Math.abs(ks.edges[i] - p1.edges[i]) < 1e-9, tag + ` 地点${i}の距離が違う`);
            ok(Math.abs(ks.times[i] - p1.times[i]) < 1e-6, tag + ` 地点${i}の時刻が違う`);
            if (i) ok(ks.times[i] > ks.times[i - 1], tag + ` 時刻が増えていない${i}`);
          }
          ok(Math.abs(ks.times[ks.times.length - 1] - p5.goal) < 1e-6, tag + ' ゴールが計画の合計と違う');
          // 5kmごとの読み上げ地点は、1kmごとの表の時刻と一致
          p5.edges.forEach((e, j) => { const k = ks.edges.findIndex(x => Math.abs(x - e) < 1e-9); ok(k >= 0 && Math.abs(ks.times[k] - p5.times[j]) < 1e-6, tag + ` 読み上げ地点${e}kmが表と違う`); });
        }
      }
    }
  }
}
// 時刻の表示
{ const m = mk(); const b = new Date(2026, 10, 29, 9, 0, 0).getTime();
  ok(m.clockAt(b, 0, true) === '9:00:00', '時刻 0秒');
  ok(m.clockAt(b, 4 * 3600 + 5 * 60 + 30, true) === '13:05:30', '時刻 4:05:30後');
  ok(m.clockAt(b, 4 * 3600 + 5 * 60 + 30) === '13:05', '時刻 分まで');
  ok(m.clockAt(b, 15 * 3600) === '翌0:00', '時刻 日付またぎ');
  ok(m.clockAt(b, 40 * 3600) === '2日後 1:00', '時刻 2日後');
  ok(m.clockAt(new Date(2026, 10, 29, 5, 30).getTime(), 13 * 3600 + 59 * 60 + 59.6, true) === '19:30:00', '時刻 秒の四捨五入');
}
// 号砲の時刻からスタート：どの日の時刻とみなすか
{ const m = mk(); const T = (d, h, mi) => new Date(2026, 10, d, h, mi, 0).getTime(); const H = 3600;
  ok(m.gunStartMs(T(29, 10, 0), '09:00', 4 * H) === T(29, 9, 0), '号砲 押し忘れ（1時間前）');
  ok(m.gunStartMs(T(29, 8, 20), '09:00', 4 * H) === T(29, 9, 0), '号砲 当日の予約');
  ok(m.gunStartMs(T(28, 23, 0), '06:00', 4 * H) === T(29, 6, 0), '号砲 前日の夜に翌朝を予約');
  ok(m.gunStartMs(T(28, 23, 0), '05:00', 14 * H) === T(29, 5, 0), '号砲 前日の夜にウルトラを予約');
  ok(m.gunStartMs(T(29, 20, 0), '05:00', 14 * H) === T(29, 5, 0), '号砲 ウルトラの途中（15時間前）');
  ok(m.gunStartMs(T(30, 3, 0), '22:00', 20 * H) === T(29, 22, 0), '号砲 夜スタートで日付をまたいだ');
  ok(m.gunStartMs(T(29, 9, 0), '09:00', 4 * H) === T(29, 9, 0), '号砲 ちょうど今');
  ok(m.gunStartMs(T(29, 9, 0), '', 4 * H) === null && m.gunStartMs(T(29, 9, 0), 'abc', 4 * H) === null, '号砲 未入力');
}
// 英語表示の時刻（日付またぎ）
{ const m = mk(); m.setLang('en'); const b = new Date(2026, 10, 29, 9, 0, 0).getTime();
  ok(m.clockAt(b, 4 * 3600 + 5 * 60 + 30, true) === '13:05:30', 'EN 時刻');
  ok(m.clockAt(b, 15 * 3600) === '0:00 (+1d)', 'EN 日付またぎ');
  ok(m.clockAt(b, 40 * 3600) === '1:00 (+2d)', 'EN 2日後');
}
// ===== マイル版：中の計算はkmのまま、読み上げる地点・表示だけマイル =====
{ const MI = 1.609344; let n0 = checks;
  const near = (a, b, e = 1e-6) => Math.abs(a - b) < e;
  for (const id of ['full', 'half', '10k', 'custom']) {
    for (const customMi of (id === 'custom' ? [1, 3.1, 5, 13.1, 26.2, 31.1, 50, 62.1, 100, 124] : [0])) {
      for (const interval of [1, 5]) {
        for (const profile of ['even', 'neg', 'pos']) {
          for (const paceMi of [300, 420, 480, 549, 600, 720, 900, 1200, 1800]) {
            for (const adjCase of [0, 1]) {
              const m = mk(); const S = m.S; S.unit = 'mi';
              S.dist = id; S.customKm = customMi * MI; S.interval = interval; S.profile = profile;
              const km = id === 'custom' ? S.customKm : m.DISTS.find(d => d.id === id).km;
              S.goal = Math.round(paceMi / MI * km); S.adj = adjCase ? { 0: 6, 2: -4 } : {};
              const p = m.plan(), sp = p.seg, tag = `mile ${id} ${customMi||''} iv${interval} ${profile} ${paceMi} adj${adjCase}`;
              // 読み上げる地点：interval マイルの倍数＋ゴール
              const exp = []; for (let n = 1; n * interval * MI < km - 0.01; n++) exp.push(n * interval * MI); exp.push(km);
              ok(p.edges.length === exp.length, tag + ` 地点の数 ${p.edges.length} vs ${exp.length}`);
              for (let i = 0; i < exp.length && i < p.edges.length; i++) ok(near(p.edges[i], exp[i], 1e-5), tag + ` 地点${i}の位置`);
              // ペース配分の区切り：5マイルごと
              const se = []; for (let n = 1; n * 5 * MI < km - 0.01; n++) se.push(n * 5 * MI); se.push(km);
              ok(sp.edges.length === se.length && sp.edges.every((e, i) => near(e, se[i], 1e-5)), tag + ' 区切りが5マイルごとでない');
              // 時刻：区間ペースを自前で積み上げた値と一致、増え続ける、ゴールは計画の合計
              const at = (k) => { let tt = 0, prev = 0; for (let i = 0; i < sp.edges.length; i++) { const e = Math.min(k, sp.edges[i]); if (e > prev) tt += (e - prev) * sp.paces[i]; prev = sp.edges[i]; if (k <= sp.edges[i]) break; } return tt; };
              for (let i = 0; i < p.edges.length; i++) { ok(near(p.times[i], at(p.edges[i]), 1e-4), tag + ` 地点${i}の時刻`); if (i) ok(p.times[i] > p.times[i - 1], tag + ' 時刻が増えていない'); }
              ok(near(p.times[p.times.length - 1], p.goal) && near(p.goal, sp.total), tag + ' ゴール');
              if (profile === 'even' && !adjCase) { ok(Math.abs(p.goal - S.goal) < 1e-6, tag + ' 均等で目標とずれる'); p.edges.forEach((e, i) => ok(near(p.times[i], S.goal * e / km, 1e-4), tag + ` 均等の地点${i}`)); }
              // 1マイルごとの表
              const ks = m.kmSchedule(); const e1 = []; for (let n = 1; n * MI < km - 0.01; n++) e1.push(n * MI); e1.push(km);
              ok(ks.edges.length === e1.length && ks.edges.every((e, i) => near(e, e1[i], 1e-5)), tag + ' 1マイルごとの表の地点');
              ks.edges.forEach((e, i) => ok(near(ks.times[i], at(e), 1e-4), tag + ` 表の時刻${i}`));
              // 表示のマイル数：1, 2, 3 … とゴール
              ok(m.dl(p.edges[0]) === String(interval) || p.edges.length === 1, tag + ' 最初の地点の表示 ' + m.dl(p.edges[0]));
            }
          }
        }
      }
    }
  }
  { const m = mk(); m.S.unit = 'mi';
    ok(m.dl(42.195) === '26.2' && m.dl(21.0975) === '13.1' && m.dl(10) === '6.2', 'mile 表示 フル26.2・ハーフ13.1・10K 6.2');
    ok(Math.round(m.pv(14400 / 42.195)) === 549, 'mile サブ4の平均ペース 9:09/mi');
    ok(m.dU(MI * 5) === '5マイル' && m.dV(MI) === '1マイル', 'mile 日本語の表示・読み上げ');
    m.setLang('en'); ok(m.dU(MI * 5) === '5 mi' && m.dV(MI) === '1 mile' && m.dV(MI * 2) === '2 miles', 'mile 英語の表示・読み上げ');
    m.S.unit = 'km'; ok(m.dV(5) === '5 K' && m.dU(5) === '5 km', 'km 英語の表示・読み上げ'); }
  console.log(`マイル版のチェック ${checks - n0}件`);
}
console.log(`チェック ${checks}件、失敗 ${fails}件`);
process.exit(fails ? 1 : 0);
