/**
 * Build the diff DOM directly.
 *
 * `diff2html` produced an HTML string through Mustache templates it compiled
 * with `new Function`; the string went through `sanitizeHTMLToDom`; and the view
 * then walked the result to move the `+`/`-` prefix into the number gutter.
 * Building the nodes here drops all three of those steps, and the prefix starts
 * out in the cell it belongs in.
 *
 * The class names are still diff2html's. Twenty-seven rules in styles.css are
 * keyed to them, so keeping them means the appearance cannot shift while the
 * renderer changes. Renaming to `ngb-diff-*` is a separate cosmetic commit.
 *
 * Not emitted: `.d2h-file-header` and everything inside it (file name, CHANGED
 * tag, the "Viewed" checkbox). The stylesheet has always set it to
 * `display: none`, so it was markup nobody could see.
 */

import { parseUnifiedDiff, type DiffHunk, type DiffLine } from "../git/unifiedDiff";
import type { InlineRun } from "../git/inlineDiff";
import { selectableLines } from "../git/hunkPatch";

/** Non-breaking space: the prefix cell of a context line, as diff2html had it. */
const NBSP = " ";

/**
 * Render `diff` (raw unified diff text from git) into `parent`.
 *
 * Returns the wrapper element, so a caller can measure it before the browser
 * has painted anything.
 */
export interface DiffRenderOptions {
  /**
   * Draw a control bar above each hunk. Called with the hunk, its index within
   * the whole diff, and the row that holds the controls.
   */
  hunkBar?: (bar: HTMLElement, hunk: DiffHunk, hunkIndex: number) => void;
  /**
   * Line-picking mode: put a checkbox beside every added and removed line.
   * Called with the checkbox, the hunk index and the line's index within that
   * hunk, which is the coordinate `buildHunkPatch` takes.
   */
  lineCheckbox?: (box: HTMLInputElement, hunkIndex: number, lineIndex: number) => void;
}

export function renderUnifiedDiff(
  parent: HTMLElement,
  diff: string,
  opts: DiffRenderOptions = {}
): HTMLElement {
  const wrapper = parent.createDiv({ cls: "d2h-wrapper" });
  // Hunks are numbered across the WHOLE diff, not per file: the coordinate has
  // to survive a multi-file diff, and a caller holding "hunk 3" must not have to
  // know which file it came from.
  let hunkIndex = 0;
  for (const file of parseUnifiedDiff(diff)) {
    const fileWrap = wrapper.createDiv({ cls: "d2h-file-wrapper" });
    const table = fileWrap
      .createDiv({ cls: "d2h-file-diff" })
      .createDiv({ cls: "d2h-code-wrapper" })
      .createEl("table", { cls: "d2h-diff-table" });
    const tbody = table.createEl("tbody", { cls: "d2h-diff-tbody" });
    for (const hunk of file.hunks) {
      renderHunkHeader(tbody, hunk.header, hunk, hunkIndex, opts);
      const pickable = new Set(selectableLines(hunk));
      hunk.lines.forEach((line, i) => {
        renderLine(tbody, line, hunkIndex, i, pickable.has(i) ? opts : {});
      });
      hunkIndex++;
    }
  }
  return wrapper;
}

/**
 * The `@@ … @@` separator row: no line numbers, header text across the code
 * cell, and the hunk's controls when the caller supplies any.
 *
 * The controls live in the header row rather than floating over the hunk so
 * they scroll with it and cannot cover a line of the diff.
 */
function renderHunkHeader(
  tbody: HTMLElement,
  header: string,
  hunk: DiffHunk,
  hunkIndex: number,
  opts: DiffRenderOptions
): void {
  const tr = tbody.createEl("tr");
  tr.createEl("td", { cls: "d2h-code-linenumber d2h-info" });
  const cell = tr.createEl("td", { cls: "d2h-info" });
  cell.createDiv({ cls: "d2h-code-line", text: header });
  if (opts.hunkBar) opts.hunkBar(cell.createDiv({ cls: "ngb-hunk-bar" }), hunk, hunkIndex);
}

function renderLine(
  tbody: HTMLElement,
  line: DiffLine,
  hunkIndex: number,
  lineIndex: number,
  opts: DiffRenderOptions
): void {
  const kindCls =
    line.kind === "insert" ? "d2h-ins" : line.kind === "delete" ? "d2h-del" : "d2h-cntx";
  // `d2h-change` marks the half of a change rather than a pure add/remove.
  // Nothing in styles.css keys off it today; it is kept because it is real
  // information about the row and costs one token.
  const cls = line.paired === true ? `${kindCls} d2h-change` : kindCls;

  const tr = tbody.createEl("tr");
  const gutter = tr.createEl("td", { cls: `d2h-code-linenumber ${cls}` });
  // The checkbox goes FIRST in the gutter, left of the numbers: it belongs to
  // the row, and on a phone the left edge is the only part of a wide diff that
  // is reliably reachable without scrolling sideways.
  if (opts.lineCheckbox) {
    const box = gutter.createEl("input", { cls: "ngb-line-pick" });
    box.type = "checkbox";
    opts.lineCheckbox(box, hunkIndex, lineIndex);
  }
  gutter.createDiv({ cls: "line-num1", text: line.oldNumber === null ? "" : String(line.oldNumber) });
  gutter.createDiv({ cls: "line-num2", text: line.newNumber === null ? "" : String(line.newNumber) });
  // The prefix lives in the STICKY gutter, not in the code cell: in the code
  // cell it scrolled away horizontally and, when lines wrap, read like content.
  gutter.createSpan({
    cls: "d2h-code-line-prefix",
    text: line.kind === "insert" ? "+" : line.kind === "delete" ? "-" : NBSP,
  });

  const code = tr.createEl("td", { cls: cls }).createDiv({ cls: "d2h-code-line" });
  const ctn = code.createSpan({ cls: "d2h-code-line-ctn" });
  if (line.runs === undefined) ctn.setText(line.text);
  else renderRuns(ctn, line.runs, line.kind);
}

/**
 * The changed stretches of a line. `<del>`/`<ins>` rather than a span with a
 * class: they are what the stylesheet already targets, and they carry the
 * meaning to a screen reader for free.
 *
 * A run whose kind belongs to the OTHER side is skipped, so the deletion row
 * shows what was removed and the insertion row shows what was added, and
 * neither shows both.
 */
function renderRuns(ctn: HTMLElement, runs: InlineRun[], kind: DiffLine["kind"]): void {
  const mark = kind === "insert" ? "add" : "remove";
  for (const run of runs) {
    if (run.kind === "same") ctn.appendText(run.text);
    else if (run.kind === mark) ctn.createEl(kind === "insert" ? "ins" : "del", { text: run.text });
    // else: the other side's run; not ours to draw.
  }
}
