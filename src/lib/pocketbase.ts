/**
 * PocketBase Client Configuration
 *
 * Provides a configured PocketBase client instance and auth helper functions.
 * The URL defaults to a placeholder and can be configured via settings.
 */

import PocketBase from "pocketbase";

/**
 * The packaged app cannot assume a PocketBase process is running on the
 * user's machine. Prefer a build-time URL, while keeping localhost as a
 * useful development fallback.
 */
export const DEFAULT_POCKETBASE_URL =
  import.meta.env.VITE_POCKETBASE_URL?.trim() || "http://127.0.0.1:8090";

function getInitialPocketBaseUrl(): string {
  try {
    return localStorage.getItem("pace_pb_url") || DEFAULT_POCKETBASE_URL;
  } catch {
    return DEFAULT_POCKETBASE_URL;
  }
}

export function normalizePocketBaseUrl(url: string): string {
  const value = url.trim().replace(/\/+$/, "");
  if (!value) throw new Error("Enter a PocketBase server URL.");

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error("Enter a complete server URL, such as https://pace.example.com.");
  }

  if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
    throw new Error("The server URL must use http:// or https://.");
  }

  return parsed.toString().replace(/\/+$/, "");
}

/** Singleton PocketBase client instance. */
export const pb = new PocketBase(normalizePocketBaseUrl(getInitialPocketBaseUrl()));

/** Return the active server URL for auth diagnostics and settings UI. */
export function getPocketBaseUrl(): string {
  return pb.baseURL;
}

/**
 * Update the PocketBase base URL at runtime.
 * Called when the user changes the sync server URL in Settings.
 */
export function setPocketBaseUrl(url: string): void {
  pb.baseURL = normalizePocketBaseUrl(url);
}

/** Check that the selected PocketBase server is reachable before submitting auth. */
export async function checkPocketBaseHealth(timeoutMs = 5000): Promise<void> {
  const controller = new AbortController();
  const timeout = window.setTimeout(() => controller.abort(), timeoutMs);

  try {
    const response = await fetch(`${pb.baseURL}/api/health`, {
      method: "GET",
      signal: controller.signal,
      headers: { Accept: "application/json" },
    });
    if (!response.ok) throw new Error(`Server returned ${response.status}.`);
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("The server took too long to respond.");
    }
    if (error instanceof TypeError) {
      throw new Error("The server could not be reached. Check the URL and your connection.");
    }
    throw error;
  } finally {
    window.clearTimeout(timeout);
  }
}

/**
 * Authenticate with PocketBase using email/password.
 * Stores the auth token in the PocketBase client for subsequent requests.
 */
export async function login(
  email: string,
  password: string,
): Promise<{ id: string; email: string; name: string }> {
  const authData = await pb
    .collection("users")
    .authWithPassword(email, password);
  return {
    id: authData.record.id,
    email: authData.record.email,
    name: authData.record.name ?? "",
  };
}

/** Clear the stored auth token and log out. */
export function logout(): void {
  pb.authStore.clear();
}

/** Whether the client currently holds a valid auth token. */
export function isAuthenticated(): boolean {
  return pb.authStore.isValid;
}

/** Get the currently authenticated user's ID, or null. */
export function getCurrentUserId(): string | null {
  if (!pb.authStore.isValid) return null;
  return pb.authStore.record?.id ?? null;
}
