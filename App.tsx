// コエペース：ウェブ試作と同じ画面をアプリの中で表示し、読み上げだけをアプリの常駐サービスに任せる
// 画面（設定・走行・結果）は web/index.html。読み上げと時計は modules/koepace-runner（画面が消えても動く）
import { useEffect, useRef, useState } from 'react';
import { AppState, BackHandler, PermissionsAndroid, useColorScheme, Platform, Pressable, StyleSheet, Text, View } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { SafeAreaProvider, useSafeAreaInsets } from 'react-native-safe-area-context';
import { WebView, WebViewMessageEvent } from 'react-native-webview';
import Runner from './modules/koepace-runner';
import { PAGE_HTML } from './web/page';

type ScheduleMsg = {
  type: 'schedule';
  running: boolean;
  voice?: boolean;
  lock?: boolean;
  notify?: boolean;
  chime?: boolean;
  lang?: string;
  start?: number;
  race?: number;
  items?: { ms: number; text: string; title?: string; body?: string; point?: number }[];
};
type SayMsg = { type: 'say'; text: string; chime?: boolean };
type ThemeMsg = { type: 'theme'; dark: boolean };
type UiMsg = { type: 'battery' } | { type: 'sheet'; open: boolean } | { type: 'lang'; lang: string };

async function askNotification() {
  if (Platform.OS === 'android' && Number(Platform.Version) >= 33) {
    try {
      await PermissionsAndroid.request(PermissionsAndroid.PERMISSIONS.POST_NOTIFICATIONS);
    } catch {}
  }
}

function Main() {
  const insets = useSafeAreaInsets();
  const [batteryTip, setBatteryTip] = useState(false);
  const [dark, setDark] = useState(useColorScheme() === 'dark');
  const [en, setEn] = useState(false);
  const [error, setError] = useState(Runner ? '' : '裏で動く部分（KoepaceRunner）がアプリに入っていません');
  const asked = useRef(false);
  const sheetOpen = useRef(false);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  const web = useRef<any>(null);

  // ウォッチ・通知の「着いた」を画面（記録）に渡す
  useEffect(() => {
    function pull() {
      if (!Runner) return;
      try {
        const list = Runner.takeArrivals();
        list.forEach(([at, pt]) => web.current?.injectJavaScript(`window.koeArrive&&window.koeArrive(${at},${pt});true;`));
      } catch {}
    }
    const t = setInterval(pull, 1000);
    const s = AppState.addEventListener('change', (st) => { if (st === 'active') pull(); });
    return () => { clearInterval(t); s.remove(); };
  }, []);

  // 戻るボタン：設定（⚙）が開いていれば閉じる
  useEffect(() => {
    const h = BackHandler.addEventListener('hardwareBackPress', () => {
      if (!sheetOpen.current) return false;
      web.current?.injectJavaScript('window.koeBack&&window.koeBack();true;');
      return true;
    });
    return () => h.remove();
  }, []);

  useEffect(() => {
    try {
      if (Runner && !Runner.isIgnoringBatteryOptimizations()) setBatteryTip(true);
    } catch {}
  }, []);

  async function onMessage(e: WebViewMessageEvent) {
    if (!Runner) return;
    let m: ScheduleMsg | SayMsg | ThemeMsg | UiMsg;
    try {
      m = JSON.parse(e.nativeEvent.data);
    } catch {
      return;
    }
    try {
      if (m.type === 'sheet') {
        sheetOpen.current = !!m.open;
        return;
      }
      if (m.type === 'lang') {
        setEn(m.lang === 'en');
        Runner.setLang(m.lang === 'en' ? 'en' : 'ja');
        return;
      }
      if (m.type === 'battery') {
        Runner.openBatterySettings();
        return;
      }
      if (m.type === 'theme') {
        setDark(!!m.dark);
        return;
      }
      if (m.type === 'say') {
        Runner.speak(m.text, !!m.chime);
      } else if (m.type === 'schedule') {
        Runner.setShowWhenLocked(!!(m.running && m.lock));
        if (m.running && (m.voice || m.notify) && m.start && m.items) {
          if (!asked.current) {
            asked.current = true;
            await askNotification();
          }
          Runner.start({
            startAt: m.start,
            offsets: m.items.map((i) => i.ms),
            texts: m.items.map((i) => i.text),
            titles: m.items.map((i) => i.title ?? i.text),
            bodies: m.items.map((i) => i.body ?? ''),
            voice: !!m.voice,
            notify: m.notify !== false,
            raceId: m.race ?? m.start,
            points: m.items.map((i) => i.point ?? -1),
            chime: m.chime !== false,
            lang: m.lang === 'en' ? 'en' : 'ja',
          });
        } else {
          Runner.stop();
        }
      }
    } catch (err) {
      setError(String(err));
    }
  }

  return (
    <View style={[styles.root, { paddingTop: insets.top, paddingBottom: insets.bottom, backgroundColor: dark ? '#0B1220' : '#E6E3DE' }]}>
      <StatusBar style={dark ? 'light' : 'dark'} />
      {error !== '' && <Text style={styles.err}>エラー：{error}</Text>}
      {batteryTip && (
        <View style={styles.tip}>
          <Text style={styles.tipText}>
            {en
              ? 'To keep calls going with the screen off, open App info → Battery and choose "Unrestricted".'
              : '画面を消しても止まらないように、アプリ情報の「バッテリー（電池）」で「制限なし」を選んでください。'}
          </Text>
          <View style={styles.tipRow}>
            <Pressable
              style={styles.tipBtn}
              accessibilityRole="button"
              onPress={() => {
                try { Runner?.openBatterySettings(); } catch {}
                setBatteryTip(false);
              }}
            >
              <Text style={styles.tipBtnText}>{en ? 'Settings' : '設定する'}</Text>
            </Pressable>
            <Pressable style={styles.tipLater} accessibilityRole="button" onPress={() => setBatteryTip(false)}>
              <Text style={styles.tipLaterText}>{en ? 'Later' : 'あとで'}</Text>
            </Pressable>
          </View>
        </View>
      )}
      <WebView
        ref={web}
        style={styles.web}
        source={{ html: PAGE_HTML, baseUrl: 'https://koepace.local/' }}
        originWhitelist={['*']}
        javaScriptEnabled
        domStorageEnabled
        onMessage={onMessage}
        textZoom={100}
        overScrollMode="never"
        setSupportMultipleWindows={false}
      />
    </View>
  );
}

export default function App() {
  return (
    <SafeAreaProvider>
      <Main />
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#111827' },
  web: { flex: 1, backgroundColor: 'transparent' },
  err: { color: '#FCA5A5', padding: 12, fontSize: 14 },
  tip: { backgroundColor: '#1F2937', padding: 12, gap: 8 },
  tipText: { color: '#FFFFFF', fontSize: 14, lineHeight: 20 },
  tipRow: { flexDirection: 'row', gap: 8 },
  tipBtn: { backgroundColor: '#FFFFFF', borderRadius: 10, paddingHorizontal: 16, minHeight: 44, justifyContent: 'center' },
  tipBtnText: { color: '#111827', fontWeight: '700', fontSize: 15 },
  tipLater: { paddingHorizontal: 12, minHeight: 44, justifyContent: 'center' },
  tipLaterText: { color: '#D1D5DB', fontSize: 15 },
});
