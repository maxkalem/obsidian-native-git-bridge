import { describe, expect, it } from "vitest";
import {
  bytesToTextIfNotBinary,
  decodeBase64ToBytes,
  describeFileChange,
  parseFileLog,
  parseRepoLog,
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

describe("parseRepoLog", () => {
  const RS = "\x1e";
  const FS = "\x1f";
  it("parses commits with their full changed-file list", () => {
    const raw =
      `${RS}aaaa111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00+02:00${FS}Alice${FS}two files\n\n` +
      `M\tNotes/a.md\nA\tNotes/b.md\n` +
      `${RS}bbbb111122223333aaaa111122223333aaaa1111${FS}2026-07-01T10:00:00Z${FS}Bob${FS}delete\n\nD\told.md\n`;
    const es = parseRepoLog(raw);
    expect(es).toHaveLength(2);
    expect(es[0]).toMatchObject({ author: "Alice", subject: "two files" });
    expect(es[0]!.files).toEqual([
      { code: "M", path: "Notes/a.md" },
      { code: "A", path: "Notes/b.md" },
    ]);
    expect(es[1]!.files).toEqual([{ code: "D", path: "old.md" }]);
  });
  it("keeps rename pairs with the score stripped from the code", () => {
    const raw = `${RS}cccc111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00Z${FS}A${FS}rename\n\nR100\told.md\tnew.md\n`;
    const es = parseRepoLog(raw);
    expect(es[0]!.files).toEqual([{ code: "R", path: "new.md", origPath: "old.md" }]);
  });
  it("unquotes unicode paths in the file list", () => {
    const raw = `${RS}dddd111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00Z${FS}A${FS}s\n\nM\t"F\\303\\274\\303\\237e.md"\n`;
    expect(parseRepoLog(raw)[0]!.files[0]!.path).toBe("Füße.md");
  });
  it("tolerates commits without files (e.g. empty merges) and garbage records", () => {
    const raw = `${RS}eeee111122223333aaaa111122223333aaaa1111${FS}2026-08-01T10:00:00Z${FS}A${FS}merge\n${RS}not-a-hash${FS}x${FS}y${FS}z\n`;
    const es = parseRepoLog(raw);
    expect(es).toHaveLength(1);
    expect(es[0]!.files).toEqual([]);
  });
});

describe("parseFileLog with raw + numstat (runner v9)", () => {
  const RS = "\x1e";
  const FS = "\x1f";
  const rec = (hash: string, subject: string, body: string) =>
    `${RS}${hash}${FS}2026-08-01T10:00:00Z${FS}Ann${FS}${subject}\n\n${body}`;

  it("reads the change letter from raw and the counts from numstat", () => {
    const raw = rec(
      "aaaa111122223333aaaa111122223333aaaa1111",
      "edit",
      ":100644 100644 de98044 a7bc997 M\tNotes/n.md\n2\t1\tNotes/n.md\n"
    );
    const [e] = parseFileLog(raw, "Notes/n.md");
    expect(e).toMatchObject({ code: "M", added: 2, deleted: 1, pathAtCommit: "Notes/n.md" });
    expect(describeFileChange(e!)).toBe("+2 −1");
  });

  it("keeps both sides of a rename and describes it", () => {
    const raw = rec(
      "bbbb111122223333aaaa111122223333aaaa1111",
      "move",
      ":100644 100644 a7bc997 a7bc997 R100\tA/f.md\tB/g.md\n0\t0\tA/f.md => B/g.md\n"
    );
    const [e] = parseFileLog(raw, "B/g.md");
    expect(e).toMatchObject({ code: "R", origPath: "A/f.md", pathAtCommit: "B/g.md" });
    expect(describeFileChange(e!)).toBe("renamed from A/f.md");
  });

  it("describes an addition and a deletion", () => {
    const add = parseFileLog(
      rec("cccc111122223333aaaa111122223333aaaa1111", "add", ":000000 100644 0000000 de98044 A\tn.md\n3\t0\tn.md\n"),
      "n.md"
    )[0]!;
    expect(describeFileChange(add)).toBe("added, +3 −0");
    const del = parseFileLog(
      rec("dddd111122223333aaaa111122223333aaaa1111", "rm", ":100644 000000 de98044 0000000 D\tn.md\n0\t3\tn.md\n"),
      "n.md"
    )[0]!;
    expect(describeFileChange(del)).toBe("deleted");
  });

  it("survives a binary file, where numstat prints dashes", () => {
    const e = parseFileLog(
      rec("eeee111122223333aaaa111122223333aaaa1111", "img", ":100644 100644 aaa bbb M\ti.png\n-\t-\ti.png\n"),
      "i.png"
    )[0]!;
    expect(e.added).toBeUndefined();
    expect(describeFileChange(e)).toBe("changed (M)");
  });

  it("still parses the old name-status output of a v8 runner", () => {
    const e = parseFileLog(
      rec("ffff111122223333aaaa111122223333aaaa1111", "old runner", "M\tNotes/n.md\n"),
      "Notes/n.md"
    )[0]!;
    expect(e).toMatchObject({ code: "M", pathAtCommit: "Notes/n.md" });
    expect(e.added).toBeUndefined();
  });
});
