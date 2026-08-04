export type BridgeUiState =
  | "disabled"
  | "clean"
  | "changed"
  | "syncing"
  | "conflict"
  | "error";

const STATE_META: Record<BridgeUiState, { cls: string; label: string }> = {
  disabled: { cls: "ngb-status-clean", label: "git: off" },
  clean: { cls: "ngb-status-clean", label: "git: clean" },
  changed: { cls: "ngb-status-changed", label: "git: changes" },
  syncing: { cls: "ngb-status-syncing", label: "git: working…" },
  conflict: { cls: "ngb-status-conflict", label: "git: conflict" },
  error: { cls: "ngb-status-error", label: "git: error" },
};

/** Wraps the status bar item; pure DOM, no Obsidian import needed (testable). */
export class StatusBarController {
  private state: BridgeUiState = "disabled";

  constructor(private el: HTMLElement, onClick: () => void) {
    el.addClass("ngb-status-bar-item");
    el.addEventListener("click", onClick);
    this.set("disabled");
  }

  set(state: BridgeUiState, detail?: string): void {
    const meta = STATE_META[state];
    for (const m of Object.values(STATE_META)) this.el.removeClass(m.cls);
    this.el.addClass(meta.cls);
    this.el.setText(detail ? `${meta.label} ${detail}` : meta.label);
    this.state = state;
  }

  get current(): BridgeUiState {
    return this.state;
  }
}
