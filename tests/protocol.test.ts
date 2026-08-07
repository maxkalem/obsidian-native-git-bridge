import { describe, expect, it } from "vitest";
import { bootstrapCommand, bootstrapCommandLocal } from "../src/constants";
import { createRequest, isValidProfileId, makeRequestId, parseResult } from "../src/bridge/protocol";
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
  it("carries the profile id only when it is a valid one", () => {
    const withId = createRequest("status", {}, "tok", 60, new Date(), "abc123", "p-0011223344556677");
    expect(withId.profileId).toBe("p-0011223344556677");
    // Garbage (or an empty setting) is dropped rather than sent: the runner
    // would reject the request, and an empty string is not "no profile".
    expect(createRequest("status", {}, "tok", 60, new Date(), "abc123", "").profileId).toBeUndefined();
    expect(createRequest("status", {}, "tok", 60, new Date(), "abc123", "../etc").profileId).toBeUndefined();
  });
  it("id timestamp round-trips for cleanup age checks", () => {
    const id = makeRequestId(new Date("2026-08-03T10:15:00Z"), "xyz");
    expect(idTimestampMs(`${id}.json`)).toBe(Date.parse("2026-08-03T10:15:00Z"));
  });
});

describe("isValidProfileId", () => {
  it("accepts the runner's opaque ids and nothing else", () => {
    expect(isValidProfileId("p-0011223344556677")).toBe(true);
    expect(isValidProfileId("p-00112233")).toBe(true);
    expect(isValidProfileId("p-001122")).toBe(false);
    expect(isValidProfileId("p-XXXXXXXXXXXXXXXX")).toBe(false);
    expect(isValidProfileId("../../etc/passwd")).toBe(false);
    expect(isValidProfileId("p-0011223344556677/../x")).toBe(false);
    expect(isValidProfileId("")).toBe(false);
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

describe("bootstrapCommandLocal", () => {
  it("points at the copy that ships inside the plugin folder", () => {
    const cmd = bootstrapCommandLocal("/storage/emulated/0/Documents/Kalem", ".obsidian");
    expect(cmd).toBe(
      'bash "/storage/emulated/0/Documents/Kalem/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh" ' +
        '"/storage/emulated/0/Documents/Kalem"'
    );
    // No network anywhere in it: that is the whole point.
    expect(cmd).not.toContain("http");
    expect(cmd).not.toContain("curl");
  });

  it("honours a custom Obsidian config directory", () => {
    expect(bootstrapCommandLocal("/vaults/Work", ".config-obsidian")).toContain(
      "/vaults/Work/.config-obsidian/plugins/native-git-bridge/termux/bootstrap.sh"
    );
  });

  it("quotes the paths, because vault names have spaces", () => {
    const cmd = bootstrapCommandLocal("/storage/emulated/0/My Vault", ".obsidian");
    expect(cmd).toBe(
      'bash "/storage/emulated/0/My Vault/.obsidian/plugins/native-git-bridge/termux/bootstrap.sh" ' +
        '"/storage/emulated/0/My Vault"'
    );
  });
});

describe("bootstrapCommand", () => {
  it("fetches from the plugin's OWN release, never from the main branch", () => {
    const cmd = bootstrapCommand("0.5.2", "");
    // A release is a tested, immutable set; `main` is the development state.
    expect(cmd).not.toContain("raw.githubusercontent.com");
    expect(cmd).not.toContain("/main/");
    expect(cmd).toContain("/releases/download/0.5.2/bootstrap.sh");
    // The version is forwarded so install.sh and the runner come from the SAME
    // release as bootstrap.sh itself.
    expect(cmd).toContain("NGB_VERSION=0.5.2");
  });

  it("quotes the vault path when one is known", () => {
    const cmd = bootstrapCommand("0.5.2", "/storage/emulated/0/Documents/My Vault");
    expect(cmd).toContain('"/storage/emulated/0/Documents/My Vault"');
  });

  it("falls back to the newest release for a non-release version string", () => {
    // e.g. a local dev build whose version has no published assets.
    expect(bootstrapCommand("0.5.2-dev", "")).toContain("/releases/latest/download/bootstrap.sh");
  });
});
