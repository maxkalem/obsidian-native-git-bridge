import { describe, expect, it } from "vitest";
import {
  CURRENT_SCHEMA_VERSION,
  DEFAULT_DEVICE_SETTINGS,
  DeviceLocalSettingsStore,
  generateToken,
  type KeyValueBackend,
} from "../src/settings/DeviceLocalSettingsStore";

function fakeBackend(): KeyValueBackend & { map: Map<string, string> } {
  const map = new Map<string, string>();
  return {
    map,
    getItem: (k) => map.get(k) ?? null,
    setItem: (k, v) => void map.set(k, v),
    removeItem: (k) => void map.delete(k),
  };
}

describe("DeviceLocalSettingsStore", () => {
  it("returns defaults when empty and is disabled by default", () => {
    const s = new DeviceLocalSettingsStore(fakeBackend(), "vault1").read();
    expect(s).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(s.enabledOnThisDevice).toBe(false);
    expect(s.autoPullOnOpen).toBe(false);
    expect(s.protectedPaths).toEqual(["Private/AgentsMemory", "Projects/Backus"]);
  });

  it("persists patches under a vault-scoped key", () => {
    const b = fakeBackend();
    const store = new DeviceLocalSettingsStore(b, "vaultA");
    store.write({ enabledOnThisDevice: true, repoPathHint: "/storage/emulated/0/V" });
    expect([...b.map.keys()][0]).toContain("vaultA");
    expect(new DeviceLocalSettingsStore(b, "vaultA").read().enabledOnThisDevice).toBe(true);
    // other vault scope unaffected
    expect(new DeviceLocalSettingsStore(b, "vaultB").read().enabledOnThisDevice).toBe(false);
  });

  it("migrates unknown/typed-wrong fields back to defaults", () => {
    const b = fakeBackend();
    const store = new DeviceLocalSettingsStore(b, "v");
    b.map.set(
      [...b.map.keys()][0] ?? "ngb:v1:v:settings",
      JSON.stringify({ schemaVersion: 0, enabledOnThisDevice: "yes", protectedPaths: [42], junk: 1 })
    );
    b.map.set("ngb:v1:v:settings", JSON.stringify({ schemaVersion: 0, enabledOnThisDevice: "yes", protectedPaths: [42], junk: 1 }));
    const s = store.read();
    expect(s.schemaVersion).toBe(CURRENT_SCHEMA_VERSION);
    expect(s.enabledOnThisDevice).toBe(false); // wrong type dropped
    expect(s.protectedPaths).toEqual(DEFAULT_DEVICE_SETTINGS.protectedPaths);
    expect((s as unknown as Record<string, unknown>).junk).toBeUndefined();
  });

  it("recovers gracefully from corrupted JSON and quarantines it", () => {
    const b = fakeBackend();
    b.map.set("ngb:v1:v:settings", "{corrupt!!!");
    const store = new DeviceLocalSettingsStore(b, "v");
    expect(store.read()).toEqual(DEFAULT_DEVICE_SETTINGS);
    expect(b.map.get("ngb:v1:v:corrupt")).toBe("{corrupt!!!");
  });

  it("falls back to volatile memory when backend is missing or throws", () => {
    const store = new DeviceLocalSettingsStore(null, "v");
    expect(store.isVolatile).toBe(true);
    store.write({ enabledOnThisDevice: true });
    expect(store.read().enabledOnThisDevice).toBe(true);

    const throwing: KeyValueBackend = {
      getItem: () => {
        throw new Error("quota");
      },
      setItem: () => {
        throw new Error("quota");
      },
      removeItem: () => {
        throw new Error("quota");
      },
    };
    const store2 = new DeviceLocalSettingsStore(throwing, "v");
    store2.write({ repoPathHint: "/x" });
    expect(store2.isVolatile).toBe(true);
    expect(store2.read().repoPathHint).toBe("/x");
  });

  it("reset restores defaults", () => {
    const b = fakeBackend();
    const store = new DeviceLocalSettingsStore(b, "v");
    store.write({ enabledOnThisDevice: true });
    store.reset();
    expect(store.read().enabledOnThisDevice).toBe(false);
  });

  it("generateToken produces distinct url-safe tokens", () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
    expect(a).toMatch(/^[0-9A-Za-z]{24}$/);
  });
});
