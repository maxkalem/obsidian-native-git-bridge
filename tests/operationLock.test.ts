import { describe, expect, it } from "vitest";
import { OperationLock, isMarkerStale } from "../src/ops/OperationLock";

describe("OperationLock", () => {
  it("allows only one holder", () => {
    const lock = new OperationLock();
    expect(lock.tryAcquire("op1", "sync")).toBe(true);
    expect(lock.tryAcquire("op2", "pull")).toBe(false);
    expect(lock.release("op2")).toBe(false);
    expect(lock.release("op1")).toBe(true);
    expect(lock.tryAcquire("op2", "pull")).toBe(true);
  });

  it("notifies persistence hook on change", () => {
    const seen: (string | null)[] = [];
    const lock = new OperationLock((m) => seen.push(m ? m.id : null));
    lock.tryAcquire("op1", "sync");
    lock.release("op1");
    expect(seen).toEqual(["op1", null]);
  });

  it("clears stale locks only past the threshold", () => {
    const lock = new OperationLock();
    lock.tryAcquire("op1", "sync", 1000);
    expect(lock.clearStale(1000 + 60_000, 30 * 60_000)).toBe(false);
    expect(lock.active?.id).toBe("op1");
    expect(lock.clearStale(1000 + 31 * 60_000, 30 * 60_000)).toBe(true);
    expect(lock.active).toBeNull();
  });

  it("marker staleness helper", () => {
    expect(isMarkerStale({ id: "x", action: "sync", startedAt: 0 }, 10_000, 5000)).toBe(true);
    expect(isMarkerStale({ id: "x", action: "sync", startedAt: 0 }, 4000, 5000)).toBe(false);
  });
});
