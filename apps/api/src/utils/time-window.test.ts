// utils/time-window.ts 单元测试（PRD §1.7 闲时段总纲）
import { describe, it, expect } from 'vitest';
import { getTimeWindow, isOffPeak, formatHour } from './time-window.js';

describe('getTimeWindow / isOffPeak', () => {
  // 2026-09-05 是周六；09-06 周日；09-07 周一 … 09-11 周五
  it('周末全天闲时段（window=weekend）', () => {
    const sat = new Date(2026, 8, 5, 14, 30).getTime(); // 周六 14:30
    const win = getTimeWindow(sat);
    expect(win.window).toBe('weekend');
    expect(win.isOffPeak).toBe(true);
    expect(isOffPeak(sat)).toBe(true);
  });

  it('工作日早上闲时段（00:00-09:00）', () => {
    const t = new Date(2026, 8, 7, 8, 59).getTime(); // 周一 08:59
    const win = getTimeWindow(t);
    expect(win.window).toBe('offpeak');
    expect(win.isOffPeak).toBe(true);
  });

  it('工作日午间闲时段（12:00-14:00）', () => {
    const t = new Date(2026, 8, 7, 13, 0).getTime();
    expect(getTimeWindow(t).isOffPeak).toBe(true);
  });

  it('工作日晚上闲时段（18:00-24:00）', () => {
    const t = new Date(2026, 8, 7, 19, 30).getTime();
    expect(getTimeWindow(t).isOffPeak).toBe(true);
  });

  it('工作日早上高峰（09:00-12:00）→ nextOffPeakAt=12:00', () => {
    const t = new Date(2026, 8, 7, 9, 30).getTime(); // 周一 09:30
    const win = getTimeWindow(t);
    expect(win.window).toBe('peak');
    expect(win.isOffPeak).toBe(false);
    const next = new Date(win.nextOffPeakAt);
    expect(next.getHours()).toBe(12);
    expect(next.getMinutes()).toBe(0);
  });

  it('工作日下午高峰（14:00-18:00）→ nextOffPeakAt=18:00', () => {
    const t = new Date(2026, 8, 7, 14, 30).getTime();
    const win = getTimeWindow(t);
    expect(win.isOffPeak).toBe(false);
    const next = new Date(win.nextOffPeakAt);
    expect(next.getHours()).toBe(18);
  });

  it('边界：恰好 12:00 与 18:00 属闲时段', () => {
    expect(getTimeWindow(new Date(2026, 8, 7, 12, 0).getTime()).isOffPeak).toBe(true);
    expect(getTimeWindow(new Date(2026, 8, 7, 18, 0).getTime()).isOffPeak).toBe(true);
  });
});

describe('formatHour', () => {
  it('返回 ISO 字符串', () => {
    expect(formatHour(0)).toBe(new Date(0).toISOString());
  });
});
