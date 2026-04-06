import { describe, it, expect, vi, beforeEach } from "vitest";

/**
 * Unit tests for API key isolation.
 *
 * Verifies that no API keys, provider credentials, or secrets
 * are included in any outgoing request from the desktop client.
 * PocketBase JS hooks resolve keys server-side.
 *
 * Validates: Requirement 17.2
 */

// Capture all calls to pb.send
const mockSend = vi.fn();

vi.mock("@/lib/pocketbase", () => ({
  pb: {
    send: (...args: unknown[]) => mockSend(...args),
  },
}));

import { generateWeeklyReview, parseTask } from "@/lib/ai";

beforeEach(() => {
  mockSend.mockReset();
  mockSend.mockResolvedValue({ narrative: "test", title: "test" });
});

/** Check that a payload object contains no credential-like fields */
function assertNoCredentials(payload: Record<string, unknown>) {
  const credentialFields = [
    "apiKey", "api_key", "apikey",
    "secret", "secretKey", "secret_key",
    "token", "authToken", "auth_token",
    "password", "masterKey", "master_key",
    "authorization", "Authorization",
    "litellmApiKey", "litellm_api_key",
    "openaiKey", "anthropicKey", "geminiKey",
    "aws_secret_access_key", "aws_access_key_id",
  ];

  const allKeys = Object.keys(payload);
  for (const key of allKeys) {
    expect(credentialFields).not.toContain(key);
  }

  // Also check nested objects
  for (const value of Object.values(payload)) {
    if (typeof value === "object" && value !== null && !Array.isArray(value)) {
      assertNoCredentials(value as Record<string, unknown>);
    }
    if (Array.isArray(value)) {
      for (const item of value) {
        if (typeof item === "object" && item !== null) {
          assertNoCredentials(item as Record<string, unknown>);
        }
      }
    }
  }
}

describe("API Key Isolation", () => {
  it("weekly review request contains no API keys in headers or body", async () => {
    await generateWeeklyReview("user-1", 1700000000);

    expect(mockSend).toHaveBeenCalledTimes(1);
    const [endpoint, options] = mockSend.mock.calls[0];

    expect(endpoint).toBe("/api/generate-review");

    // Check body has no credentials
    const body = options.body as Record<string, unknown>;
    assertNoCredentials(body);

    // Body should only contain userId, weekStart, and optionally model
    const allowedKeys = ["userId", "weekStart", "model"];
    for (const key of Object.keys(body)) {
      expect(allowedKeys).toContain(key);
    }
  });

  it("weekly review payload contains only userId, weekStart, model — no credentials", async () => {
    await generateWeeklyReview("user-1", 1700000000, "gpt-4o");

    const body = mockSend.mock.calls[0][1].body as Record<string, unknown>;

    expect(body).toEqual({
      userId: "user-1",
      weekStart: 1700000000,
      model: "gpt-4o",
    });
  });

  it("parse-task request contains no API keys in body", async () => {
    const projects = [{ id: "p1", name: "PACE" }];
    const team = [{ id: "u1", name: "Arjun" }];

    await parseTask("fix the bug", projects, team);

    const body = mockSend.mock.calls[0][1].body as Record<string, unknown>;
    assertNoCredentials(body);

    // Body should only contain text, projects, team, and optionally model
    const allowedKeys = ["text", "projects", "team", "model"];
    for (const key of Object.keys(body)) {
      expect(allowedKeys).toContain(key);
    }
  });

  it("no request includes Authorization header from client", async () => {
    await generateWeeklyReview("user-1", 1700000000);

    const options = mockSend.mock.calls[0][1] as Record<string, unknown>;

    // pb.send doesn't include custom auth headers — PocketBase handles auth via cookies/tokens
    expect(options).not.toHaveProperty("headers");
  });

  it("settings litellmApiKey is never sent in AI requests", async () => {
    // Even if settings has a litellmApiKey, it should NOT appear in AI request payloads
    // The key is stored locally for the "Test connection" feature only
    // PocketBase hooks use server-side environment variables

    await generateWeeklyReview("user-1", 1700000000);
    await parseTask("test task", [], []);

    for (const call of mockSend.mock.calls) {
      const body = call[1].body as Record<string, unknown>;
      expect(body).not.toHaveProperty("litellmApiKey");
      expect(body).not.toHaveProperty("apiKey");
      expect(body).not.toHaveProperty("api_key");
    }
  });
});
