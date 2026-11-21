import { requireOptionalNativeModule } from 'expo';

export type RunnerLogItem = {
  no: number;
  plannedMs: number;
  actualMs: number;
  battery: number;
  focus: boolean;
};

type RunnerModule = {
  start(startAtMs: number, offsetsMs: number[], texts: string[]): void;
  stop(): void;
  speak(text: string): void;
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
