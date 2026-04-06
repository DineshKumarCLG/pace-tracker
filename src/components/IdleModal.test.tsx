import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import IdleModal from "@/components/IdleModal";
import { useSessionStore } from "@/stores/sessionStore";
import type { IdleInfo } from "@/stores/sessionStore";

// --- Tauri runtime mock ---
vi.mock("@/lib/tauri", () => ({
  isTauri: () => true,
}));

// Mock Tauri event listener
const mockListenCallback = vi.fn();
const mockUnlisten = vi.fn();
vi.mock("@tauri-apps/api/event", () => ({
  listen: vi.fn((event: string, cb: unknown) => {
    mockListenCallback(event, cb);
    return Promise.resolve(mockUnlisten);
  }),
}));

import { listen } from "@tauri-apps/api/event";

function setStoreForIdleModal(info: IdleInfo) {
  useSessionStore.setState({
    idleModalVisible: true,
    idleInfo: info,
    paused: true,
  });
}

const sampleIdleInfo: IdleInfo = {
  awayDurationSecs: 1800, // 30 minutes
  awaySince: 1_700_000_000,
  returnedAt: 1_700_001_800,
};

describe("IdleModal", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.setState({
      idleModalVisible: false,
      idleInfo: null,
      paused: false,
    });
  });

  it("does not render when idleModalVisible is false", () => {
    const { container } = render(<IdleModal />);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("does not render when idleInfo is null even if visible", () => {
    useSessionStore.setState({ idleModalVisible: true, idleInfo: null });
    const { container } = render(<IdleModal />);
    expect(container.querySelector("[role='dialog']")).toBeNull();
  });

  it("renders the modal with away duration when visible with idle info", () => {
    setStoreForIdleModal(sampleIdleInfo);
    render(<IdleModal />);

    expect(screen.getByText(/You were away for 30 minutes/)).toBeDefined();
    expect(screen.getByRole("dialog")).toBeDefined();
  });

  it("displays all four resolution buttons", () => {
    setStoreForIdleModal(sampleIdleInfo);
    render(<IdleModal />);

    expect(screen.getByText("Lunch break")).toBeDefined();
    expect(screen.getByText("Short break")).toBeDefined();
    expect(screen.getByText("Meeting")).toBeDefined();
    expect(screen.getByText("Discard")).toBeDefined();
  });

  it("dismisses modal and resumes timer on resolution click", async () => {
    const user = userEvent.setup();
    setStoreForIdleModal(sampleIdleInfo);
    render(<IdleModal />);

    await user.click(screen.getByText("Lunch break"));

    const state = useSessionStore.getState();
    expect(state.idleModalVisible).toBe(false);
    expect(state.idleInfo).toBeNull();
    expect(state.paused).toBe(false);
  });

  it("dismisses modal on Discard click", async () => {
    const user = userEvent.setup();
    setStoreForIdleModal(sampleIdleInfo);
    render(<IdleModal />);

    await user.click(screen.getByText("Discard"));

    const state = useSessionStore.getState();
    expect(state.idleModalVisible).toBe(false);
    expect(state.idleInfo).toBeNull();
    expect(state.paused).toBe(false);
  });

  it("registers a Tauri event listener for user_returned on mount", async () => {
    render(<IdleModal />);
    await act(async () => {});
    expect(listen).toHaveBeenCalledWith("user_returned", expect.any(Function));
  });

  it("formats hours correctly for long away durations", () => {
    setStoreForIdleModal({
      ...sampleIdleInfo,
      awayDurationSecs: 5400, // 1h 30m
    });
    render(<IdleModal />);

    expect(screen.getByText(/You were away for 1h 30m/)).toBeDefined();
  });

  it("formats singular minute correctly", () => {
    setStoreForIdleModal({
      ...sampleIdleInfo,
      awayDurationSecs: 60, // 1 minute
    });
    render(<IdleModal />);

    expect(screen.getByText(/You were away for 1 minute$/)).toBeDefined();
  });
});
