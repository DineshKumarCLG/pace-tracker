import { describe, it, expect, vi, beforeEach } from "vitest";
import { isSessionStale } from "@/lib/db";
import type { Session } from "@/types";

function makeSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "s1",
    userId: "u1",
    startTime: 1000,
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: null,
    syncedAt: null,
    createdAt: 1000,
    ...overrides,
  };
}

describe("isSessionStale", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  it("returns true when lastHeartbeat is null", () => {
    const session = makeSession({ lastHeartbeat: null });
    expect(isSessionStale(session)).toBe(true);
  });

  it("returns true when lastHeartbeat is older than 30 seconds", () => {
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));
    const session = makeSession({ lastHeartbeat: now - 31 });
    expect(isSessionStale(session)).toBe(true);
  });

  it("returns false when lastHeartbeat is within 30 seconds", () => {
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));
    const session = makeSession({ lastHeartbeat: now - 10 });
    expect(isSessionStale(session)).toBe(false);
  });

  it("returns false when lastHeartbeat is exactly 30 seconds ago", () => {
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));
    const session = makeSession({ lastHeartbeat: now - 30 });
    expect(isSessionStale(session)).toBe(false);
  });

  it("returns true when lastHeartbeat is exactly 31 seconds ago", () => {
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));
    const session = makeSession({ lastHeartbeat: now - 31 });
    expect(isSessionStale(session)).toBe(true);
  });

  it("returns true when lastHeartbeat is very old (hours ago)", () => {
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));
    // Simulate a crash from 3 hours ago
    const session = makeSession({ lastHeartbeat: now - 3 * 3600 });
    expect(isSessionStale(session)).toBe(true);
  });

  it("classification is independent of other session fields", () => {
    const now = 1_700_000_000;
    vi.setSystemTime(new Date(now * 1000));

    // Fresh session with various field combinations → not stale
    const freshSession = makeSession({
      lastHeartbeat: now - 5,
      startType: "backfill",
      startVerified: false,
      outputNote: "some note",
    });
    expect(isSessionStale(freshSession)).toBe(false);

    // Stale session with various field combinations → stale
    const staleSession = makeSession({
      lastHeartbeat: now - 60,
      startType: "recovered",
      startVerified: true,
      outputNote: null,
    });
    expect(isSessionStale(staleSession)).toBe(true);
  });
});
