import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import StartSessionFlow from "@/components/StartSessionFlow";
import { useSessionStore } from "@/stores/sessionStore";
import type { Session } from "@/types";

// Mock db module
vi.mock("@/lib/db", () => ({
  startSession: vi.fn(),
  getDeviceWakeTime: vi.fn(),
}));

import { startSession, getDeviceWakeTime } from "@/lib/db";

function makeSession(overrides: Partial<Session> = {}): Session {
  const now = Math.floor(Date.now() / 1000);
  return {
    id: "session-1",
    userId: "default-user",
    startTime: now,
    endTime: null,
    startType: "manual",
    startVerified: true,
    outputNote: null,
    lastHeartbeat: now,
    syncedAt: null,
    createdAt: now,
    ...overrides,
  };
}

describe("StartSessionFlow", () => {
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().clearSession();
    vi.mocked(getDeviceWakeTime).mockResolvedValue(
      Math.floor(Date.now() / 1000) - 600,
    );
    vi.mocked(startSession).mockResolvedValue(makeSession());
  });

  it("renders the 'When did you start?' prompt with default current time", () => {
    render(<StartSessionFlow onCancel={onCancel} />);

    expect(screen.getByText("When did you start?")).toBeDefined();
    expect(screen.getByLabelText("Start time")).toBeDefined();
    expect(screen.getByText("Start session")).toBeDefined();
    expect(screen.getByText("Cancel")).toBeDefined();
  });

  it("shows device wake time as a suggestion button", async () => {
    render(<StartSessionFlow onCancel={onCancel} />);

    // Wait for the wake time to load
    const wakeBtn = await screen.findByText(/Device woke at/);
    expect(wakeBtn).toBeDefined();
  });

  it("calls startSession and updates sessionStore on success", async () => {
    const user = userEvent.setup();
    const session = makeSession();
    vi.mocked(startSession).mockResolvedValue(session);

    render(<StartSessionFlow onCancel={onCancel} />);

    await user.click(screen.getByText("Start session"));

    expect(startSession).toHaveBeenCalledWith(
      "default-user",
      expect.any(Number),
    );
    // Session should be set in the store
    expect(useSessionStore.getState().session).toEqual(session);
  });

  it("shows error when startSession fails", async () => {
    const user = userEvent.setup();
    vi.mocked(startSession).mockRejectedValueOnce(new Error("DB error"));

    render(<StartSessionFlow onCancel={onCancel} />);

    await user.click(screen.getByText("Start session"));

    expect(screen.getByRole("alert")).toBeDefined();
    expect(useSessionStore.getState().session).toBeNull();
  });

  it("rejects start time more than 4 hours ago", async () => {
    const user = userEvent.setup();
    const fiveHoursAgo = Math.floor(Date.now() / 1000) - 5 * 3600;
    const d = new Date(fiveHoursAgo * 1000);
    const pad = (n: number) => String(n).padStart(2, "0");
    const value = `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;

    render(<StartSessionFlow onCancel={onCancel} />);

    // Use fireEvent to set the datetime-local value directly (userEvent doesn't handle datetime-local well)
    const input = screen.getByLabelText("Start time") as HTMLInputElement;
    // Simulate native change event
    Object.getOwnPropertyDescriptor(
      HTMLInputElement.prototype,
      "value",
    )?.set?.call(input, value);
    input.dispatchEvent(new Event("change", { bubbles: true }));

    await user.click(screen.getByText("Start session"));

    expect(screen.getByRole("alert").textContent).toContain(
      "more than 4 hours ago",
    );
    expect(startSession).not.toHaveBeenCalled();
  });

  it("calls onCancel when Cancel is clicked", async () => {
    const user = userEvent.setup();

    render(<StartSessionFlow onCancel={onCancel} />);

    await user.click(screen.getByText("Cancel"));

    expect(onCancel).toHaveBeenCalled();
  });

  it("shows 'Now' quick-pick button", () => {
    render(<StartSessionFlow onCancel={onCancel} />);

    expect(screen.getByText("Now")).toBeDefined();
  });

  it("handles missing device wake time gracefully", async () => {
    vi.mocked(getDeviceWakeTime).mockRejectedValueOnce(
      new Error("Not available"),
    );

    render(<StartSessionFlow onCancel={onCancel} />);

    // Should still render without the wake time button
    expect(screen.getByText("When did you start?")).toBeDefined();
    // Wait a tick for the effect to settle
    await vi.waitFor(() => {
      expect(screen.queryByText(/Device woke at/)).toBeNull();
    });
  });
});
