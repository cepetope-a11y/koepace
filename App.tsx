// コエペース：アプリ確認用の試作（ロック中でも予定時刻に声が鳴るか、電池がどれだけ減るかを確かめる）
import { useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { createAudioPlayer, setAudioModeAsync, AudioPlayer } from 'expo-audio';
import * as Speech from 'expo-speech';
import * as Battery from 'expo-battery';

type LogItem = { no: number; planned: number; actual: number; battery: number | null };

const INTERVALS = [1, 3, 5];

function fmt(sec: number) {
  const s = Math.max(0, Math.round(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const r = s % 60;
  const mm = h > 0 && m < 10 ? `0${m}` : `${m}`;
  const rr = r < 10 ? `0${r}` : `${r}`;
  return h > 0 ? `${h}:${mm}:${rr}` : `${mm}:${rr}`;
}

export default function App() {
  const [intervalMin, setIntervalMin] = useState(1);
  const [running, setRunning] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [log, setLog] = useState<LogItem[]>([]);
  const [startBattery, setStartBattery] = useState<number | null>(null);

  const startAt = useRef(0);
  const nextNo = useRef(1);
  const player = useRef<AudioPlayer | null>(null);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    return () => stop();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  async function start() {
    // 画面が消えても動き続けるよう、ほぼ無音の音をくり返し流し、ロック画面の操作を有効にする
    await setAudioModeAsync({ playsInSilentMode: true, shouldPlayInBackground: true, interruptionMode: 'doNotMix' });
    const p = createAudioPlayer(require('./assets/silence.wav'));
    p.loop = true;
    p.volume = 0.05;
    p.play();
    p.setActiveForLockScreen(true, { title: 'コエペース 計測中', artist: 'ロック中の読み上げテスト' }, { isLiveStream: true });
    player.current = p;

    const level = await Battery.getBatteryLevelAsync();
    setStartBattery(level);
    setLog([]);
    nextNo.current = 1;
    startAt.current = Date.now();
    setRunning(true);
    Speech.speak('計測を始めました。画面を消して、ポケットに入れてください。', { language: 'ja-JP' });

    timer.current = setInterval(tick, 1000);
  }

  async function tick() {
    const t = Date.now();
    setNow(t);
    const plannedSec = nextNo.current * intervalRef.current * 60;
    const elapsed = (t - startAt.current) / 1000;
    if (elapsed >= plannedSec) {
      const no = nextNo.current;
      nextNo.current += 1;
      Speech.speak(`${no * intervalRef.current}分、予定地点です。`, { language: 'ja-JP' });
      let b: number | null = null;
      try { b = await Battery.getBatteryLevelAsync(); } catch { b = null; }
      setLog((prev) => [{ no, planned: plannedSec, actual: elapsed, battery: b }, ...prev]);
    }
  }

  // setInterval の中から最新の間隔を読むため
  const intervalRef = useRef(intervalMin);
  useEffect(() => { intervalRef.current = intervalMin; }, [intervalMin]);

  function stop() {
    if (timer.current) clearInterval(timer.current);
    timer.current = null;
    try {
      player.current?.clearLockScreenControls();
      player.current?.pause();
      player.current?.remove();
    } catch {}
    player.current = null;
    Speech.stop();
    setRunning(false);
  }

  const elapsed = running ? (now - startAt.current) / 1000 : 0;
  const lastBattery = log.length ? log[0].battery : null;
  const used = startBattery != null && lastBattery != null ? (startBattery - lastBattery) * 100 : null;
  const hours = log.length ? log[0].actual / 3600 : 0;
  const maxLate = log.reduce((m, l) => Math.max(m, l.actual - l.planned), 0);

  return (
    <View style={styles.root}>
      <StatusBar style="light" />
      <ScrollView contentContainerStyle={styles.wrap}>
        <Text style={styles.eyebrow}>APP TEST v0.1</Text>
        <Text style={styles.h1}>ロック中の読み上げテスト</Text>
        <Text style={styles.sub}>
          スタートしたら画面を消してポケットへ。決めた間隔ごとに「◯分、予定地点です」と鳴るか、遅れや電池の減り方を記録します。
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
          <Text style={styles.line}>
            電池：{startBattery != null ? `${Math.round(startBattery * 100)}%` : '-'} →{' '}
            {lastBattery != null ? `${Math.round(lastBattery * 100)}%` : '-'}
            {used != null && hours > 0 ? `（1時間あたり約${(used / hours).toFixed(1)}%）` : ''}
          </Text>
        </View>

        <View style={styles.card}>
          <Text style={styles.cardTitle}>記録</Text>
          {log.length === 0 && <Text style={styles.line}>まだありません</Text>}
          {log.map((l) => (
            <Text key={l.no} style={styles.line}>
              {l.no}回目 予定 {fmt(l.planned)} / 実際 {fmt(l.actual)}（{(l.actual - l.planned).toFixed(1)}秒遅れ）
              {l.battery != null ? ` 電池${Math.round(l.battery * 100)}%` : ''}
            </Text>
          ))}
        </View>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
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
