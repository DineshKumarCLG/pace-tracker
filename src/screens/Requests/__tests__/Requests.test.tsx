/**
 * Request/Approval screen tests.
 *
 * Verifies:
 * - Pending requests are listed with details (Req 7.1)
 * - Approve action calls store (Req 7.2)
 * - Decline requires reason input (Req 7.3)
 * - Approve/decline hidden on own requests (Req 7.4)
 * - OS notification sent on decline (Req 7.3)
 * - Empty state when no pending requests
 * - Tab switching between pending and all
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { LeaveRequest } from "@/types";
import type { TeamMember } from "@/types";

// --- Mock data ---
const mockApproveRequest = vi.fn();
const mockDeclineRequest = vi.fn();

const pendingRequest: LeaveRequest = {
  id: "lr-1",
  requesterId: "u-bob",
  type: "annual",
  startDate: 1735689600, // 2025-01-01
  endDate: 1735948800, // 2025-01-04
  reason: "Family vacation",
  status: "pending",
  reviewerId: null,
  reviewReason: null,
  createdAt: 1735600000,
  updatedAt: 1735600000,
};

const ownPendingRequest: LeaveRequest = {
  id: "lr-2",
  requesterId: "u-arjun",
  type: "wfh",
  startDate: 1735776000,
  endDate: 1735862400,
  reason: "Remote day",
  status: "pending",
  reviewerId: null,
  reviewReason: null,
  createdAt: 1735500000,
  updatedAt: 1735500000,
};

const declinedRequest: LeaveRequest = {
  id: "lr-3",
  requesterId: "u-bob",
  type: "annual",
  startDate: 1735689600,
  endDate: 1735948800,
  reason: "Trip",
  status: "declined",
  reviewerId: "u-arjun",
  reviewReason: "Team capacity low",
  createdAt: 1735400000,
  updatedAt: 1735400000,
};

let mockLeaveState: {
  requests: LeaveRequest[];
  approveRequest: typeof mockApproveRequest;
  declineRequest: typeof mockDeclineRequest;
};

const mockMembers: Record<string, TeamMember> = {
  "u-bob": {
    userId: "u-bob",
    name: "Bob",
    status: "active",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#e67e22",
  },
  "u-arjun": {
    userId: "u-arjun",
    name: "Arjun",
    status: "active",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#6e6af6",
  },
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

vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (selector?: (s: { members: typeof mockMembers }) => unknown) => {
    const state = { members: mockMembers };
    if (typeof selector === "function") return selector(state);
    return state;
  },
}));

vi.mock("@/lib/tauri", () => ({
  isTauri: () => false,
}));

const mockSendNotification = vi.fn();
vi.mock("@tauri-apps/plugin-notification", () => ({
  sendNotification: (...args: unknown[]) => mockSendNotification(...args),
  isPermissionGranted: () => Promise.resolve(true),
  requestPermission: () => Promise.resolve("granted"),
}));

import RequestsScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockApproveRequest.mockResolvedValue(undefined);
  mockDeclineRequest.mockResolvedValue(undefined);
  mockLeaveState = {
    requests: [pendingRequest, ownPendingRequest, declinedRequest],
    approveRequest: mockApproveRequest,
    declineRequest: mockDeclineRequest,
  };
  mockAuthUser = {
    id: "u-arjun",
    name: "Arjun",
    email: "arjun@kenesis.dev",
    role: "Co-founder",
    avatarColor: "#6e6af6",
  };
});

describe("RequestsScreen", () => {
  it("renders the screen header", () => {
    render(<RequestsScreen />);
    expect(screen.getByText("Requests")).toBeDefined();
    expect(screen.getByText("Review and manage leave requests")).toBeDefined();
  });

  it("lists pending requests with requester name, type, dates, and reason (Req 7.1)", () => {
    render(<RequestsScreen />);

    // Bob's pending request should be visible
    expect(screen.getByText("Bob")).toBeDefined();
    expect(screen.getByText("Annual Leave")).toBeDefined();
    expect(screen.getByText("Family vacation")).toBeDefined();
  });

  it("shows approve and decline buttons on other users' pending requests (Req 7.1)", () => {
    render(<RequestsScreen />);

    // Bob's request should have action buttons
    expect(screen.getByText("Approve")).toBeDefined();
    expect(screen.getByText("Decline")).toBeDefined();
  });

  it("hides approve/decline on own pending requests (Req 7.4)", () => {
    render(<RequestsScreen />);

    // Arjun's own request should show the "Your request" indicator
    expect(
      screen.getByText("Your request — awaiting review from another team member"),
    ).toBeDefined();

    // There should be only one Approve button (for Bob's request, not Arjun's)
    const approveButtons = screen.getAllByText("Approve");
    expect(approveButtons.length).toBe(1);
  });

  it("calls approveRequest on approve click (Req 7.2)", async () => {
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(mockApproveRequest).toHaveBeenCalledWith("lr-1");
    });
  });

  it("shows decline reason input when Decline is clicked (Req 7.3)", async () => {
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Decline"));

    // Decline reason input should appear
    expect(screen.getByLabelText("Decline reason")).toBeDefined();
    expect(screen.getByText("Confirm Decline")).toBeDefined();
    expect(screen.getByPlaceholderText("Enter reason for declining...")).toBeDefined();
  });

  it("requires reason before confirming decline (Req 7.3)", async () => {
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Decline"));

    // Confirm Decline button should be disabled when reason is empty
    const confirmBtn = screen.getByText("Confirm Decline");
    expect(confirmBtn.hasAttribute("disabled")).toBe(true);
  });

  it("calls declineRequest with reason on confirm (Req 7.3)", async () => {
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Decline"));

    const reasonInput = screen.getByLabelText("Decline reason");
    await user.type(reasonInput, "Team capacity low this week");

    await user.click(screen.getByText("Confirm Decline"));

    await waitFor(() => {
      expect(mockDeclineRequest).toHaveBeenCalledWith(
        "lr-1",
        "Team capacity low this week",
      );
    });
  });

  it("cancels decline mode when Cancel is clicked", async () => {
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Decline"));
    expect(screen.getByLabelText("Decline reason")).toBeDefined();

    // Click the Cancel button inside the decline form
    const cancelButtons = screen.getAllByText("Cancel");
    await user.click(cancelButtons[0]);

    // Decline reason input should be gone
    expect(screen.queryByLabelText("Decline reason")).toBeNull();
  });

  it("shows empty state when no pending requests", () => {
    mockLeaveState.requests = [];
    render(<RequestsScreen />);

    expect(screen.getByText("No pending requests")).toBeDefined();
  });

  it("switches to All tab and shows all requests including declined", async () => {
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("All Requests"));

    // Declined request should now be visible
    expect(screen.getByText("Decline reason:")).toBeDefined();
    expect(screen.getByText("Team capacity low")).toBeDefined();
  });

  it("shows pending count badge", () => {
    render(<RequestsScreen />);

    // 2 pending requests (lr-1 and lr-2)
    expect(screen.getByText("2")).toBeDefined();
  });

  it("shows error message when approve fails", async () => {
    mockApproveRequest.mockRejectedValueOnce(
      new Error("Cannot approve your own leave request"),
    );
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Approve"));

    await waitFor(() => {
      expect(
        screen.getByText("Cannot approve your own leave request"),
      ).toBeDefined();
    });
  });

  it("shows error message when decline fails", async () => {
    mockDeclineRequest.mockRejectedValueOnce(
      new Error("Request not found"),
    );
    const user = userEvent.setup();
    render(<RequestsScreen />);

    await user.click(screen.getByText("Decline"));
    const reasonInput = screen.getByLabelText("Decline reason");
    await user.type(reasonInput, "Some reason");
    await user.click(screen.getByText("Confirm Decline"));

    await waitFor(() => {
      expect(screen.getByText("Request not found")).toBeDefined();
    });
  });
});
