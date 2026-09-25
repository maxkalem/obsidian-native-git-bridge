import esbuild from "esbuild";
import fs from "fs";
import process from "process";

/*
 * The manifest version does not identify a build: every build between two
 * releases carries the same one. The stamp does. It is UTC, yyMMdd.HHmm
 * followed by the milliseconds, written into the banner below and into the
 * log entry the plugin adds on every load, so an installed main.js can be
 * matched against the build it came from.
 *
 * NGB_BUILD_STAMP overrides it. CI passes the stamp read from the committed
 * main.js, so its fresh build can still be compared byte for byte with what
 * was committed.
 */
function buildStamp() {
  const fromEnv = process.env.NGB_BUILD_STAMP;
  if (fromEnv !== undefined && fromEnv !== "") {
    if (!/^\d{6}\.\d{7}$/.test(fromEnv)) {
      console.error(`NGB_BUILD_STAMP is not a build stamp: ${fromEnv}`);
      process.exit(1);
    }
    return fromEnv;
  }
  const d = new Date();
  const p = (n, w = 2) => String(n).padStart(w, "0");
  return (
    p(d.getUTCFullYear() % 100) + p(d.getUTCMonth() + 1) + p(d.getUTCDate()) +
    "." + p(d.getUTCHours()) + p(d.getUTCMinutes()) + p(d.getUTCMilliseconds(), 3)
  );
}

const stamp = buildStamp();

const banner = `/*
Obsidian Native Git Bridge - bundled output.
Build: ${stamp}
*/`;

const prod = process.argv[2] === "production";

/**
 * Single source of truth lives at the repository ROOT (Obsidian sample-plugin
 * convention): main.js is built there, manifest.json and styles.css are edited
 * there. Every build copies all three into native-git-bridge/ — the folder
 * users copy into .obsidian/plugins/ — so manual install, BRAT and
 * community-plugin releases all ship byte-identical files. CI fails when the
 * copies drift.
 */
function syncStaticFiles() {
  for (const f of ["manifest.json", "styles.css"]) {
    fs.copyFileSync(f, `native-git-bridge/${f}`);
  }
  /*
   * The Termux scripts are NOT build output: they live in
   * native-git-bridge/termux/ and are edited there. That is the folder users
   * copy into their vault, so a device can install and update the runner with
   * no network at all — bootstrap.sh takes install.sh and the runner from the
   * directory it is started from. Nothing to copy, nothing to keep in sync.
   */
  // versions.json must know the manifest version (Obsidian update mechanism).
  const version = JSON.parse(fs.readFileSync("manifest.json", "utf8")).version;
  const versions = JSON.parse(fs.readFileSync("versions.json", "utf8"));
  if (!(version in versions)) {
    console.error(`versions.json has no entry for manifest version ${version}`);
    process.exit(1);
  }
}

const ctx = await esbuild.context({
  banner: { js: banner },
  entryPoints: ["src/main.ts"],
  bundle: true,
  external: ["obsidian", "electron", "@codemirror/*", "@lezer/*"],
  format: "cjs",
  target: "es2021",
  logLevel: "info",
  sourcemap: prod ? false : "inline",
  treeShaking: true,
  define: { __NGB_BUILD__: JSON.stringify(stamp) },
  // Obsidian's convention (and its release verification) expects main.js in
  // the repository root; the copy under native-git-bridge/ is for manual
  // installs and is written after each build.
  outfile: "main.js",
});

syncStaticFiles();

if (prod) {
  await ctx.rebuild();
  fs.copyFileSync("main.js", "native-git-bridge/main.js");
  process.exit(0);
} else {
  await ctx.watch({
    onEnd: () => fs.copyFileSync("main.js", "native-git-bridge/main.js"),
  });
}
