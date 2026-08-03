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
  it("rejects short, non-alphanumeric or missing tokens", () => {
    expect(parsePairingFile('{"token":"short"}')).toBeNull();
    expect(parsePairingFile('{"token":"has spaces here yes it does!!"}')).toBeNull();
    expect(parsePairingFile('{"repoPath":"/x"}')).toBeNull();
    expect(parsePairingFile("not json")).toBeNull();
    expect(parsePairingFile("[]")).toBeNull();
  });
});
