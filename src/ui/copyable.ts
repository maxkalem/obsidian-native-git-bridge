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
  btn.addEventListener("click", async () => {
    const text = getText();
    try {
      await navigator.clipboard.writeText(text);
      new Notice(noticeText);
    } catch {
      // Clipboard API can be unavailable; fall back to a hidden textarea.
      const ta = document.createElement("textarea");
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      try {
        document.execCommand("copy");
        new Notice(noticeText);
      } catch {
        new Notice("Could not access the clipboard.");
      }
      ta.remove();
    }
  });
  return btn;
}
