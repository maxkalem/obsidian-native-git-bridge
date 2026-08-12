import { describe, expect, it } from "vitest";
import {
  DEFAULT_TIMEOUT_SECONDS,
  MIN_NETWORK_TIMEOUT_SECONDS,
  timeoutSecondsFor,
} from "../src/constants";

/**
 * One setting governed every action, and it was the network ones that paid.
 *
 * Seen on the device with the timeout at 10 s: a local `status` took 7 s and
 * staging one file took 8, so those scraped through, while every fetch, pull,
 * push and sync timed out — and what the user was shown was not "this took too
 * long" but a bridge check reporting the runtime folder healthy, which it was.
 * The runner had the request the whole time and finished it.
 *
 * A floor, not an override: raising the setting has to raise these too, and
 * cloning keeps its own much larger number.
 */
describe("timeoutSecondsFor", () => {
  it("gives a local action exactly what the setting says", () => {
    expect(timeoutSecondsFor("status", 30)).toBe(30);
    expect(timeoutSecondsFor("commit", 45)).toBe(45);
  });

  it("never lets a network action drop below the floor", () => {
    for (const a of ["fetch", "pull", "push", "sync"]) {
      expect(timeoutSecondsFor(a, 10)).toBe(MIN_NETWORK_TIMEOUT_SECONDS);
      expect(timeoutSecondsFor(a, 1)).toBe(MIN_NETWORK_TIMEOUT_SECONDS);
    }
  });

  it("still honours a setting that is above the floor", () => {
    expect(timeoutSecondsFor("pull", 300)).toBe(300);
    expect(timeoutSecondsFor("sync", MIN_NETWORK_TIMEOUT_SECONDS + 1)).toBe(
      MIN_NETWORK_TIMEOUT_SECONDS + 1
    );
  });

  it("gives every repair step its own long budget, deaf to the setting", () => {
    // Each step ends with a connectivity fsck, which is minutes on a vault of
    // real size; the one-piece repair timed out at the ordinary 90 s on a real
    // vault, leaving the repository as damaged as it was. The fetch steps get
    // the clone-sized number because the refetch IS a clone-sized download.
    expect(timeoutSecondsFor("repair-scan", 10)).toBe(600);
    expect(timeoutSecondsFor("repair-fetch-missing", 10)).toBe(900);
    expect(timeoutSecondsFor("repair-refetch", 3600)).toBe(900);
    expect(timeoutSecondsFor("repair-reset-upstream", 10)).toBe(300);
  });

  it("keeps the clone budget, which answers to neither", () => {
    // 3600 since v15: a real clone outlives fifteen minutes on a phone, and
    // the interactive credential route adds the person's own time on top.
    expect(timeoutSecondsFor("clone-into-vault", 10)).toBe(3600);
    expect(timeoutSecondsFor("clone-into-vault", 7200)).toBe(3600);
    expect(timeoutSecondsFor("adopt-remote", 10)).toBe(900);
  });

  it("falls back to the default rather than to zero for junk", () => {
    // A zero or a NaN out of storage must not turn into "give up immediately",
    // which would look exactly like a dead bridge.
    expect(timeoutSecondsFor("status", 0)).toBe(DEFAULT_TIMEOUT_SECONDS);
    expect(timeoutSecondsFor("status", NaN)).toBe(DEFAULT_TIMEOUT_SECONDS);
    expect(timeoutSecondsFor("status", -5)).toBe(DEFAULT_TIMEOUT_SECONDS);
  });
});
