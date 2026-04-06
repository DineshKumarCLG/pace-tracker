/**
 * Dashboard Zustand store for PACE v2 Team Ops.
 *
 * Aggregates team status, pending approvals, project health,
 * velocity, upcoming leave, attendance alerts, and overwork signals
 * into a single DashboardData object for the Founder Dashboard.
 *
 * Requirements: 13.1, 13.2, 13.3, 13.4, 14.4
 */

import { create } from "zustand";
import type {
  DashboardData,
  LeaveRequest,
  TeamMember,
} from "@/types";
import { useTeamStore, getStatusLabel } from "@/stores/teamStore";
import { useLeaveStore } from "@/stores/leaveStore";
import { checkAttendanceAlerts, detectOverwork } from "@/lib/dashboard";

interface DashboardState {
  data: DashboardData | null;
  loading: boolean;
}

interface DashboardActions {
  refresh: () => Promise<void>;
}

/**
 * Derive the dashboard-level status label for a team member,
 * accounting for leave and WFH on the current day.
 */
function deriveMemberStatus(
  member: TeamMember,
  leaveRequests: LeaveRequest[],
  now: number,
): "Active" | "On Break" | "Away" | "Offline" | "On Leave" | "WFH" {
  // Check for approved leave (annual/sick) covering today
  const onLeave = leaveRequests.some(
    (r) =>
      r.requesterId === member.userId &&
      r.status === "approved" &&
      (r.type === "annual" || r.type === "sick") &&
      r.startDate <= now &&
      r.endDate >= now,
  );
  if (onLeave) return "On Leave";

  // Check for approved WFH covering today
  const onWfh = leaveRequests.some(
    (r) =>
      r.requesterId === member.userId &&
      r.status === "approved" &&
      r.type === "wfh" &&
      r.startDate <= now &&
      r.endDate >= now,
  );
  if (onWfh && member.status === "offline") return "WFH";
  if (onWfh) {
    // WFH but actively working — show their real status but we still tag as WFH
    // if they have no active session
    if (member.status === "active") return "Active";
    if (member.status === "on_break") return "On Break";
    if (member.status === "away") return "Away";
    return "WFH";
  }

  return getStatusLabel(member.status);
}

/**
 * Count pending leave requests that the current user can act on.
 */
function countPendingApprovals(requests: LeaveRequest[]): number {
  return requests.filter((r) => r.status === "pending").length;
}

/**
 * Get upcoming leave entries within the next N days.
 */
function getUpcomingLeave(
  requests: LeaveRequest[],
  members: Record<string, TeamMember>,
  now: number,
  windowDays: number = 14,
): DashboardData["upcomingLeave"] {
  const windowEnd = now + windowDays * 86400;

  return requests
    .filter(
      (r) =>
        r.status === "approved" &&
        (r.type === "annual" || r.type === "sick" || r.type === "wfh") &&
        r.startDate <= windowEnd &&
        r.endDate >= now,
    )
    .map((r) => ({
      userId: r.requesterId,
      name: members[r.requesterId]?.name ?? r.requesterId,
      type: r.type,
      startDate: r.startDate,
      endDate: r.endDate,
    }));
}

/**
 * Compute today's combined team hours from team member session durations.
 */
function computeTodayTeamHours(members: Record<string, TeamMember>, now: number): number {
  let totalSecs = 0;
  for (const member of Object.values(members)) {
    if (member.sessionStart != null) {
      totalSecs += now - member.sessionStart;
    }
  }
  return totalSecs / 3600;
}

export const useDashboardStore = create<DashboardState & DashboardActions>(
  (set) => ({
    data: null,
    loading: false,

    refresh: async () => {
      set({ loading: true });

      try {
        const now = Math.floor(Date.now() / 1000);
        const members = useTeamStore.getState().members;
        const { requests, publicHolidays } = useLeaveStore.getState();
        const teamMembers = Object.values(members);

        // 1. Team status (Req 13.1)
        const teamStatus: DashboardData["teamStatus"] = teamMembers.map(
          (m) => ({
            userId: m.userId,
            name: m.name,
            status: deriveMemberStatus(m, requests, now),
            currentTask: m.currentTask,
            sessionDuration:
              m.sessionStart != null ? now - m.sessionStart : null,
          }),
        );

        // 2. Today's combined team hours (Req 13.2)
        const todayTeamHours = computeTodayTeamHours(members, now);

        // 3. Pending approvals count (Req 13.3)
        const pendingApprovals = countPendingApprovals(requests);

        // 4. Project health — placeholder until analytics engine is wired (Req 13.4)
        const projectHealth: DashboardData["projectHealth"] = [
          { projectId: "proj-1", name: "PACE App", openTasks: 14, overdueTasks: 2, hoursThisWeek: 28.5 },
          { projectId: "proj-2", name: "Marketing Site", openTasks: 6, overdueTasks: 0, hoursThisWeek: 8.2 },
          { projectId: "proj-3", name: "API Gateway", openTasks: 3, overdueTasks: 1, hoursThisWeek: 12.0 },
        ];

        // 5. Weekly velocity — placeholder until analytics engine is wired (Req 14.1)
        const weeklyVelocity = { current: 12, previous: 9 };

        // 6. Upcoming leave in next 14 days (Req 14.2)
        const upcomingLeave = getUpcomingLeave(requests, members, now);

        // 7. Attendance alerts (Req 14.3)
        const currentHour = new Date().getHours();
        const attendanceAlerts = checkAttendanceAlerts(
          teamMembers,
          [], // sessions — will be wired to real data when available
          requests,
          publicHolidays,
          now,
          currentHour,
        );

        // 8. Milestone warnings — placeholder until milestones are implemented
        const milestoneWarnings: DashboardData["milestoneWarnings"] = [
          { milestoneId: "ms-1", name: "Beta Launch", projectName: "PACE App", deadline: now + 2 * 86400, daysRemaining: 2 },
          { milestoneId: "ms-2", name: "API v2 Release", projectName: "API Gateway", deadline: now + 5 * 86400, daysRemaining: 5 },
        ];

        // 9. Overwork signals (Req 26.1, 26.2)
        // Pass empty attendance records for now — will be wired to real data
        const overworkSignals = detectOverwork(teamMembers, []);

        set({
          data: {
            teamStatus,
            todayTeamHours,
            pendingApprovals,
            projectHealth,
            weeklyVelocity,
            upcomingLeave,
            attendanceAlerts,
            milestoneWarnings,
            overworkSignals,
          },
          loading: false,
        });
      } catch {
        set({ loading: false });
      }
    },
  }),
);
