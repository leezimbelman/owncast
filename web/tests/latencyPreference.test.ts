import {
  LATENCY_COMPENSATION_ENABLED,
  readLatencyPreference,
  writeLatencyPreference,
} from '../components/video/player/latencyPreference';

describe('latencyPreference', () => {
  beforeEach(() => localStorage.clear());

  test('keeps the historical storage key', () => {
    expect(LATENCY_COMPENSATION_ENABLED).toBe('latencyCompensatorEnabled');
  });

  test('defaults to off', () => {
    expect(readLatencyPreference()).toBe(false);
  });

  test('round-trips on and off', () => {
    writeLatencyPreference(true);
    expect(localStorage.getItem(LATENCY_COMPENSATION_ENABLED)).toBe('true');
    expect(readLatencyPreference()).toBe(true);
    writeLatencyPreference(false);
    expect(readLatencyPreference()).toBe(false);
  });
});
