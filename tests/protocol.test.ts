import { describe, expect, it } from "vitest";
import { createRequest, makeRequestId, parseResult } from "../src/bridge/protocol";
import { isValidRequestId } from "../src/settings/pathValidation";
import { idTimestampMs } from "../src/bridge/BridgeClient";

describe("request creation", () => {
  it("creates valid, parseable ids", () => {
    const req = createRequest("status", {}, "tok", 60, new Date("2026-08-03T10:15:00Z"), "abc123");
    expect(req.id).toBe("r-20260803T101500Z-abc123");
    expect(isValidRequestId(req.id)).toBe(true);
    expect(req.protocolVersion).toBe(1);
    expect(req.timeoutSeconds).toBe(60);
  });
  it("id timestamp round-trips for cleanup age checks", () => {
    const id = makeRequestId(new Date("2026-08-03T10:15:00Z"), "xyz");
    expect(idTimestampMs(`${id}.json`)).toBe(Date.parse("2026-08-03T10:15:00Z"));
  });
});

describe("parseResult", () => {
  it("parses a valid result", () => {
    const r = parseResult(
      JSON.stringify({ protocolVersion: 1, id: "r-1T1Z-a", action: "ping", ok: true, exitCode: 0 })
    );
    expect(r?.ok).toBe(true);
  });
  it("returns null for partial writes (poller keeps waiting)", () => {
    expect(parseResult('{"protocolVersion":1,"id":"r-')).toBeNull();
    expect(parseResult("")).toBeNull();
  });
  it("returns null for wrong shapes", () => {
    expect(parseResult('{"hello":"world"}')).toBeNull();
    expect(parseResult('[1,2,3]')).toBeNull();
  });
});
