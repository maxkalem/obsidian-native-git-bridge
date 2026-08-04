import esbuild from "esbuild";
import fs from "fs";
import process from "process";

const banner = `/*
Obsidian Native Git Bridge - bundled output.
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
