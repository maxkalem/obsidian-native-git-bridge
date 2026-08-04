import { describe, expect, it } from "vitest";
import {
  countSkipWorktree,
  parseLastCommit,
  parseNameStatus,
  parseSparseState,
  parseStatusPorcelainV1,
  parseStatusPorcelainV2,
  unquoteGitPath,
} from "../src/git/parsers";
import { parseFileLog } from "../src/git/historyParsers";

/**
 * Deterministic fuzzing of the git output parsers. All randomness is seeded
 * (mulberry32) so a failure is reproducible; no test depends on Math.random.
 *
 * Invariants under test:
 *  1. No parser ever throws — not on garbage, not on truncated output, not on
 *     CRLF line endings. A parser exception would surface as a silent UI break.
 *  2. Round-trip fidelity: a path quoted the way git (core.quotePath=true)
 *     quotes it is decoded back to the original string.
 *  3. Truncated output degrades to fewer/partial entries, never to a crash.
 */

// ---------------------------------------------------------------- PRNG

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function pick<T>(rnd: () => number, arr: readonly T[]): T {
  return arr[Math.floor(rnd() * arr.length)]!;
}

// Code points to build hostile-but-valid path names from. No NUL (git paths
// cannot contain it) and no lone surrogates (not encodable as UTF-8).
const CODEPOINT_POOL: readonly number[] = [
  ...Array.from({ length: 26 }, (_, i) => 0x61 + i), // a-z
  0x20, // space
  0x09, // tab
  0x0a, // newline
  0x0d, // carriage return
  0x22, // double quote
  0x5c, // backslash
  0x7e, // ~
  0x28, 0x29, 0x2d, 0x3e, // ( ) - >   (builds " -> " sequences)
  0xfc, 0xdf, // ü ß
  0x0454, 0x0457, // є ї (Ukrainian)
  0x4e2d, 0x6587, // 中 文
  0x1f600, // emoji (surrogate pair in UTF-16)
  0x0301, // combining acute accent
  0x07, 0x08, 0x0b, 0x0c, 0x1b, 0x7f, // control chars
];

function randomPath(rnd: () => number, maxLen = 24): string {
  const len = 1 + Math.floor(rnd() * maxLen);
  let s = "";
  for (let i = 0; i < len; i++) s += String.fromCodePoint(pick(rnd, CODEPOINT_POOL));
  return s;
}

function randomGarbage(rnd: () => number, maxLen = 200): string {
  const len = Math.floor(rnd() * maxLen);
  let s = "";
  for (let i = 0; i < len; i++) {
    // Any code unit except lone surrogates.
    let cu = Math.floor(rnd() * 0xffff);
    if (cu >= 0xd800 && cu <= 0xdfff) cu = 0x20;
    s += String.fromCharCode(cu);
  }
  return s;
}

// ------------------------------------------- reference git quotePath encoder

/**
 * Encode a path exactly the way git prints it with core.quotePath=true:
 * double-quoted, C-style escapes for known controls, and 3-digit octal escapes
 * for every other byte outside printable ASCII (git quotes per UTF-8 byte).
 */
function gitQuote(path: string): string {
  const bytes = new TextEncoder().encode(path);
  let out = '"';
  for (const b of bytes) {
    if (b === 0x22) out += '\\"';
    else if (b === 0x5c) out += "\\\\";
    else if (b === 0x07) out += "\\a";
    else if (b === 0x08) out += "\\b";
    else if (b === 0x09) out += "\\t";
    else if (b === 0x0a) out += "\\n";
    else if (b === 0x0b) out += "\\v";
    else if (b === 0x0c) out += "\\f";
    else if (b === 0x0d) out += "\\r";
    else if (b < 0x20 || b >= 0x7f) out += "\\" + b.toString(8).padStart(3, "0");
    else out += String.fromCharCode(b);
  }
  return out + '"';
}

// ------------------------------------------------------------------ tests

describe("unquoteGitPath fuzz", () => {
  it("round-trips 1000 random hostile paths through the git quoting rules", () => {
    const rnd = mulberry32(0xc0ffee);
    for (let i = 0; i < 1000; i++) {
      const original = randomPath(rnd);
      const quoted = gitQuote(original);
      expect(unquoteGitPath(quoted), `iteration ${i}: ${JSON.stringify(original)}`).toBe(original);
    }
  });

  it("never throws on random garbage", () => {
    const rnd = mulberry32(0xdead);
    for (let i = 0; i < 500; i++) {
      const g = randomGarbage(rnd);
      expect(() => unquoteGitPath(g)).not.toThrow();
      expect(() => unquoteGitPath('"' + g + '"')).not.toThrow();
    }
  });

  it("handles adversarial escape edge cases without throwing", () => {
    // Unterminated quote: returned verbatim (not a quoted path).
    expect(unquoteGitPath('"abc')).toBe('"abc');
    expect(unquoteGitPath('"')).toBe('"');
    // Trailing backslash right before the closing quote: escape truncated.
    expect(unquoteGitPath('"a\\"')).toBe("a");
    // Octal overflow is masked to a byte, not an exception.
    expect(() => unquoteGitPath('"\\400"')).not.toThrow();
    // Short octal escape.
    expect(unquoteGitPath('"\\1"')).toBe("\x01");
    // Unknown escape kept literally.
    expect(unquoteGitPath('"\\9"')).toBe("9");
    // Empty quoted string.
    expect(unquoteGitPath('""')).toBe("");
  });

  it("decodes truncated octal sequences at end of string without throwing", () => {
    for (const s of ['"\\3"', '"\\30"', '"\\303"', '"a\\30"']) {
      expect(() => unquoteGitPath(s)).not.toThrow();
    }
  });
});

describe("parseStatusPorcelainV2 fuzz", () => {
  function buildSample(paths: string[]): string {
    const lines = [
      "# branch.oid 1234567890abcdef1234567890abcdef12345678",
      "# branch.head main",
      "# branch.upstream origin/main",
      "# branch.ab +1 -2",
    ];
    for (const p of paths) {
      lines.push(`1 .M N... 100644 100644 100644 aaaa bbbb ${gitQuote(p)}`);
    }
    return lines.join("\n") + "\n";
  }

  it("recovers 300 random unicode paths from ordinary change entries", () => {
    const rnd = mulberry32(0xbeef);
    for (let round = 0; round < 30; round++) {
      const paths = Array.from({ length: 10 }, () => randomPath(rnd));
      const s = parseStatusPorcelainV2(buildSample(paths));
      expect(s.unstaged.map((e) => e.path)).toEqual(paths);
    }
  });

  it("recovers rename pairs (quoted new\\told paths) from '2' entries", () => {
    const rnd = mulberry32(0xfeed);
    for (let i = 0; i < 200; i++) {
      const oldP = randomPath(rnd);
      const newP = randomPath(rnd);
      const line = `2 R. N... 100644 100644 100644 aaaa bbbb R100 ${gitQuote(newP)}\t${gitQuote(oldP)}`;
      const s = parseStatusPorcelainV2(line);
      expect(s.staged).toHaveLength(1);
      expect(s.staged[0]!.path).toBe(newP);
      expect(s.staged[0]!.origPath).toBe(oldP);
    }
  });

  it("produces identical results for LF and CRLF output", () => {
    const sample = buildSample(["Notes/a.md", "Notes/b c.md"]);
    const lf = parseStatusPorcelainV2(sample);
    const crlf = parseStatusPorcelainV2(sample.replace(/\n/g, "\r\n"));
    expect(crlf).toEqual(lf);
  });

  it("never throws on output truncated at every byte offset", () => {
    const sample = buildSample(["Notes/nøte.md", "with space.md"]) +
      "u UU N... 100644 100644 100644 100644 aaaa bbbb cccc conflict.md\n? untracked.md\n";
    for (let cut = 0; cut <= sample.length; cut++) {
      const s = parseStatusPorcelainV2(sample.slice(0, cut));
      for (const e of [...s.staged, ...s.unstaged, ...s.conflicted]) {
        expect(typeof e.path).toBe("string");
      }
      for (const u of s.untracked) expect(typeof u).toBe("string");
    }
  });

  it("never throws on random garbage", () => {
    const rnd = mulberry32(0x5eed);
    for (let i = 0; i < 500; i++) {
      expect(() => parseStatusPorcelainV2(randomGarbage(rnd))).not.toThrow();
    }
  });

  it("ignores malformed branch.ab / short entry lines instead of misparsing them", () => {
    const s = parseStatusPorcelainV2("# branch.ab +x -y\n1 .M\n2 R.\nu UU\n");
    expect(s.ahead).toBe(0);
    expect(s.behind).toBe(0);
    expect(s.staged).toHaveLength(0);
    expect(s.unstaged).toHaveLength(0);
    expect(s.conflicted).toHaveLength(0);
  });
});

describe("parseStatusPorcelainV1 fuzz", () => {
  it("recovers simple entries with hostile quoted paths", () => {
    const rnd = mulberry32(0xabcd);
    for (let i = 0; i < 300; i++) {
      const p = randomPath(rnd);
      const es = parseStatusPorcelainV1(` M ${gitQuote(p)}\n`);
      expect(es).toHaveLength(1);
      expect(es[0]!.path).toBe(p);
    }
  });

  it("never throws on garbage or truncation", () => {
    const rnd = mulberry32(0x1234);
    const sample = ' D Private/AgentsMemory/x.md\nR  "old n\\303\\270te.md" -> new.md\n?? a.md\n';
    for (let cut = 0; cut <= sample.length; cut++) {
      expect(() => parseStatusPorcelainV1(sample.slice(0, cut))).not.toThrow();
    }
    for (let i = 0; i < 500; i++) {
      expect(() => parseStatusPorcelainV1(randomGarbage(rnd))).not.toThrow();
    }
  });

  it("documents the ' -> ' ambiguity: rename lines with arrows inside names never crash", () => {
    // git's porcelain v1 rename format is itself ambiguous when a file name
    // contains " -> " (scripts are told to use -z). The plugin only uses this
    // parser for DISPLAY; the runner-side safety gate checks raw non-emptiness
    // and is unaffected. The invariant here is: no crash, entries still typed.
    const es = parseStatusPorcelainV1("R  a -> b.md -> c.md\n");
    expect(es).toHaveLength(1);
    expect(typeof es[0]!.path).toBe("string");
    expect(es[0]!.index).toBe("R");
  });
});

describe("parseNameStatus fuzz", () => {
  it("recovers deletions and renames with hostile paths (tab-separated, quoted)", () => {
    const rnd = mulberry32(0x9999);
    for (let i = 0; i < 300; i++) {
      const a = randomPath(rnd);
      const b = randomPath(rnd);
      const es = parseNameStatus(`D\t${gitQuote(a)}\nR087\t${gitQuote(a)}\t${gitQuote(b)}\n`);
      expect(es).toHaveLength(2);
      expect(es[0]).toMatchObject({ path: a, index: "D" });
      expect(es[1]).toMatchObject({ path: b, origPath: a, index: "R" });
    }
  });

  it("never throws on garbage/truncation and tolerates CRLF", () => {
    const rnd = mulberry32(0x4242);
    for (let i = 0; i < 500; i++) {
      expect(() => parseNameStatus(randomGarbage(rnd))).not.toThrow();
    }
    expect(parseNameStatus("D\ta.md\r\nM\tb.md\r\n")).toEqual(
      parseNameStatus("D\ta.md\nM\tb.md\n")
    );
  });
});

describe("parseFileLog fuzz", () => {
  const RS = "\x1e";
  const FS = "\x1f";

  function record(hash: string, subject: string, nameStatus: string): string {
    return `${RS}${hash}${FS}2026-08-01T10:00:00Z${FS}Author${FS}${subject}\n\n${nameStatus}\n`;
  }

  it("recovers hostile quoted paths from name-status blocks", () => {
    const rnd = mulberry32(0x7777);
    for (let i = 0; i < 300; i++) {
      const p = randomPath(rnd).replace(/[\n\r]/g, "_"); // %s subjects/paths in log lines never span lines unquoted
      const raw = record("a".repeat(40), "subject", `M\t${gitQuote(p)}`);
      const es = parseFileLog(raw, "fallback.md");
      expect(es).toHaveLength(1);
      expect(es[0]!.pathAtCommit).toBe(p);
    }
  });

  it("never throws on garbage, and skips records with invalid hashes", () => {
    const rnd = mulberry32(0x3141);
    for (let i = 0; i < 500; i++) {
      expect(() => parseFileLog(randomGarbage(rnd), "x.md")).not.toThrow();
    }
    expect(parseFileLog(`${RS}nothex${FS}d${FS}a${FS}s\n\nM\ta.md\n`, "x.md")).toEqual([]);
  });

  it("never throws when a real two-record log is truncated at every offset", () => {
    const raw =
      record("a".repeat(40), "rename", 'R100\t"old n\\303\\270te.md"\t"new n\\303\\270te.md"') +
      record("b".repeat(40), "create", 'A\t"old n\\303\\270te.md"');
    for (let cut = 0; cut <= raw.length; cut++) {
      const es = parseFileLog(raw.slice(0, cut), "new nøte.md");
      for (const e of es) {
        expect(typeof e.pathAtCommit).toBe("string");
        expect(typeof e.hash).toBe("string");
      }
    }
  });

  it("keeps field-separator bytes appearing in the subject", () => {
    const raw = `\x1e${"c".repeat(40)}\x1f2026-01-01T00:00:00Z\x1fA\x1fsubject\x1fwith fs\n\nM\ta.md\n`;
    const es = parseFileLog(raw, "a.md");
    expect(es[0]!.subject).toBe("subject\x1fwith fs");
  });
});

describe("scalar parsers fuzz", () => {
  it("parseLastCommit never throws and rejects non-hashes", () => {
    const rnd = mulberry32(0x2718);
    for (let i = 0; i < 500; i++) {
      expect(() => parseLastCommit(randomGarbage(rnd))).not.toThrow();
    }
    expect(parseLastCommit("zzz\t2026\tsubject")).toBeUndefined();
    expect(parseLastCommit("abc\t")).toBeUndefined(); // 3 hex chars: too short
  });

  it("countSkipWorktree ignores lookalike prefixes and CRLF", () => {
    expect(countSkipWorktree("S a.md\r\nSs b.md\nH S c.md\nS\n")).toBe(1);
  });

  it("parseSparseState tolerates garbage counts and huge pattern lists", () => {
    const st = parseSparseState({
      sparseEnabled: "true",
      sparseCone: "garbage",
      sparseList: Array.from({ length: 5000 }, (_, i) => `/p${i}/`).join("\n"),
      skipWorktreeCount: "not-a-number",
      lsFilesV: "S a.md\nS b.md\n",
    });
    expect(st.enabled).toBe(true);
    expect(st.coneMode).toBe(false); // any non-"true" value is not cone mode
    expect(st.patterns).toHaveLength(5000);
    // Unparsable count falls back to counting the legacy ls-files output.
    expect(st.skipWorktreeCount).toBe(2);
  });
});
