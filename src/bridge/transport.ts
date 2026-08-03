import type { BridgeIntegrationType } from "../types";

export interface TriggerOutcome {
  kind: "manual" | "intent";
  /** Human instruction to show when the trigger needs a user action. */
  instruction?: string;
}

/** Strategy for getting the Termux-side runner started for a queued request. */
export interface TriggerTransport {
  readonly type: BridgeIntegrationType;
  trigger(requestId: string): TriggerOutcome;
}

/**
 * Default, fully documented transport: the user taps the pinned Termux:Widget
 * shortcut which runs the runner once as a Termux background task.
 */
export class WidgetManualTransport implements TriggerTransport {
  readonly type = "widget-manual" as const;

  trigger(_requestId: string): TriggerOutcome {
    return {
      kind: "manual",
      instruction:
        'Request queued. Tap the "GitBridge" shortcut in your Termux widget to run it.',
    };
  }
}

/**
 * Experimental transport: opens a custom-scheme URI handled by the optional
 * companion app, which holds com.termux.permission.RUN_COMMAND and forwards a
 * fixed runner invocation to Termux. Only the request id travels in the URI —
 * never the token, never command content.
 */
export class CompanionIntentTransport implements TriggerTransport {
  readonly type = "companion-intent" as const;

  constructor(
    private uriTemplate: string,
    private openUri: (uri: string) => void
  ) {}

  trigger(requestId: string): TriggerOutcome {
    const safeId = encodeURIComponent(requestId);
    this.openUri(this.uriTemplate.replace("{id}", safeId));
    return { kind: "intent" };
  }
}
