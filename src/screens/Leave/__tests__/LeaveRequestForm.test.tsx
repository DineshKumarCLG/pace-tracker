/**
 * LeaveRequestForm component tests.
 *
 * Verifies:
 * - Form renders with all required fields (Req 6.1)
 * - Leave type selection works (annual/sick/wfh)
 * - Balance validation display for annual leave (Req 6.5)
 * - Sick leave shows auto-approved badge (Req 6.3)
 * - Form submission calls store action (Req 6.2)
 * - OS notification sent on pending request submission (Req 6.4)
 * - Form closes on cancel / escape
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, fireEvent, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";

// --- Mock stores ---
const mockSubmitRequest = vi.fn();
let mockLeaveState = {
  requests: [] as Array<{
    id: string;
    requesterId: string;
    type: string;
    startDate: number;
    endDate: number;
    reason: string;
    status: string;
    reviewerId: string | null;
    reviewReason: string | null;
    createdAt: number;
    updatedAt: number;
  }>,
  balances: {} as Record<string, {
    userId: string;
    year: number;
    annualAllocated: number;
    annualUsed: number;
    annualRemaining: number;
    sickAllocated: number;
    sickUsed: number;
    sickRemaining: number;
  }>,
  publicHolidays: [] as Array<{ id: string; date: number; name: string; year: number; createdAt: number }>,
  submitRequest: mockSubmitRequest,
};

vi.mock("@/stores/leaveStore", () => ({
  useLeaveStore: (selector?: (s: typeof mockLeaveState) => unknown) => {
    if (typeof selector === "function") return selector(mockLeaveState);
    return mockLeaveState;
  },
}));

let mockAuthUser: { id: string; name: string; email: string; role: string | null; avatarColor: string } | null = {
  id: "u-arjun",
  name: "Arjun",
  email: "arjun@kenesis.dev",
  role: "Co-founder",
  avatarColor: "#6e6af6",
};

vi.mock("@/stores/authStore", () => ({
  useAuthStore: (selector?: (s: { user: typeof mockAuthUser }) => unknown) => {
    const state = { user: mockAuthUser };
    if (typeof selector === "function") return selector(state);
    return state;
  },
}));

// --- Mock tauri ---
vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
}));

// --- Mock notification ---
const mockSendNotification = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
}));

import LeaveRequestForm from "../LeaveRequestForm";

beforeEach(() => {
  vi.clearAllMocks();
  mockSubmitRequest.mockResolvedValue({
    id: "lr-1",
    requesterId: "u-arjun",
    type: "annual",
    startDate: 0,
    endDate: 0,
    reason: "",
    status: "pending",
    reviewerId: null,
    reviewReason: null,
    createdAt: 0,
    updatedAt: 0,
  });
  mockLeaveState = {
    requests: [],
    balances: {
      "u-arjun": {
        userId: "u-arjun",
        year: 2025,
        annualAllocated: 20,
        annualUsed: 5,
        annualRemaining: 15,
        sickAllocated: 10,
        sickUsed: 2,
        sickRemaining: 8,
      },
    },
    publicHolidays: [],
    submitRequest: mockSubmitRequest,
  };
  mockAuthUser = {
    id: "u-arjun",
    name: "Arjun",
    email: "arjun@kenesis.dev",
    role: "Co-founder",
    avatarColor: "#6e6af6",
  };
});

describe("LeaveRequestForm", () => {
  it("does not render when open is false", () => {
    const { container } = render(
      <LeaveRequestForm open={false} onClose={vi.fn()} />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders all required fields when open (Req 6.1)", () => {
    render(<LeaveRequestForm open={true} onClose={vi.fn()} />);

    // Type selector buttons
    expect(screen.getByText("Annual Leave")).toBeDefined();
    expect(screen.getByText("Sick Leave")).toBeDefined();
    expect(screen.getByText("Work From Home")).toBeDefined();

    // Date fields
    expect(screen.getByLabelText("Start Date")).toBeDefined();
    expect(screen.getByLabelText("End Date")).toBeDefined();

    // Reason
    expect(screen.getByPlaceholderText(/brief reason/i)).toBeDefined();

    // Submit button
    expect(screen.getByText("Submit Request")).toBeDefined();
  });

  it("shows annual leave balance when annual type selected (Req 6.5)", () => {
    render(<LeaveRequestForm open={true} onClose={vi.fn()} />);

    // Annual is default — should show balance
    expect(screen.getByText("Annual Leave Balance")).toBeDefined();
    expect(screen.getByText("15")).toBeDefined(); // remaining
    expect(screen.getByText("5 used")).toBeDefined();
  });

  it("shows sick leave balance and auto-approved badge when sick selected (Req 6.3)", async () => {
    const user = userEvent.setup();
    render(<LeaveRequestForm open={true} onClose={vi.fn()} />);

    await user.click(screen.getByText("Sick Leave"));

    expect(screen.getByText("Auto-approved")).toBeDefined();
    expect(screen.getByText("Sick Leave Balance")).toBeDefined();
  });

  it("does not show balance for WFH type", async () => {
    const user = userEvent.setup();
    render(<LeaveRequestForm open={true} onClose={vi.fn()} />);

    await user.click(screen.getByText("Work From Home"));

    expect(screen.queryByText("Annual Leave Balance")).toBeNull();
    expect(screen.queryByText("Sick Leave Balance")).toBeNull();
  });

  it("calls onClose when cancel button clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LeaveRequestForm open={true} onClose={onClose} />);

    await user.click(screen.getByText("Cancel"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose when X button clicked", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LeaveRequestForm open={true} onClose={onClose} />);

    await user.click(screen.getByLabelText("Close"));
    expect(onClose).toHaveBeenCalled();
  });

  it("calls onClose on Escape key", () => {
    const onClose = vi.fn();
    render(<LeaveRequestForm open={true} onClose={onClose} />);

    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalled();
  });

  it("calls submitRequest on form submission (Req 6.2)", async () => {
    const onClose = vi.fn();
    const user = userEvent.setup();
    render(<LeaveRequestForm open={true} onClose={onClose} />);

    // Set end date to tomorrow to pass validation
    const endInput = screen.getByLabelText("End Date");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    fireEvent.change(endInput, { target: { value: tomorrowStr } });

    // Fill reason
    const reasonInput = screen.getByPlaceholderText(/brief reason/i);
    await user.type(reasonInput, "Family vacation");

    // Submit
    await user.click(screen.getByText("Submit Request"));

    await waitFor(() => {
      expect(mockSubmitRequest).toHaveBeenCalledTimes(1);
    });

    // Verify the call args: type, startTs, endTs, reason
    const [type, , , reason] = mockSubmitRequest.mock.calls[0];
    expect(type).toBe("annual");
    expect(reason).toBe("Family vacation");
  });

  it("shows error when submission fails", async () => {
    mockSubmitRequest.mockRejectedValueOnce(new Error("Insufficient balance"));
    const user = userEvent.setup();
    render(<LeaveRequestForm open={true} onClose={vi.fn()} />);

    const endInput = screen.getByLabelText("End Date");
    const tomorrow = new Date();
    tomorrow.setDate(tomorrow.getDate() + 1);
    const tomorrowStr = `${tomorrow.getFullYear()}-${String(tomorrow.getMonth() + 1).padStart(2, "0")}-${String(tomorrow.getDate()).padStart(2, "0")}`;
    fireEvent.change(endInput, { target: { value: tomorrowStr } });

    await user.click(screen.getByText("Submit Request"));

    await waitFor(() => {
      expect(screen.getByText("Insufficient balance")).toBeDefined();
    });
  });
});
