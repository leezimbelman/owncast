import { getLocalStorage, setLocalStorage } from '../../../utils/localStorage';

// Storage key kept from the old latency compensator so an existing
// viewer's choice survives the player migration.
export const LATENCY_COMPENSATION_ENABLED = 'latencyCompensatorEnabled';

export function readLatencyPreference(): boolean {
  // Called from a useState initializer, which also runs during SSR.
  const saved =
    typeof window !== 'undefined' ? getLocalStorage(LATENCY_COMPENSATION_ENABLED) : null;
  return saved === 'true';
}

export function writeLatencyPreference(enabled: boolean): void {
  setLocalStorage(LATENCY_COMPENSATION_ENABLED, enabled ? 'true' : 'false');
}
