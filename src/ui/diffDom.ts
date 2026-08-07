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

import { parseUnifiedDiff, type DiffLine } from "../git/unifiedDiff";
import type { InlineRun } from "../git/inlineDiff";

/** Non-breaking space: the prefix cell of a context line, as diff2html had it. */
const NBSP = " ";

/**
 * Render `diff` (raw unified diff text from git) into `parent`.
 *
 * Returns the wrapper element, so a caller can measure it before the browser
 * has painted anything.
 */
export function renderUnifiedDiff(parent: HTMLElement, diff: string): HTMLElement {
  const wrapper = parent.createDiv({ cls: "d2h-wrapper" });
  for (const file of parseUnifiedDiff(diff)) {
    const fileWrap = wrapper.createDiv({ cls: "d2h-file-wrapper" });
    const table = fileWrap
      .createDiv({ cls: "d2h-file-diff" })
      .createDiv({ cls: "d2h-code-wrapper" })
      .createEl("table", { cls: "d2h-diff-table" });
    const tbody = table.createEl("tbody", { cls: "d2h-diff-tbody" });
    for (const hunk of file.hunks) {
      renderHunkHeader(tbody, hunk.header);
      for (const line of hunk.lines) renderLine(tbody, line);
    }
  }
  return wrapper;
}

/** The `@@ … @@` separator row: no line numbers, header text across the code cell. */
function renderHunkHeader(tbody: HTMLElement, header: string): void {
  const tr = tbody.createEl("tr");
  tr.createEl("td", { cls: "d2h-code-linenumber d2h-info" });
  tr.createEl("td", { cls: "d2h-info" }).createDiv({ cls: "d2h-code-line", text: header });
}

function renderLine(tbody: HTMLElement, line: DiffLine): void {
  const kindCls =
    line.kind === "insert" ? "d2h-ins" : line.kind === "delete" ? "d2h-del" : "d2h-cntx";
  // `d2h-change` marks the half of a change rather than a pure add/remove.
  // Nothing in styles.css keys off it today; it is kept because it is real
  // information about the row and costs one token.
  const cls = line.paired === true ? `${kindCls} d2h-change` : kindCls;

  const tr = tbody.createEl("tr");
  const gutter = tr.createEl("td", { cls: `d2h-code-linenumber ${cls}` });
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
