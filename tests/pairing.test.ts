import { describe, expect, it } from "vitest";
import { parsePairingFile } from "../src/settings/pairing";

describe("parsePairingFile", () => {
  it("accepts a valid installer-produced file", () => {
    const p = parsePairingFile(
      '{"token":"a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6","repoPath":"/storage/emulated/0/Vault","createdAt":"2026-08-03T10:00:00Z"}'
    );
    expect(p?.token).toBe("a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6");
    expect(p?.repoPath).toBe("/storage/emulated/0/Vault");
  });
  it("keeps a valid profile id and drops a malformed one", () => {
    const ok = parsePairingFile(
      '{"token":"a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6","profileId":"p-0011223344556677"}'
    );
    expect(ok?.profileId).toBe("p-0011223344556677");
    const bad = parsePairingFile('{"token":"a1b2c3d4e5f6a7b8c9d0a1b2c3d4e5f6","profileId":"../x"}');
    expect(bad?.token).toBeTruthy();
    expect(bad?.profileId).toBeUndefined();
  });
  it("rejects short, non-alphanumeric or missing tokens", () => {
    expect(parsePairingFile('{"token":"short"}')).toBeNull();
    expect(parsePairingFile('{"token":"has spaces here yes it does!!"}')).toBeNull();
    expect(parsePairingFile('{"repoPath":"/x"}')).toBeNull();
    expect(parsePairingFile("not json")).toBeNull();
    expect(parsePairingFile("[]")).toBeNull();
  });
});
