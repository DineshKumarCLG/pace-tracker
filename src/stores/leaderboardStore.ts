/**
 * Leaderboard Zustand store for PACE v3 Founder Governance.
 *
 * State: scores, currentWeek, loading
 * Actions: refresh()
 * Wired to leaderboard computation functions.
 *
 * Requirements: 4.1, 5.1, 5.2
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";
import {
  computeFounderScores,
  type FounderScore,
} from "@/lib/leaderboard";
import { pb } from "@/lib/pocketbase";

interface LeaderboardState {
  scores: FounderScore[];
  currentWeek: string; // YYYY-MM-DD (Monday)
  loading: boolean;
}

interface LeaderboardActions {
  refresh: () => Promise<void>;
}

/** Get the Monday of the current week as YYYY-MM-DD. */
function getCurrentWeekMonday(): string {
  const now = new Date();
  const day = now.getUTCDay();
  const diff = day === 0 ? 6 : day - 1; // Monday = 0 offset
  const monday = new Date(now);
  monday.setUTCDate(now.getUTCDate() - diff);
  return monday.toISOString().slice(0, 10);
}

export const useLeaderboardStore = create<LeaderboardState & LeaderboardActions>(
  (set) => ({
    scores: [],
    currentWeek: getCurrentWeekMonday(),
    loading: false,

    refresh: async () => {
      set({ loading: true });

      try {
        const currentWeek = getCurrentWeekMonday();

        // Fetch founders from PocketBase (users with founder/ceo role)
        const users = await pb.collection("users").getFullList({
          filter: 'role ~ "founder" || role ~ "ceo" || role ~ "Founder" || role ~ "CEO"',
        });

        const founders = users.map((u) => ({
          id: u.id,
          name: (u.name as string) ?? u.id,
        }));

        if (founders.length === 0) {
          set({ scores: [], currentWeek, loading: false });
          return;
        }

        // Compute weekly hours and tasks from Tauri backend if available
        const weeklyHours = new Map<string, number>();
        const weeklyTasks = new Map<string, number>();
        const peerReviewAvgs = new Map<string, number>();

        if (isTauri()) {
          // Use startup health raw data to get founder weekly hours
          try {
            const healthData = await invoke<{
              founderHours: Array<{ founderId: string; weeklyHours: number }>;
            }>("compute_startup_health");

            for (const fh of healthData.founderHours) {
              weeklyHours.set(fh.founderId, fh.weeklyHours);
            }
          } catch {
            // Fall back to zero hours
          }

          // Fetch task completion counts for the week
          try {
            const tasks = await invoke<
              Array<{ assigneeId: string | null; status: string }>
            >("list_tasks", { projectId: null });

            for (const task of tasks) {
              if (task.status === "done" && task.assigneeId) {
                weeklyTasks.set(
                  task.assigneeId,
                  (weeklyTasks.get(task.assigneeId) ?? 0) + 1,
                );
              }
            }
          } catch {
            // Fall back to zero tasks
          }
        }

        // Compute scores using the leaderboard engine
        const scores = computeFounderScores(
          founders,
          weeklyHours,
          weeklyTasks,
          peerReviewAvgs,
        );

        set({ scores, currentWeek, loading: false });
      } catch {
        set({ loading: false });
      }
    },
  }),
);
