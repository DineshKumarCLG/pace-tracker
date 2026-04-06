/**
 * PocketBase Client Configuration
 *
 * Provides a configured PocketBase client instance and auth helper functions.
 * The URL defaults to a placeholder and can be configured via settings.
 */

import PocketBase from "pocketbase";

/** Default PocketBase URL — override via Settings screen. */
const DEFAULT_PB_URL = "http://127.0.0.1:8090";

/** Singleton PocketBase client instance. */
export const pb = new PocketBase(DEFAULT_PB_URL);

/**
 * Update the PocketBase base URL at runtime.
 * Called when the user changes the sync server URL in Settings.
 */
export function setPocketBaseUrl(url: string): void {
  pb.baseURL = url;
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
