import { describe, expect, it } from "vitest";
import {
  bytesToTextIfNotBinary,
  decodeBase64ToBytes,
  parseFileLog,
} from "../src/git/historyParsers";

const RS = "\x1e";
const FS = "\x1f";

describe("parseFileLog", () => {
  it("parses simple history with paths at each commit", () => {
    const raw =
      `${RS}aaaa111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00+02:00${FS}Alice${FS}edit note\n\nM\tNotes/note.md\n` +
      `${RS}bbbb111122223333aaaa111122223333aaaa1111${FS}2026-07-01T10:00:00+02:00${FS}Bob${FS}create note\n\nA\tNotes/note.md\n`;
    const es = parseFileLog(raw, "Notes/note.md");
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ author: "Alice", subject: "edit note", pathAtCommit: "Notes/note.md" });
    expect(es[1]!.pathAtCommit).toBe("Notes/note.md");
  });

  it("tracks renames: pathAtCommit is the historical (new-at-that-commit) name", () => {
    const raw =
      `${RS}aaaa111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00Z${FS}A${FS}rename\n\nR100\told name.md\tnew name.md\n` +
      `${RS}bbbb111122223333aaaa111122223333aaaa1111${FS}2026-07-01T10:00:00Z${FS}A${FS}create\n\nA\told name.md\n`;
    const es = parseFileLog(raw, "new name.md");
    expect(es[0]!.pathAtCommit).toBe("new name.md");
    expect(es[1]!.pathAtCommit).toBe("old name.md");
  });

  it("unquotes unicode paths and keeps FS chars in subject", () => {
    const raw = `${RS}cccc111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00Z${FS}Ann${FS}subj\n\nM\t"F\\303\\274\\303\\237e.md"\n`;
    const es = parseFileLog(raw, "Füße.md");
    expect(es[0]!.pathAtCommit).toBe("Füße.md");
  });

  it("falls back to the current path when no name-status line exists", () => {
    const raw = `${RS}dddd111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00Z${FS}A${FS}merge\n`;
    const es = parseFileLog(raw, "x.md");
    expect(es[0]!.pathAtCommit).toBe("x.md");
  });

  it("ignores garbage records", () => {
    expect(parseFileLog("garbage without separators", "x.md")).toEqual([]);
    expect(parseFileLog("", "x.md")).toEqual([]);
  });
});

describe("base64 helpers", () => {
  it("round-trips utf-8 text", () => {
    const b64 = Buffer.from("привіт world Füße", "utf-8").toString("base64");
    const bytes = decodeBase64ToBytes(b64);
    expect(bytesToTextIfNotBinary(bytes)).toBe("привіт world Füße");
  });
  it("detects binary (NUL byte)", () => {
    const b64 = Buffer.from([0x50, 0x00, 0x51]).toString("base64");
    expect(bytesToTextIfNotBinary(decodeBase64ToBytes(b64))).toBeNull();
  });
});
