import { create } from "zustand";
import type { TeamMember, TeamMemberStatus } from "@/types";

interface TeamState {
  members: Record<string, TeamMember>;
}

interface TeamActions {
  updateMember: (userId: string, data: Partial<TeamMember>) => void;
  removeMember: (userId: string) => void;
  clearMembers: () => void;
  loadMockMembers: () => void;
}

/** Map internal status to the user-facing label. Never returns "Idle". */
export function getStatusLabel(status: TeamMemberStatus): "Active" | "On Break" | "Away" | "Offline" {
  switch (status) {
    case "active": return "Active";
    case "on_break": return "On Break";
    case "away": return "Away";
    case "offline": return "Offline";
  }
}

const now = Math.floor(Date.now() / 1000);
const todayStart = now - (now % 86400); // midnight UTC today

const MOCK_MEMBERS: TeamMember[] = [
  {
    userId: "u-arjun",
    name: "Arjun",
    status: "active",
    currentTask: "Build Team View",
    sessionStart: todayStart + 9 * 3600 + 1020, // ~9:17 AM
    breakStart: null,
    outputNote: "Wiring up WeekGrid with real session data",
    avatarColor: "#6e6af6",
  },
  {
    userId: "u-priya",
    name: "Priya",
    status: "on_break",
    currentTask: "API integration",
    sessionStart: todayStart + 8 * 3600 + 3300, // ~8:55 AM
    breakStart: now - 420, // 7 min ago
    outputNote: "PocketBase sync service refactor",
    avatarColor: "#e6a030",
  },
  {
    userId: "u-sam",
    name: "Sam",
    status: "away",
    currentTask: "Design review",
    sessionStart: todayStart + 10 * 3600 + 1800, // ~10:30 AM
    breakStart: null,
    outputNote: "Reviewing leave calendar mockups",
    avatarColor: "#3b9e6f",
  },
  {
    userId: "u-mika",
    name: "Mika",
    status: "offline",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#c45e8a",
  },
];

export const useTeamStore = create<TeamState & TeamActions>((set) => ({
  members: {},

  updateMember: (userId, data) =>
    set((state) => ({
      members: {
        ...state.members,
        [userId]: { ...state.members[userId], ...data, userId },
      },
    })),
  removeMember: (userId) =>
    set((state) => {
      const { [userId]: _, ...rest } = state.members;
      return { members: rest };
    }),
  clearMembers: () => set({ members: {} }),
  loadMockMembers: () =>
    set({
      members: Object.fromEntries(MOCK_MEMBERS.map((m) => [m.userId, m])),
    }),
}));
