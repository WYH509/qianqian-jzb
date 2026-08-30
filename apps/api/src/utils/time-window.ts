// 时段策略（PRD §1.7 闲时段总纲 + §6.5.4 Step 1 + §9.8.2 + §9.9.2）
// 工作日闲时段：00:00-09:00 / 12:00-14:00 / 18:00-24:00（共 17h/天）
// 工作日高峰期：09:00-12:00 / 14:00-18:00（共 7h/天）
// 周末（周六/日）全天 24h 闲时段

export interface TimeWindow {
  isOffPeak: boolean;
  window: 'offpeak' | 'peak' | 'weekend';
  nextOffPeakAt: number; // ms timestamp
}

const WEEKDAY_PEAK_HOURS: ReadonlyArray<readonly [number, number]> = [
  [9, 12], // 09:00-12:00
  [14, 18], // 14:00-18:00
];

/**
 * 判断当前是否 DeepSeek 可直接调用的时段
 * @param now 可选的时间戳（ms），默认 Date.now()，便于测试
 */
export function getTimeWindow(now: number = Date.now()): TimeWindow {
  const d = new Date(now);
  const day = d.getDay(); // 0=周日, 6=周六
  const hour = d.getHours();
  const minute = d.getMinutes();

  // 周末全天闲时段
  if (day === 0 || day === 6) {
    return {
      isOffPeak: true,
      window: 'weekend',
      nextOffPeakAt: now,
    };
  }

  // 工作日
  const currentMinutes = hour * 60 + minute;
  for (const slot of WEEKDAY_PEAK_HOURS) {
    const startH = slot[0];
    const endH = slot[1];
    if (startH === undefined || endH === undefined) continue;
    const startMin = startH * 60;
    const endMin = endH * 60;
    if (currentMinutes >= startMin && currentMinutes < endMin) {
      // 在高峰期：返回下一个闲时段起点
      const nextStartMin = endMin; // 当前峰段结束后立刻是闲时段
      const nextOffPeak = new Date(d);
      nextOffPeak.setHours(Math.floor(nextStartMin / 60), nextStartMin % 60, 0, 0);
      return {
        isOffPeak: false,
        window: 'peak',
        nextOffPeakAt: nextOffPeak.getTime(),
      };
    }
  }

  // 工作日闲时段
  return {
    isOffPeak: true,
    window: 'offpeak',
    nextOffPeakAt: now,
  };
}

export function isOffPeak(now: number = Date.now()): boolean {
  return getTimeWindow(now).isOffPeak;
}

export function formatHour(timestamp: number): string {
  return new Date(timestamp).toISOString();
}