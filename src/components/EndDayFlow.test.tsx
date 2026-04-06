import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import EndDayFlow from "./EndDayFlow";
import { useSessionStore } from "@/stores/sessionStore";
import { useTaskStore } from "@/stores/taskStore";
import type { Session, Task } from "@/types";

// Mock db module
vi.mock("@/lib/db", () => ({
  endSession: vi.fn(),
}));

import { endSession } from "@/lib/db";

const mockSession: Session = {
  id: "sess-1",
  userId: "user-1",
  startTime: Math.floor(Date.now() / 1000) - 3600, // 1 hour ago
  endTime: null,
  startType: "manual",
  startVerified: true,
  outputNote: "Built the login page",
  lastHeartbeat: Math.floor(Date.now() / 1000),
  syncedAt: null,
  createdAt: Math.floor(Date.now() / 1000) - 3600,
};

const mockTasks: Task[] = [
  {
    id: "t-1",
    projectId: "p-1",
    title: "Login page",
    status: "done",
    assigneeId: "user-1",
    priority: "high",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: 0,
    closedAt: Math.floor(Date.now() / 1000),
  },
  {
    id: "t-2",
    projectId: "p-1",
    title: "Dashboard",
    status: "inprogress",
    assigneeId: "user-1",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: null,
    notes: null,
    createdBy: "user-1",
    createdAt: 0,
    closedAt: null,
  },
];

describe("EndDayFlow", () => {
  const onCancel = vi.fn();

  beforeEach(() => {
    vi.clearAllMocks();
    useSessionStore.getState().setSession(mockSession);
    useTaskStore.getState().updateTaskList(mockTasks);
  });

  it("renders nothing when no session is active", () => {
    useSessionStore.getState().clearSession();
    const { container } = render(<EndDayFlow onCancel={onCancel} />);
    expect(container.innerHTML).toBe("");
  });

  it("shows day summary on step 1 with total time, tasks closed, and breaks", () => {
    render(<EndDayFlow onCancel={onCancel} />);
    expect(screen.getByText("Day Summary")).toBeTruthy();
    expect(screen.getByText("Total time")).toBeTruthy();
    expect(screen.getByText("Tasks closed")).toBeTruthy();
    expect(screen.getByText("Breaks")).toBeTruthy();
    // 1 task is done
    expect(screen.getByText("1")).toBeTruthy();
    expect(screen.getByText("Continue")).toBeTruthy();
  });

  it("navigates to output note step when Continue is clicked", () => {
    render(<EndDayFlow onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("Output Note")).toBeTruthy();
    expect(screen.getByText("End my day")).toBeTruthy();
  });

  it("pre-fills output note from session store (Req 12.2)", () => {
    render(<EndDayFlow onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Continue"));
    const textarea = screen.getByLabelText("Output note") as HTMLTextAreaElement;
    expect(textarea.value).toBe("Built the login page");
  });

  it("calls endSession and shows goodbye screen on confirm", async () => {
    (endSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<EndDayFlow onCancel={onCancel} />);

    // Step 1 → Step 2
    fireEvent.click(screen.getByText("Continue"));
    // Confirm
    fireEvent.click(screen.getByText("End my day"));

    await waitFor(() => {
      expect(endSession).toHaveBeenCalledWith(
        "sess-1",
        expect.any(Number),
        "Built the login page",
      );
    });

    // Goodbye screen
    await waitFor(() => {
      expect(screen.getByText("Great work today.")).toBeTruthy();
      expect(screen.getByText("See you tomorrow.")).toBeTruthy();
    });
  });

  it("clears session store after ending", async () => {
    (endSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<EndDayFlow onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("End my day"));

    await waitFor(() => {
      expect(useSessionStore.getState().session).toBeNull();
    });
  });

  it("shows error when endSession fails", async () => {
    (endSession as ReturnType<typeof vi.fn>).mockRejectedValue(
      new Error("DB write failed"),
    );
    render(<EndDayFlow onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("End my day"));

    await waitFor(() => {
      expect(screen.getByRole("alert")).toBeTruthy();
    });
  });

  it("calls onCancel when cancel button is clicked", () => {
    render(<EndDayFlow onCancel={onCancel} />);
    fireEvent.click(screen.getByLabelText("Cancel"));
    expect(onCancel).toHaveBeenCalled();
  });

  it("can navigate back from output step to summary", () => {
    render(<EndDayFlow onCancel={onCancel} />);
    fireEvent.click(screen.getByText("Continue"));
    expect(screen.getByText("Output Note")).toBeTruthy();
    fireEvent.click(screen.getByText("Back"));
    expect(screen.getByText("Day Summary")).toBeTruthy();
  });

  it("goodbye screen shows facts without scores or ratings (Req 3.1, 12.3)", async () => {
    (endSession as ReturnType<typeof vi.fn>).mockResolvedValue(undefined);
    render(<EndDayFlow onCancel={onCancel} />);

    fireEvent.click(screen.getByText("Continue"));
    fireEvent.click(screen.getByText("End my day"));

    await waitFor(() => {
      expect(screen.getByText("Hours")).toBeTruthy();
      expect(screen.getByText("Tasks done")).toBeTruthy();
      expect(screen.getByText("Breaks")).toBeTruthy();
      // No scores or ratings
      expect(screen.queryByText(/score/i)).toBeNull();
      expect(screen.queryByText(/rating/i)).toBeNull();
      expect(screen.queryByText(/rank/i)).toBeNull();
    });
  });
});
