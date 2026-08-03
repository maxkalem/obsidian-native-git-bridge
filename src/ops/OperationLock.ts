import { STALE_LOCK_MS } from "../constants";
import type { OperationMarker } from "../types";

/**
 * Single-holder lock for mutating Git operations. Read-only operations
 * (status, history) do not take this lock. The current marker is persisted
 * device-locally by the caller (onChange) so a crash can be reconciled on the
 * next startup.
 */
export class OperationLock {
  private current: OperationMarker | null = null;

  constructor(private onChange?: (marker: OperationMarker | null) => void) {}

  get active(): OperationMarker | null {
    return this.current;
  }

  tryAcquire(id: string, action: string, now: number = Date.now()): boolean {
    if (this.current !== null) return false;
    this.current = { id, action, startedAt: now };
    this.onChange?.(this.current);
    return true;
  }

  release(id: string): boolean {
    if (this.current === null || this.current.id !== id) return false;
    this.current = null;
    this.onChange?.(null);
    return true;
  }

  /** Force-clear a stale lock (e.g. restored marker older than the threshold). */
  clearStale(now: number = Date.now(), maxAgeMs: number = STALE_LOCK_MS): boolean {
    if (this.current !== null && now - this.current.startedAt > maxAgeMs) {
      this.current = null;
      this.onChange?.(null);
      return true;
    }
    return false;
  }

  /** Restore a persisted marker after restart (before reconciliation). */
  restore(marker: OperationMarker): void {
    this.current = marker;
  }
}

export function isMarkerStale(
  marker: OperationMarker,
  now: number = Date.now(),
  maxAgeMs: number = STALE_LOCK_MS
): boolean {
  return now - marker.startedAt > maxAgeMs;
}
