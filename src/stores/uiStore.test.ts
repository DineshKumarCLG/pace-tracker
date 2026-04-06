import { describe, it, expect, beforeEach } from "vitest";
import { useUiStore } from "./uiStore";

describe("uiStore", () => {
  beforeEach(() => {
    useUiStore.setState({
      sidebarCollapsed: false,
      theme: "system",
      syncStatus: "synced",
      lastSyncTime: null,
    });
  });

  it("setSidebarCollapsed toggles sidebar", () => {
    useUiStore.getState().setSidebarCollapsed(true);
    expect(useUiStore.getState().sidebarCollapsed).toBe(true);
  });

  it("setTheme applies theme immediately", () => {
    useUiStore.getState().setTheme("dark");
    expect(useUiStore.getState().theme).toBe("dark");
    useUiStore.getState().setTheme("light");
    expect(useUiStore.getState().theme).toBe("light");
  });

  it("setSyncStatus reflects current sync state", () => {
    useUiStore.getState().setSyncStatus("syncing");
    expect(useUiStore.getState().syncStatus).toBe("syncing");
    useUiStore.getState().setSyncStatus("offline");
    expect(useUiStore.getState().syncStatus).toBe("offline");
    useUiStore.getState().setSyncStatus("error");
    expect(useUiStore.getState().syncStatus).toBe("error");
  });

  it("setLastSyncTime stores the timestamp", () => {
    const now = Date.now();
    useUiStore.getState().setLastSyncTime(now);
    expect(useUiStore.getState().lastSyncTime).toBe(now);
  });

  it("setLastSyncTime can be cleared to null", () => {
    useUiStore.getState().setLastSyncTime(1700000000);
    useUiStore.getState().setLastSyncTime(null);
    expect(useUiStore.getState().lastSyncTime).toBeNull();
  });

  it("setTheme cycles through all valid values including system", () => {
    useUiStore.getState().setTheme("dark");
    expect(useUiStore.getState().theme).toBe("dark");
    useUiStore.getState().setTheme("system");
    expect(useUiStore.getState().theme).toBe("system");
    useUiStore.getState().setTheme("light");
    expect(useUiStore.getState().theme).toBe("light");
  });

  it("setSyncStatus transitions correctly between all states", () => {
    useUiStore.getState().setSyncStatus("syncing");
    expect(useUiStore.getState().syncStatus).toBe("syncing");
    useUiStore.getState().setSyncStatus("synced");
    expect(useUiStore.getState().syncStatus).toBe("synced");
    useUiStore.getState().setSyncStatus("offline");
    expect(useUiStore.getState().syncStatus).toBe("offline");
    useUiStore.getState().setSyncStatus("error");
    expect(useUiStore.getState().syncStatus).toBe("error");
    useUiStore.getState().setSyncStatus("synced");
    expect(useUiStore.getState().syncStatus).toBe("synced");
  });
});
