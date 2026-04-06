import { create } from "zustand";
import { pb } from "@/lib/pocketbase";

export interface AuthUser {
  id: string;
  name: string;
  email: string;
  role: string | null;
  avatarColor: string;
}

interface AuthState {
  user: AuthUser | null;
  isAuthenticated: boolean;
  isLoading: boolean;
}

interface AuthActions {
  login: (email: string, password: string) => Promise<void>;
  signup: (name: string, email: string, password: string) => Promise<void>;
  logout: () => void;
  checkAuth: () => void;
}

/** Map a PocketBase auth record to our AuthUser shape. */
function mapRecordToUser(record: Record<string, unknown>): AuthUser {
  return {
    id: (record.id as string) ?? "",
    name: (record.name as string) ?? "",
    email: (record.email as string) ?? "",
    role: (record.role as string) ?? null,
    avatarColor: (record.avatarColor as string) ?? "#d97706",
  };
}

/* ── Dev mode test user (no PocketBase needed) ── */

function isDevAuth(): boolean {
  try { return import.meta.env.VITE_DEV_AUTH === "true"; } catch { return false; }
}

const DEV_USER: AuthUser = {
  id: "dev-user-001",
  name: "Kenesis (Dev)",
  email: "dev@kenesis.ai",
  role: "Co-founder, Engineering",
  avatarColor: "#6e6af6",
};

export const useAuthStore = create<AuthState & AuthActions>((set) => ({
  user: null,
  isAuthenticated: false,
  isLoading: true,

  login: async (email: string, password: string) => {
    if (isDevAuth()) {
      set({ user: DEV_USER, isAuthenticated: true });
      return;
    }
    const authData = await pb
      .collection("users")
      .authWithPassword(email, password);
    const user = mapRecordToUser(authData.record as unknown as Record<string, unknown>);
    persistToken();
    set({ user, isAuthenticated: true });
  },

  signup: async (name: string, email: string, password: string) => {
    if (isDevAuth()) {
      set({ user: { ...DEV_USER, name, email }, isAuthenticated: true });
      return;
    }
    await pb.collection("users").create({
      name: name.trim(),
      email: email.trim(),
      password,
      passwordConfirm: password,
    });
    // Auto-login after signup
    const authData = await pb
      .collection("users")
      .authWithPassword(email.trim(), password);
    const user = mapRecordToUser(authData.record as unknown as Record<string, unknown>);
    persistToken();
    set({ user, isAuthenticated: true });
  },

  logout: () => {
    if (isDevAuth()) {
      set({ user: null, isAuthenticated: false });
      return;
    }
    pb.authStore.clear();
    clearPersistedToken();
    set({ user: null, isAuthenticated: false });
  },

  checkAuth: () => {
    if (isDevAuth()) {
      set({ user: DEV_USER, isAuthenticated: true, isLoading: false });
      return;
    }
    // Restore token from localStorage if available
    restoreToken();

    if (pb.authStore.isValid && pb.authStore.record) {
      const user = mapRecordToUser(pb.authStore.record as unknown as Record<string, unknown>);
      set({ user, isAuthenticated: true, isLoading: false });
    } else {
      pb.authStore.clear();
      clearPersistedToken();
      set({ user: null, isAuthenticated: false, isLoading: false });
    }
  },
}));

/* ── Token persistence helpers ── */

function persistToken(): void {
  try {
    localStorage.setItem("pb_auth_token", pb.authStore.token);
    localStorage.setItem("pb_auth_model", JSON.stringify(pb.authStore.record));
  } catch {
    // Storage unavailable — token stays in PocketBase authStore memory
  }
}

function restoreToken(): void {
  try {
    const token = localStorage.getItem("pb_auth_token");
    const model = localStorage.getItem("pb_auth_model");
    if (token && model) {
      pb.authStore.save(token, JSON.parse(model));
    }
  } catch {
    // Restore failed — will fall through to unauthenticated
  }
}

function clearPersistedToken(): void {
  try {
    localStorage.removeItem("pb_auth_token");
    localStorage.removeItem("pb_auth_model");
  } catch {
    // Ignore
  }
}
