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

  /**
   * The `user:password` form was the only one the redaction knew, and it is not
   * the form a token arrives in. GitHub and GitLab tokens are carried as the
   * USERNAME with no password at all, so a failing fetch could put a live token
   * into a log the user then shares as a file.
   */
  it("redacts a token carried as the username, with no password", () => {
    expect(redact("fatal: could not read from https://ghp_liveTokenHere@github.com/x/y.git")).toBe(
      "fatal: could not read from https://***@github.com/x/y.git"
    );
    expect(redact("https://oauth2:glpat-abc123def@gitlab.com/x.git")).toContain("https://***@");
  });

  it("keeps the ssh user, which is not a secret", () => {
    // Blanking it would turn every ssh remote in a log into the same string and
    // buy nothing: `git` is the universal SSH user for every forge.
    expect(redact("ssh://git@github.com/x/y.git")).toBe("ssh://git@github.com/x/y.git");
  });

  it("redacts a token that arrives with no URL around it", () => {
    expect(redact("remote: ghp_abcdefghijklmnop rejected")).toBe("remote: ghp_*** rejected");
    expect(redact("Authorization: Bearer eyJhbGciOiJIUzI1")).toBe("Authorization: Bearer ***");
    expect(redact("github_pat_11ABCDEFG0abcdefg")).toBe("github_pat_***");
  });

  it("leaves an ordinary URL alone", () => {
    expect(redact("cloning https://github.com/maxkalem/vault.git")).toBe(
      "cloning https://github.com/maxkalem/vault.git"
    );
  });

  it("caps the ring buffer", () => {
    const store = new DeviceLocalSettingsStore(null, "v");
    const log = new OperationLog(store);
    for (let i = 0; i < 250; i++) log.add("info", "t", `m${i}`);
    expect(log.list().length).toBeLessThanOrEqual(200);
    expect(log.list().at(-1)!.message).toBe("m249");
  });
});
