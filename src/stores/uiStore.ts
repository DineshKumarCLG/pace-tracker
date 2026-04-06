import { create } from "zustand";

type Theme = "light" | "dark" | "system";
type SyncStatus = "synced" | "syncing" | "offline" | "error";

interface UiState {
  sidebarCollapsed: boolean;
  theme: Theme;
  syncStatus: SyncStatus;
  lastSyncTime: number | null;
}

interface UiActions {
  setSidebarCollapsed: (collapsed: boolean) => void;
  setTheme: (theme: Theme) => void;
  setSyncStatus: (status: SyncStatus) => void;
  setLastSyncTime: (time: number | null) => void;
}

export const useUiStore = create<UiState & UiActions>((set) => ({
  sidebarCollapsed: false,
  theme: "system",
  syncStatus: "synced",
  lastSyncTime: null,

  setSidebarCollapsed: (collapsed) => set({ sidebarCollapsed: collapsed }),
  setTheme: (theme) => set({ theme }),
  setSyncStatus: (status) => set({ syncStatus: status }),
  setLastSyncTime: (time) => set({ lastSyncTime: time }),
}));
