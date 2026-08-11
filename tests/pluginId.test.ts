import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { PLUGIN_ID, RUNNER_MIN_VERSION, RUNNER_SHIPPED_VERSION } from "../src/constants";
import { RuntimePaths } from "../src/bridge/runtimePaths";

/**
 * `PLUGIN_ID` is the one string both halves have to agree on and nothing
 * checked. Every runtime path in the plugin is built from it, Obsidian installs
 * the plugin into a folder named after `manifest.json`'s `id`, and the Termux
 * scripts carry the same segment as a bash literal that no type checker can
 * follow.
 *
 * A divergence fails no build and no other suite. On the device it shows up as
 * "the runner has written nowhere": the plugin polls one directory while the
 * runner drains another, which is the most confusing failure this project has.
 * Asked for in 0.5.5, written in 0.6.3.
 */

function repoFile(rel: string): string {
  return readFileSync(fileURLToPath(new URL(`../${rel}`, import.meta.url)), "utf8");
}

function manifestId(rel: string): unknown {
  return (JSON.parse(repoFile(rel)) as Record<string, unknown>).id;
}

/** Every `plugins/<segment>/runtime` a shell script hardcodes. */
function runtimeSegments(script: string): string[] {
  const out: string[] = [];
  for (const m of script.matchAll(/plugins\/([^/\s"']+)\/runtime/g)) {
    if (m[1] !== undefined) out.push(m[1]);
  }
  return out;
}

describe("PLUGIN_ID agrees with everything built from it", () => {
  it("equals the id in manifest.json", () => {
    expect(manifestId("manifest.json")).toBe(PLUGIN_ID);
  });

  it("equals the id in the copy users install", () => {
    // native-git-bridge/manifest.json is build output, but it is also what ends
    // up in .obsidian/plugins/, so a stale copy here is a wrong folder there.
    expect(manifestId("native-git-bridge/manifest.json")).toBe(PLUGIN_ID);
  });

  it("is the folder the runtime directory is built in", () => {
    // The failure this whole file exists for is a runtime directory that the
    // two halves spell differently, so assert the path and not just the string.
    expect(new RuntimePaths(".obsidian").root).toBe(
      `.obsidian/plugins/${PLUGIN_ID}/runtime`
    );
  });

  it.each([
    ["native-git-bridge/termux/install.sh"],
    ["native-git-bridge/termux/native-git-bridge-runner.sh"],
  ])("is the segment %s hardcodes in its runtime paths", (rel) => {
    const segments = runtimeSegments(repoFile(rel));
    // If this ever finds nothing, the literal was reshaped and the check went
    // silently dead; that is worth failing on too.
    expect(segments.length).toBeGreaterThan(0);
    expect([...new Set(segments)]).toEqual([PLUGIN_ID]);
  });
});

/**
 * The same shape of agreement for the runner version: `RUNNER_SHIPPED_VERSION`
 * is what version advice compares against, and it is a TypeScript copy of a
 * bash literal no type checker can follow. When it lags the script, every
 * correctly updated runner reads as "newer than this plugin knows" — the
 * 0.6.3 release shipped exactly that defect, with the floor standing in for
 * the shipped version.
 */
describe("RUNNER_SHIPPED_VERSION agrees with the runner script", () => {
  it("equals RUNNER_VERSION in native-git-bridge-runner.sh", () => {
    const m = /^RUNNER_VERSION=(\d+)$/m.exec(
      repoFile("native-git-bridge/termux/native-git-bridge-runner.sh")
    );
    expect(m).not.toBeNull();
    expect(parseInt(m![1]!, 10)).toBe(RUNNER_SHIPPED_VERSION);
  });

  it("is at least the minimum, or the advice branches can never both fire", () => {
    expect(RUNNER_SHIPPED_VERSION).toBeGreaterThanOrEqual(RUNNER_MIN_VERSION);
  });
});
