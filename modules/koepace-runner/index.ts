import { requireOptionalNativeModule } from 'expo';

export type RunnerLogItem = {
  no: number;
  plannedMs: number;
  actualMs: number;
  battery: number;
  focus: boolean;
};

type RunnerModule = {
  start(opts: {
    startAt: number;
    offsets: number[];
    texts: string[];
    titles: string[];
    bodies: string[];
    voice: boolean;
    notify: boolean;
    raceId: number;
    points: number[];
    chime: boolean;
  }): void;
  /** [押された時刻(ms), 予定地点の番号] の一覧 */
  takeArrivals(): [number, number][];
  stop(): void;
  speak(text: string, chime: boolean): void;
  setShowWhenLocked(on: boolean): void;
  isIgnoringBatteryOptimizations(): boolean;
  openBatterySettings(): void;
  isRunning(): boolean;
  getStartAt(): number;
  getLog(): RunnerLogItem[];
  getBattery(): number;
};

// 見つからなくてもアプリを落とさず、画面に「見つからない」と出せるようにする
const Runner = requireOptionalNativeModule<RunnerModule>('KoepaceRunner');
export default Runner;
