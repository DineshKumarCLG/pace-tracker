import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import CrashRecovery from "@/components/CrashRecovery";
import type { Session } from "@/types";

// Mock the db module
vi.mock("@/lib/db", () => ({
  recoverStaleSession: vi.fn().mockResolvedValue(undefined),
}));

import { recoverStaleSession } from "@/lib/db";

function makeStaleSession(overrides: Partial<Session> = {}): Session {
  return {
    id: "stale-session-1",
    userId: "u1",
    startTime: 1_700_000_000,
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: 1_700_003_600, // 1 hour after start
    syncedAt: null,
    createdAt: 1_700_000_000,
    ...overrides,
  };
}

describe("CrashRecovery", () => {
  const onRecovered = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("renders the recovery prompt with session details", () => {
    render(
      <CrashRecovery session={makeStaleSession()} onRecovered={onRecovered} />,
    );

    expect(screen.getByText("Session interrupted")).toBeDefined();
    expect(screen.getByText(/last session wasn't closed properly/)).toBeDefined();
    expect(screen.getByText("Recover session")).toBeDefined();
    expect(screen.getByText("Discard")).toBeDefined();
    expect(screen.getByLabelText("Confirm end time")).toBeDefined();
  });

  it("displays session start time and last heartbeat", () => {
    render(
      <CrashRecovery session={makeStaleSession()} onRecovered={onRecovered} />,
    );

    expect(screen.getByText("Started")).toBeDefined();
    expect(screen.getByText("Last heartbeat")).toBeDefined();
    expect(screen.getByText("Duration")).toBeDefined();
  });

  it("calls recoverStaleSession and onRecovered when Recover is clicked", async () => {
    const user = userEvent.setup();
    const session = makeStaleSession();

    render(
      <CrashRecovery session={session} onRecovered={onRecovered} />,
    );

    await user.click(screen.getByText("Recover session"));

    expect(recoverStaleSession).toHaveBeenCalledWith(
      "stale-session-1",
      expect.any(Number),
    );
    expect(onRecovered).toHaveBeenCalled();
  });

  it("calls recoverStaleSession with lastHeartbeat time when Discard is clicked", async () => {
    const user = userEvent.setup();
    const session = makeStaleSession();

    render(
      <CrashRecovery session={session} onRecovered={onRecovered} />,
    );

    await user.click(screen.getByText("Discard"));

    expect(recoverStaleSession).toHaveBeenCalledWith(
      "stale-session-1",
      1_700_003_600, // lastHeartbeat
    );
    expect(onRecovered).toHaveBeenCalled();
  });

  it("shows error message when recovery fails", async () => {
    const user = userEvent.setup();
    vi.mocked(recoverStaleSession).mockRejectedValueOnce(
      new Error("DB error"),
    );

    render(
      <CrashRecovery session={makeStaleSession()} onRecovered={onRecovered} />,
    );

    await user.click(screen.getByText("Recover session"));

    expect(screen.getByRole("alert")).toBeDefined();
    expect(onRecovered).not.toHaveBeenCalled();
  });

  it("handles session with null lastHeartbeat gracefully", () => {
    const session = makeStaleSession({ lastHeartbeat: null });

    render(
      <CrashRecovery session={session} onRecovered={onRecovered} />,
    );

    expect(screen.getByText("—")).toBeDefined();
  });
});
