/**
 * Analytics Zustand store for PACE v2 Team Ops.
 *
 * Holds individual analytics, team analytics, and focus score data.
 * Focus score is private — only shown to the current user (Req 16.2, 25.1).
 * No comparative rankings between members (Req 10.6).
 *
 * Requirements: 9.6, 10.1, 10.2, 10.3, 10.4, 10.5, 10.6, 16.2, 25.1, 25.2
 */

import { create } from "zustand";
import type {
  IndividualAnalytics,
  TeamAnalytics,
  FocusScore,
  AttendanceRecord,
  Session,
  Task,
  SessionTask,
  Project,
  LeaveRequest,
  Break,
  IdleEvent,
  OverworkSignal,
} from "@/types";
import {
  getIndividualAnalytics,
  getTeamAnalytics,
  computeFocusScore,
} from "@/lib/analytics";
import { detectOverwork } from "@/lib/dashboard";

interface AnalyticsState {
  individual: IndividualAnalytics | null;
  team: TeamAnalytics | null;
  focusScore: FocusScore | null;
  overworkSignals: OverworkSignal[];
  loading: boolean;
}

interface AnalyticsActions {
  refreshIndividual: (
    userId: string,
    attendanceRecords: AttendanceRecord[],
    sessions: Session[],
    tasks: Task[],
  ) => void;
  refreshTeam: (
    sessionTasks: SessionTask[],
    tasks: Task[],
    projects: Project[],
    attendanceRecords: AttendanceRecord[],
    teamMembers: Array<{ userId: string; name: string }>,
    leaveRequests: LeaveRequest[],
    referenceDate: number,
  ) => void;
  refreshFocusScore: (
    sessions: Session[],
    sessionBreaks: Map<string, Break[]>,
    sessionIdleEvents: Map<string, IdleEvent[]>,
    tasks: Task[],
  ) => void;
  refreshOverwork: (
    teamMembers: Array<{ userId: string; name: string; status: string }>,
    attendanceRecords: AttendanceRecord[],
  ) => void;
  clearFocusScore: () => void;
}

export const useAnalyticsStore = create<AnalyticsState & AnalyticsActions>(
  (set) => ({
    individual: null,
    team: null,
    focusScore: null,
    overworkSignals: [],
    loading: false,

    refreshIndividual: (userId, attendanceRecords, sessions, tasks) => {
      set({ loading: true });
      try {
        const individual = getIndividualAnalytics(
          userId,
          attendanceRecords,
          sessions,
          tasks,
        );
        set({ individual, loading: false });
      } catch {
        set({ loading: false });
      }
    },

    refreshTeam: (
      sessionTasks,
      tasks,
      projects,
      attendanceRecords,
      teamMembers,
      leaveRequests,
      referenceDate,
    ) => {
      set({ loading: true });
      try {
        const team = getTeamAnalytics(
          sessionTasks,
          tasks,
          projects,
          attendanceRecords,
          teamMembers,
          leaveRequests,
          referenceDate,
        );
        set({ team, loading: false });
      } catch {
        set({ loading: false });
      }
    },

    refreshFocusScore: (sessions, sessionBreaks, sessionIdleEvents, tasks) => {
      try {
        const focusScore = computeFocusScore(
          sessions,
          sessionBreaks,
          sessionIdleEvents,
          tasks,
        );
        set({ focusScore });
      } catch {
        // Focus score is best-effort — don't break the UI
      }
    },

    refreshOverwork: (teamMembers, attendanceRecords) => {
      try {
        const overworkSignals = detectOverwork(
          teamMembers as Parameters<typeof detectOverwork>[0],
          attendanceRecords,
        );
        set({ overworkSignals });
      } catch {
        set({ overworkSignals: [] });
      }
    },

    clearFocusScore: () => set({ focusScore: null }),
  }),
);
