export interface PerformanceSample {
  name: string;
  value: number;
  unit: 'ms' | 'bytes' | 'count';
  detail?: Record<string, string | number | boolean>;
}
export interface BenchmarkApi {
  firstNodeCenter(): { x: number; y: number } | null;
  setCamera(camera: { x: number; y: number; zoom: number }): void;
}

type BenchmarkWindow = Window & {
  __DRAW_BENCHMARK_ENABLED__?: boolean;
  __DRAW_BENCHMARK_RESPONSE_BYTES__?: boolean;
  __DRAW_BENCHMARK_SAMPLES__?: PerformanceSample[];
  __DRAW_BENCHMARK_API__?: BenchmarkApi;
};

export function benchmarkEnabled(): boolean {
  return typeof window !== 'undefined' && Boolean((window as BenchmarkWindow).__DRAW_BENCHMARK_ENABLED__);
}

export function responseByteAccountingEnabled(): boolean {
  return benchmarkEnabled() && (window as BenchmarkWindow).__DRAW_BENCHMARK_RESPONSE_BYTES__ !== false;
}

export function recordPerformance(sample: PerformanceSample): void {
  if (!benchmarkEnabled()) return;
  const target = window as BenchmarkWindow;
  (target.__DRAW_BENCHMARK_SAMPLES__ ??= []).push(sample);
  window.dispatchEvent(new CustomEvent('draw:performance', { detail: sample }));
}
