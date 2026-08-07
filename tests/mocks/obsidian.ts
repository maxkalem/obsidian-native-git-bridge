/**
 * Minimal runtime mock of the "obsidian" module, used ONLY by vitest (see the
 * resolve.alias in vitest.config.ts). The real `obsidian` npm package is
 * types-only, so importing src/main.ts in a test needs a runtime stand-in.
 *
 * tsc still typechecks src/ against the real obsidian typings — this file is
 * never imported by production code and changes nothing about the build.
 *
 * The mock records side effects (notices, opened modals) so orchestration
 * tests can assert on user-visible behavior without any DOM.
 */

export const __notices: string[] = [];
export const __openedModals: string[] = [];
/** obsidian:// protocol handlers registered by the plugin (action -> handler). */
export const __protocolHandlers = new Map<string, (params: Record<string, string>) => void>();
export function __resetObsidianMock(): void {
  __notices.length = 0;
  __openedModals.length = 0;
  __protocolHandlers.clear();
  __setPlatformAndroid(true);
}

/* eslint-disable @typescript-eslint/no-explicit-any */
type Any = any;

/**
 * Element stand-in that remembers its TREE: tag, classes, text and children.
 *
 * It used to return a fresh disconnected object from every createDiv/createEl,
 * which made panel structure untestable — and structure is where the bugs have
 * been. A control rendered into the wrong region, a scrolling body that was
 * never created, a banner attached to a container that is not on screen: all
 * of those pass a type check and all of them shipped. `findByClass` below is
 * what lets a test say "the toolbar is inside the bottom bar" out loud.
 *
 * It is still not a DOM: no layout, no styles, no events. CSS-level behaviour
 * (what actually scrolls, what gets clipped) can only be confirmed on a device.
 */
function fakeEl(tag = "div", cls = "", text = ""): Any {
  const el: Any = {
    tagName: tag.toUpperCase(),
    className: cls,
    style: { setProperty: () => undefined, removeProperty: () => undefined },
    disabled: false,
    children: [] as Any[],
    parent: null as Any,
    textContent: text,
    attrs: {} as Record<string, string>,
    addClass: (...c: string[]) => {
      el.className = [...el.className.split(/\s+/), ...c].filter(Boolean).join(" ");
      return el;
    },
    removeClass: (...c: string[]) => {
      el.className = el.className.split(/\s+/).filter((x: string) => x && !c.includes(x)).join(" ");
      return el;
    },
    toggleClass: (c: string, on: boolean) => (on ? el.addClass(c) : el.removeClass(c)),
    hasClass: (c: string) => el.className.split(/\s+/).includes(c),
    setText: (t: unknown) => {
      el.textContent = String(t ?? "");
      return el;
    },
    /** Obsidian's helper for appending a bare text node. */
    appendText: (t: unknown) => {
      adopt(el, fakeEl("#text", "", String(t ?? "")));
      return el;
    },
    setAttr: (k: string, v: unknown) => {
      el.attrs[k] = String(v);
      return el;
    },
    setAttribute: (k: string, v: unknown) => {
      el.attrs[k] = String(v);
      return el;
    },
    getAttribute: (k: string) => el.attrs[k] ?? null,
    empty: () => {
      el.children.length = 0;
      el.textContent = "";
      return el;
    },
    createEl: (t: string, o?: Any) => adopt(el, fakeEl(t, o?.cls ?? "", o?.text ?? "")),
    createDiv: (o?: Any) => adopt(el, fakeEl("div", o?.cls ?? "", o?.text ?? "")),
    createSpan: (o?: Any) => adopt(el, fakeEl("span", o?.cls ?? "", o?.text ?? "")),
    appendChild: (child: Any) => adopt(el, child),
    addEventListener: () => undefined,
    onClickEvent: () => undefined,
    remove: () => {
      const sibs = el.parent?.children;
      if (sibs) sibs.splice(sibs.indexOf(el), 1);
    },
    hide: () => {
      el.hidden = true;
      return el;
    },
    show: () => {
      el.hidden = false;
      return el;
    },
  };
  return el;
}

function adopt(parent: Any, child: Any): Any {
  child.parent = parent;
  parent.children.push(child);
  return child;
}

/** Depth-first search for the first descendant carrying `cls`. */
export function __findByClass(root: Any, cls: string): Any {
  for (const c of root.children ?? []) {
    if (c.hasClass?.(cls)) return c;
    const hit = __findByClass(c, cls);
    if (hit) return hit;
  }
  return null;
}

/** Every descendant carrying `cls`, in document order. */
export function __findAllByClass(root: Any, cls: string): Any[] {
  const out: Any[] = [];
  for (const c of root.children ?? []) {
    if (c.hasClass?.(cls)) out.push(c);
    out.push(...__findAllByClass(c, cls));
  }
  return out;
}

/** All text in the subtree, joined — for asserting what a panel actually says. */
export function __textOf(root: Any): string {
  const parts = [root.textContent ?? ""];
  for (const c of root.children ?? []) parts.push(__textOf(c));
  return parts.filter(Boolean).join(" ");
}

export { fakeEl as __fakeEl };

export class Notice {
  constructor(message?: unknown) {
    __notices.push(String(message ?? ""));
  }
  hide(): void {}
}

// Tests simulate the plugin's real target platform (Android) by default;
// __resetObsidianMock restores this. Individual tests may flip it to exercise
// the desktop guard.
export const Platform = {
  isAndroidApp: true,
  isMobileApp: true,
  isMobile: true,
  isDesktop: false,
  /** Decides where the panels put their controls; a tablet uses the desktop layout. */
  isPhone: true,
};

export function __setPlatformAndroid(android: boolean): void {
  Platform.isAndroidApp = android;
  Platform.isMobileApp = android;
  Platform.isMobile = android;
  Platform.isPhone = android;
  Platform.isDesktop = !android;
}

export class TFile {}
export class TFolder {}
export class Menu {
  addItem(): Menu {
    return this;
  }
  showAtMouseEvent(): void {}
}

export function setIcon(): void {}
export function addIcon(): void {}
export function normalizePath(p: string): string {
  return p;
}

export class Component {
  load(): void {}
  unload(): void {}
}

export class Modal {
  app: Any;
  contentEl = fakeEl();
  titleEl = fakeEl();
  modalEl = fakeEl();
  constructor(app: Any) {
    this.app = app;
  }
  open(): void {
    __openedModals.push(this.constructor.name);
    // Intentionally does NOT call onOpen(): orchestration tests assert WHICH
    // modal was opened, not its DOM contents.
  }
  close(): void {}
  onOpen(): void {}
  onClose(): void {}
}

export class ItemView {
  leaf: Any;
  containerEl = fakeEl();
  contentEl = fakeEl();
  app: Any;
  constructor(leaf: Any) {
    this.leaf = leaf;
  }
  getViewType(): string {
    return "";
  }
  getDisplayText(): string {
    return "";
  }
  getIcon(): string {
    return "";
  }
  onOpen(): Promise<void> {
    return Promise.resolve();
  }
  onClose(): Promise<void> {
    return Promise.resolve();
  }
  registerEvent(): void {}
  addAction(): Any {
    return fakeEl();
  }
}

export class PluginSettingTab {
  app: Any;
  plugin: Any;
  containerEl = fakeEl();
  constructor(app: Any, plugin: Any) {
    this.app = app;
    this.plugin = plugin;
  }
  display(): void {}
  hide(): void {}
}

export class Setting {
  settingEl = fakeEl();
  constructor(_containerEl?: Any) {}
  setName(): Setting {
    return this;
  }
  setDesc(): Setting {
    return this;
  }
  setHeading(): Setting {
    return this;
  }
  setClass(): Setting {
    return this;
  }
  addText(): Setting {
    return this;
  }
  addTextArea(): Setting {
    return this;
  }
  addToggle(): Setting {
    return this;
  }
  addButton(): Setting {
    return this;
  }
  addDropdown(): Setting {
    return this;
  }
  addSlider(): Setting {
    return this;
  }
  addExtraButton(): Setting {
    return this;
  }
}

export interface Command {
  id: string;
  name: string;
  callback?: () => void;
}

export class Plugin {
  app: Any;
  manifest: Any;
  commands: Command[] = [];
  private __data: unknown = null;
  constructor(app: Any, manifest: Any) {
    this.app = app;
    this.manifest = manifest;
  }
  /** Test hook: pre-seed what loadData() will return. */
  __setData(d: unknown): void {
    this.__data = d;
  }
  async loadData(): Promise<unknown> {
    return this.__data;
  }
  async saveData(d: unknown): Promise<void> {
    this.__data = d;
  }
  addCommand(cmd: Command): Command {
    this.commands.push(cmd);
    return cmd;
  }
  addRibbonIcon(): Any {
    return fakeEl();
  }
  addStatusBarItem(): Any {
    return fakeEl();
  }
  addSettingTab(): void {}
  registerView(): void {}
  registerEvent(): void {}
  registerDomEvent(): void {}
  registerObsidianProtocolHandler(action: string, handler: (params: Record<string, string>) => void): void {
    __protocolHandlers.set(action, handler);
  }
  registerInterval(id: number): number {
    return id;
  }
  onload(): void | Promise<void> {}
  onunload(): void {}
}

// Type-only names imported with `import type` vanish at runtime, but export
// harmless values in case a value import sneaks in later.
export class WorkspaceLeaf {}
export class App {}
