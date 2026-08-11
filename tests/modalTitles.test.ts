import { readFileSync, readdirSync, statSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { join } from "node:path";
import { describe, expect, it } from "vitest";

/**
 * A modal title is one line on a phone, and Obsidian truncates what does not
 * fit: "Native Git: Limit history on this devi." states less than a short
 * title would. The self-check headline learned this in 0.6.4 and got a 30-char
 * cap with a test; this is the same rule for every other modal, at 40 because
 * a modal title renders slightly smaller than the self-check's.
 *
 * Static strings only: a template's placeholders are measured as their static
 * text, so a `${...}` that expands long can still overflow — keep placeholders
 * short (a size, a count, never a path). Menu-entry titles are exempt: Menu
 * items wrap and are not modals (gitMenu.ts is skipped).
 */

const MAX = 40;

function tsFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsFiles(p));
    else if (name.endsWith(".ts") && name !== "gitMenu.ts") out.push(p);
  }
  return out;
}

/** Every string that lands in a modal's title slot, with where it was found. */
function collectTitles(): Array<{ where: string; title: string }> {
  const src = fileURLToPath(new URL("../src", import.meta.url));
  const out: Array<{ where: string; title: string }> = [];
  const push = (file: string, raw: string) => {
    // A template's static text is what can be asserted; strip the holes.
    out.push({ where: file, title: raw.replace(/\$\{[^}]*\}/g, "") });
  };
  for (const file of tsFiles(src)) {
    const text = readFileSync(file, "utf8");
    for (const m of text.matchAll(/title:\s*"((?:[^"\\]|\\.)*)"/g)) push(file, m[1]!);
    for (const m of text.matchAll(/title:\s*`([^`]*)`/g)) push(file, m[1]!);
    // ResultModal takes its title positionally as the second argument.
    for (const m of text.matchAll(/new ResultModal\(\s*[^,()]+,\s*"((?:[^"\\]|\\.)*)"/g)) push(file, m[1]!);
    for (const m of text.matchAll(/new ResultModal\(\s*[^,()]+,\s*`([^`]*)`/g)) push(file, m[1]!);
  }
  return out;
}

describe("modal titles fit one line", () => {
  it("finds titles at all, or the patterns went dead", () => {
    expect(collectTitles().length).toBeGreaterThan(20);
  });

  it(`keeps every static title within ${MAX} characters`, () => {
    const over = collectTitles().filter((t) => t.title.length > MAX);
    expect(
      over.map((t) => `${t.title.length} chars: "${t.title}" (${t.where})`)
    ).toEqual([]);
  });
});
