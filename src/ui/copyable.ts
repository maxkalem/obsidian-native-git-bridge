import { Notice, setIcon } from "obsidian";

/** Add a labeled "Copy" button that copies `getText()` to the clipboard. */
export function addCopyButton(
  parent: HTMLElement,
  getText: () => string,
  label = "Copy",
  noticeText = "Copied to clipboard."
): HTMLButtonElement {
  const btn = parent.createEl("button", { cls: "ngb-copy-btn" });
  const iconEl = btn.createSpan();
  setIcon(iconEl, "copy");
  btn.createSpan({ text: ` ${label}` });
  btn.addEventListener("click", () => {
    // The old document.execCommand fallback is gone: it is deprecated, and
    // Obsidian ships a Clipboard API on every platform this plugin supports.
    void (async () => {
      try {
        await navigator.clipboard.writeText(getText());
        new Notice(noticeText);
      } catch {
        new Notice("Could not access the clipboard.");
      }
    })();
  });
  return btn;
}
