import { describe, it, expect, beforeEach, vi } from "vitest";
import { useLeaveStore } from "./leaveStore";
import { useAuthStore } from "./authStore";
import type { LeaveRequest, PublicHoliday } from "@/types";

// Mock PocketBase (needed by authStore and leave functions)
vi.mock("@/lib/pocketbase", () => ({
  pb: {
    authStore: { isValid: false, record: null, token: "", clear: vi.fn(), save: vi.fn() },
    collection: vi.fn(() => ({
      create: vi.fn(async () => ({ id: "req-new" })),
      update: vi.fn(async () => ({})),
      getFullList: vi.fn(async () => []),
    })),
  },
}));

// Mock leave functions
vi.mock("@/lib/leave", () => ({
  createLeaveRequest: vi.fn(),
  approveLeaveRequest: vi.fn(),
  declineLeaveRequest: vi.fn(),
  computeLeaveBalance: vi.fn(),
  getPublicHolidays: vi.fn(),
}));

import {
  createLeaveRequest,
  approveLeaveRequest,
  declineLeaveRequest,
  computeLeaveBalance,
  getPublicHolidays,
} from "@/lib/leave";

const mockCreate = vi.mocked(createLeaveRequest);
const mockApprove = vi.mocked(approveLeaveRequest);
const mockDecline = vi.mocked(declineLeaveRequest);
const mockComputeBalance = vi.mocked(computeLeaveBalance);
const mockGetHolidays = vi.mocked(getPublicHolidays);

const now = Math.floor(Date.now() / 1000);

const sampleRequest: LeaveRequest = {
  id: "req-1",
  requesterId: "user-a",
  type: "annual",
  startDate: now + 86400,
  endDate: now + 86400 * 3,
  reason: "Vacation",
  status: "pending",
  reviewerId: null,
  reviewReason: null,
  createdAt: now,
  updatedAt: now,
};

describe("leaveStore", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    useLeaveStore.setState({
      requests: [],
      balances: {},
      publicHolidays: [],
      loading: false,
    });
    // Set up authenticated user
    useAuthStore.setState({
      user: { id: "user-b", name: "Bob", email: "bob@test.com", role: null, avatarColor: "#000" },
      isAuthenticated: true,
      isLoading: false,
    });
  });

  it("starts with empty state", () => {
    const state = useLeaveStore.getState();
    expect(state.requests).toEqual([]);
    expect(state.balances).toEqual({});
    expect(state.publicHolidays).toEqual([]);
    expect(state.loading).toBe(false);
  });

  it("submitRequest creates request and adds to state", async () => {
    const newReq: LeaveRequest = { ...sampleRequest, id: "req-new", requesterId: "user-b" };
    mockCreate.mockResolvedValueOnce(newReq);
    mockComputeBalance.mockReturnValue({
      userId: "user-b",
      year: new Date().getUTCFullYear(),
      annualAllocated: 20,
      annualUsed: 2,
      annualRemaining: 18,
      sickAllocated: 10,
      sickUsed: 0,
      sickRemaining: 10,
    });

    const result = await useLeaveStore.getState().submitRequest(
      "annual",
      now + 86400,
      now + 86400 * 3,
      "Vacation",
    );

    expect(result.id).toBe("req-new");
    expect(useLeaveStore.getState().requests).toHaveLength(1);
    expect(useLeaveStore.getState().loading).toBe(false);
    expect(mockCreate).toHaveBeenCalledWith(
      "user-b",
      "annual",
      now + 86400,
      now + 86400 * 3,
      "Vacation",
      [],
      [],
    );
  });

  it("submitRequest throws when not authenticated", async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
    await expect(
      useLeaveStore.getState().submitRequest("annual", now, now + 86400, "test"),
    ).rejects.toThrow("Not authenticated");
  });

  it("submitRequest sets loading false on error", async () => {
    mockCreate.mockRejectedValueOnce(new Error("Balance exceeded"));
    await expect(
      useLeaveStore.getState().submitRequest("annual", now, now + 86400, "test"),
    ).rejects.toThrow("Balance exceeded");
    expect(useLeaveStore.getState().loading).toBe(false);
  });

  it("approveRequest updates request status in state", async () => {
    useLeaveStore.setState({ requests: [sampleRequest] });
    const approved = { ...sampleRequest, status: "approved" as const, reviewerId: "user-b" };
    mockApprove.mockResolvedValueOnce(approved);
    mockComputeBalance.mockReturnValue({
      userId: "user-a",
      year: new Date().getUTCFullYear(),
      annualAllocated: 20,
      annualUsed: 2,
      annualRemaining: 18,
      sickAllocated: 10,
      sickUsed: 0,
      sickRemaining: 10,
    });

    await useLeaveStore.getState().approveRequest("req-1");

    const updated = useLeaveStore.getState().requests.find((r) => r.id === "req-1");
    expect(updated?.status).toBe("approved");
    expect(updated?.reviewerId).toBe("user-b");
    expect(useLeaveStore.getState().loading).toBe(false);
  });

  it("approveRequest throws when request not found", async () => {
    await expect(
      useLeaveStore.getState().approveRequest("nonexistent"),
    ).rejects.toThrow("Leave request not found");
  });

  it("declineRequest updates request status and reason", async () => {
    useLeaveStore.setState({ requests: [sampleRequest] });
    const declined = {
      ...sampleRequest,
      status: "declined" as const,
      reviewerId: "user-b",
      reviewReason: "Conflict",
    };
    mockDecline.mockResolvedValueOnce(declined);

    await useLeaveStore.getState().declineRequest("req-1", "Conflict");

    const updated = useLeaveStore.getState().requests.find((r) => r.id === "req-1");
    expect(updated?.status).toBe("declined");
    expect(updated?.reviewReason).toBe("Conflict");
    expect(useLeaveStore.getState().loading).toBe(false);
  });

  it("declineRequest throws when not authenticated", async () => {
    useAuthStore.setState({ user: null, isAuthenticated: false });
    useLeaveStore.setState({ requests: [sampleRequest] });
    await expect(
      useLeaveStore.getState().declineRequest("req-1", "reason"),
    ).rejects.toThrow("Not authenticated");
  });

  it("loadBalances computes balances for all known users", () => {
    useLeaveStore.setState({ requests: [sampleRequest] });
    mockComputeBalance.mockImplementation((userId) => ({
      userId,
      year: new Date().getUTCFullYear(),
      annualAllocated: 20,
      annualUsed: 0,
      annualRemaining: 20,
      sickAllocated: 10,
      sickUsed: 0,
      sickRemaining: 10,
    }));

    useLeaveStore.getState().loadBalances();

    const balances = useLeaveStore.getState().balances;
    // Should include both the requester from requests and the current user
    expect(balances["user-a"]).toBeDefined();
    expect(balances["user-b"]).toBeDefined();
    expect(balances["user-a"].annualRemaining).toBe(20);
  });

  it("loadHolidays fetches and stores holidays", async () => {
    const holidays: PublicHoliday[] = [
      { id: "h-1", date: now, name: "New Year", year: 2025, createdAt: now },
    ];
    mockGetHolidays.mockResolvedValueOnce(holidays);

    await useLeaveStore.getState().loadHolidays(2025);

    expect(useLeaveStore.getState().publicHolidays).toEqual(holidays);
    expect(useLeaveStore.getState().loading).toBe(false);
    expect(mockGetHolidays).toHaveBeenCalledWith(2025);
  });

  it("loadHolidays sets loading false on error", async () => {
    mockGetHolidays.mockRejectedValueOnce(new Error("Network error"));
    await expect(
      useLeaveStore.getState().loadHolidays(2025),
    ).rejects.toThrow("Network error");
    expect(useLeaveStore.getState().loading).toBe(false);
  });

  it("setRequests replaces the requests array", () => {
    useLeaveStore.getState().setRequests([sampleRequest]);
    expect(useLeaveStore.getState().requests).toEqual([sampleRequest]);
  });
});
