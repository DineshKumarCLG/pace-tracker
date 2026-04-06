/**
 * Leave management Zustand store for PACE v2 Team Ops.
 *
 * Holds leave requests, balances, and public holidays.
 * Actions wire to leave functions from src/lib/leave.ts.
 *
 * Requirements: 6.1, 6.2, 7.1
 */

import { create } from "zustand";
import type { LeaveRequest, LeaveBalance, PublicHoliday } from "@/types";
import {
  createLeaveRequest,
  approveLeaveRequest,
  declineLeaveRequest,
  computeLeaveBalance,
  getPublicHolidays,
} from "@/lib/leave";
import { useAuthStore } from "@/stores/authStore";

interface LeaveState {
  requests: LeaveRequest[];
  balances: Record<string, LeaveBalance>;
  publicHolidays: PublicHoliday[];
  loading: boolean;
}

interface LeaveActions {
  submitRequest: (
    type: "annual" | "sick" | "wfh",
    startDate: number,
    endDate: number,
    reason: string,
  ) => Promise<LeaveRequest>;
  approveRequest: (requestId: string) => Promise<void>;
  declineRequest: (requestId: string, reason: string) => Promise<void>;
  loadBalances: () => void;
  loadHolidays: (year: number) => Promise<void>;
  setRequests: (requests: LeaveRequest[]) => void;
}

export const useLeaveStore = create<LeaveState & LeaveActions>((set, get) => ({
  requests: [],
  balances: {},
  publicHolidays: [],
  loading: false,

  submitRequest: async (type, startDate, endDate, reason) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error("Not authenticated");

    set({ loading: true });
    try {
      const { requests, publicHolidays } = get();
      const newRequest = await createLeaveRequest(
        user.id,
        type,
        startDate,
        endDate,
        reason,
        requests,
        publicHolidays,
      );

      set((state) => ({
        requests: [...state.requests, newRequest],
        loading: false,
      }));

      // Recompute balance for the requester
      get().loadBalances();

      return newRequest;
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  approveRequest: async (requestId) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error("Not authenticated");

    const request = get().requests.find((r) => r.id === requestId);
    if (!request) throw new Error("Leave request not found");

    set({ loading: true });
    try {
      const updated = await approveLeaveRequest(requestId, user.id, request);

      set((state) => ({
        requests: state.requests.map((r) =>
          r.id === requestId ? updated : r,
        ),
        loading: false,
      }));

      // Recompute balance for the requester
      get().loadBalances();
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  declineRequest: async (requestId, reason) => {
    const user = useAuthStore.getState().user;
    if (!user) throw new Error("Not authenticated");

    const request = get().requests.find((r) => r.id === requestId);
    if (!request) throw new Error("Leave request not found");

    set({ loading: true });
    try {
      const updated = await declineLeaveRequest(
        requestId,
        user.id,
        reason,
        request,
      );

      set((state) => ({
        requests: state.requests.map((r) =>
          r.id === requestId ? updated : r,
        ),
        loading: false,
      }));
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  loadBalances: () => {
    const { requests, publicHolidays } = get();
    const year = new Date().getUTCFullYear();

    // Collect unique user IDs from requests
    const userIds = new Set<string>();
    for (const r of requests) {
      userIds.add(r.requesterId);
    }

    // Also include the current user
    const user = useAuthStore.getState().user;
    if (user) userIds.add(user.id);

    const balances: Record<string, LeaveBalance> = {};
    for (const userId of userIds) {
      balances[userId] = computeLeaveBalance(
        userId,
        year,
        requests,
        publicHolidays,
      );
    }

    set({ balances });
  },

  loadHolidays: async (year) => {
    set({ loading: true });
    try {
      const holidays = await getPublicHolidays(year);
      set({ publicHolidays: holidays, loading: false });
    } catch (error) {
      set({ loading: false });
      throw error;
    }
  },

  setRequests: (requests) => set({ requests }),
}));
