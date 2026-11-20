import { requireNativeModule } from 'expo';

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
  isRunning(): boolean;
  getStartAt(): number;
  getLog(): RunnerLogItem[];
  getBattery(): number;
};

export default requireNativeModule<RunnerModule>('KoepaceRunner');
