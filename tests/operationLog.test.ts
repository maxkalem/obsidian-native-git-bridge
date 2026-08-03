import { describe, expect, it } from "vitest";
import { OperationLog, redact } from "../src/ops/OperationLog";
import { DeviceLocalSettingsStore } from "../src/settings/DeviceLocalSettingsStore";

describe("OperationLog", () => {
  it("stores entries device-locally and survives reload", () => {
    const store = new DeviceLocalSettingsStore(null, "v");
    const log = new OperationLog(store);
    log.add("info", "status", "Queued request r-1.");
    const log2 = new OperationLog(store);
    expect(log2.list()).toHaveLength(1);
    expect(log2.list()[0]!.message).toContain("r-1");
  });

  it("redacts credentialed URLs", () => {
    expect(redact("push to https://user:s3cret@github.com/x.git failed")).toBe(
      "push to https://***@github.com/x.git failed"
    );
    const store = new DeviceLocalSettingsStore(null, "v");
    const log = new OperationLog(store);
    log.add("error", "push", "https://tok:abc@host/repo.git", "detail https://a:b@h/r.git");
    expect(log.list()[0]!.message).not.toContain("s3cret");
    expect(log.list()[0]!.message).toContain("***@");
    expect(log.list()[0]!.detail).toContain("***@");
  });

  it("caps the ring buffer", () => {
    const store = new DeviceLocalSettingsStore(null, "v");
    const log = new OperationLog(store);
    for (let i = 0; i < 250; i++) log.add("info", "t", `m${i}`);
    expect(log.list().length).toBeLessThanOrEqual(200);
    expect(log.list().at(-1)!.message).toBe("m249");
  });
});
