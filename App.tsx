// コエペース：アプリ確認用の試作（ロック中でも予定時刻に声が鳴るか、電池がどれだけ減るかを確かめる）
// v0.3：読み上げと時計をAndroidの常駐サービス（modules/koepace-runner）に移した
import { useEffect, useRef, useState } from 'react';
import { AppState, PermissionsAndroid, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Runner, { RunnerLogItem } from './modules/koepace-runner';

const INTERVALS = [1, 3, 5];
const MAX_MIN = 6 * 60; // 6時間ぶんの予定を渡す

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`;
  const rr = r < 10 ? `0${r}` : `${r}`;
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

async function askNotification() {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    } catch {}
  }
}

export default function App() {
  const [intervalMin, setIntervalMin] = useState(1);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [log, setLog] = useState<RunnerLogItem[]>([]);
  const [startBattery, setStartBattery] = useState<number | null>(null);
  const [error, setError] = useState('');
  const startAt = useRef(0);

  function refresh() {
    if (!Runner) { setError('裏で動く部分（KoepaceRunner）がアプリに入っていません'); return; }
    try {
      const r = Runner.isRunning();
      setRunning(r);
      if (r) startAt.current = Runner.getStartAt();
      setLog(Runner.getLog());
    } catch (e) {
      setError(String(e));
    }
    setNow(Date.now());
  }

  // 画面を開いたとき・戻ってきたときに、サービスの記録を読み直す
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, 1000);
    const s = AppState.addEventListener('change', (st) => { if (st === 'active') refresh(); });
    return () => { clearInterval(t); s.remove(); };
  }, []);

  async function start() {
    if (!Runner) return;
    setError('');
    await askNotification();
    const offsets: number[] = [];
    const texts: string[] = [];
    for (let m = intervalMin; m <= MAX_MIN; m += intervalMin) {
      offsets.push(m * 60 * 1000);
      texts.push(`${m}分、予定地点です。`);
    }
    try {
      setStartBattery(Runner.getBattery());
      const t = Date.now();
      startAt.current = t;
      Runner.start(t, offsets, texts);
      setLog([]);
      setRunning(true);
    } catch (e) {
      setError(String(e));
    }
  }

  function stop() {
    if (!Runner) return;
    try { Runner.stop(); setLog(Runner.getLog()); } catch (e) { setError(String(e)); }
    setRunning(false);
  }

  const elapsed = running ? (now - startAt.current) / 1000 : 0;
  const last = log.length ? log[log.length - 1] : null;
  const lastBattery = last ? last.battery : null;
  const used = startBattery != null && startBattery >= 0 && lastBattery != null && lastBattery >= 0 ? startBattery - lastBattery : null;
  const hours = last ? last.actualMs / 3600000 : 0;
  const maxLate = log.reduce((m, l) => Math.max(m, (l.actualMs - l.plannedMs) / 1000), 0);
  const noFocus = log.filter((l) => !l.focus).length;
  const shown = [...log].reverse();

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.eyebrow}>APP TEST v0.3.2</Text>
        <Text style={styles.h1}>ロック中の読み上げテスト</Text>
        <Text style={styles.sub}>
          スタートしたら画面を消してポケットへ。音楽を聴きながらでもOK。決めた間隔ごとに「◯分、予定地点です」と鳴るか、遅れや電池の減り方を記録します。
        </Text>

        <Text style={styles.label}>読み上げの間隔</Text>
        <View style={styles.row}>
          {INTERVALS.map((m) => (
            <Pressable
              key={m}
              disabled={running}
              onPress={() => setIntervalMin(m)}
              style={[styles.pill, intervalMin === m && styles.pillOn, running && styles.dim]}
              accessibilityRole="button"
              accessibilityState={{ selected: intervalMin === m }}
            >
              <Text style={[styles.pillText, intervalMin === m && styles.pillTextOn]}>{m}分ごと</Text>
            </Pressable>
          ))}
        </View>

        <Text style={styles.time}>{fmt(elapsed)}</Text>

        {running ? (
          <Pressable onPress={stop} style={[styles.big, styles.stop]} accessibilityRole="button">
            <Text style={styles.bigText}>終了</Text>
          </Pressable>
        ) : (
          <Pressable onPress={start} style={styles.big} accessibilityRole="button">
            <Text style={styles.bigText}>スタート</Text>
          </Pressable>
        )}

        <View style={styles.card}>
          <Text style={styles.cardTitle}>結果</Text>
          <Text style={styles.line}>読み上げ回数：{log.length}回</Text>
          <Text style={styles.line}>いちばん遅れた読み上げ：{log.length ? `${maxLate.toFixed(1)}秒` : '-'}</Text>
          <Text style={styles.line}>音楽の音量を下げられなかった回数：{log.length ? `${noFocus}回` : '-'}</Text>
          <Text style={styles.line}>
            電池：{startBattery != null && startBattery >= 0 ? `${startBattery}%` : '-'} →{' '}
            {lastBattery != null && lastBattery >= 0 ? `${lastBattery}%` : '-'}
            {used != null && hours > 0 ? `（1時間あたり約${(used / hours).toFixed(1)}%）` : ''}
          </Text>
          {error !== '' && <Text style={[styles.line, styles.err]}>エラー：{error}</Text>}
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>記録</Text>
          {log.length === 0 && <Text style={styles.line}>まだありません</Text>}
          {shown.map((l) => (
            <Text key={l.no} style={styles.line}>
              {l.no}回目 予定 {fmt(l.plannedMs / 1000)} / 実際 {fmt(l.actualMs / 1000)}（{((l.actualMs - l.plannedMs) / 1000).toFixed(1)}秒遅れ）
              {l.battery >= 0 ? ` 電池${l.battery}%` : ''}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  err: { color: '#FCA5A5' },
  root: { flex: 1, backgroundColor: '#111827' },
  wrap: { padding: 20, paddingTop: 56, gap: 12 },
  eyebrow: { color: '#FDBA74', fontSize: 12, fontWeight: '700', letterSpacing: 1 },
  h1: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  sub: { color: '#D1D5DB', fontSize: 14, lineHeight: 22 },
  label: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', marginTop: 8 },
  row: { flexDirection: 'row', gap: 8 },
  pill: { flex: 1, minHeight: 48, borderRadius: 12, borderWidth: 2, borderColor: '#374151', alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: '#FFFFFF', borderColor: '#FFFFFF' },
  pillText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  pillTextOn: { color: '#111827' },
  dim: { opacity: 0.5 },
  time: { color: '#FFFFFF', fontSize: 64, fontWeight: '700', textAlign: 'center', marginVertical: 8 },
  big: { minHeight: 72, borderRadius: 36, backgroundColor: '#15803D', alignItems: 'center', justifyContent: 'center' },
  stop: { backgroundColor: '#991B1B' },
  bigText: { color: '#FFFFFF', fontSize: 24, fontWeight: '900' },
  card: { backgroundColor: '#1F2937', borderRadius: 16, padding: 14, gap: 6 },
  cardTitle: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
  line: { color: '#D1D5DB', fontSize: 13, lineHeight: 20 },
});
