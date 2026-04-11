/**
 * Peer Review Zustand store for PACE v3 Founder Governance.
 *
 * State: currentCycle, results, history, warnings (founderId → count), loading
 * Actions: refresh(), submitReview()
 * Wired to Rust commands via Tauri IPC.
 *
 * When close_review_cycle detects consecutive warnings and triggers dilution
 * (Req 2.5), this store refreshes the equity store and sends an OS notification
 * to the affected founder (Req 6.5, 21.4).
 *
 * Requirements: 1.3, 1.7, 2.5, 2.6, 6.5, 17.1, 17.2, 17.3, 17.4, 17.5, 21.4
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";
import { useAuthStore } from "@/stores/authStore";
import { useEquityStore } from "@/stores/equityStore";
import { validateCapTableSum } from "@/lib/equity";
import { notifyDilutionTriggered } from "@/lib/notifications";

export interface ReviewCycle {
  id: string;
  startDate: number;
  endDate: number;
  submissionDeadline: number;
  status: "open" | "closed" | "resolved";
  resolvedAt: number | null;
  createdAt: number;
}

export interface ReviewResult {
  founderId: string;
  outputAvg: number;
  reliabilityAvg: number;
  initiativeAvg: number;
  overallAvg: number;
}

export interface DilutionEventInfo {
  id: string;
  founderId: string;
  cycleId: string;
  dilutionPct: number;
  previousStakePct: number;
  newStakePct: number;
  redistributionDetails: string;
  createdAt: number;
}

interface ReviewState {
  currentCycle: ReviewCycle | null;
  results: ReviewResult[];
  history: ReviewCycle[];
  warnings: Record<string, number>;
  loading: boolean;
}

interface ReviewActions {
  refresh: () => Promise<void>;
  submitReview: (
    revieweeId: string,
    output: number,
    reliability: number,
    initiative: number,
  ) => Promise<void>;
}

/**
 * After a review cycle is closed/resolved, check if a dilution event was
 * triggered for that cycle. If so, refresh the equity store, validate the
 * cap table sum, and send an OS notification to the affected founder.
 *
 * Requirements: 2.5, 6.5, 21.4
 */
async function handlePostCycleDilution(cycleId: string): Promise<void> {
  try {
    const dilutionEvents = await invoke<DilutionEventInfo[]>(
      "get_dilution_events_for_cycle",
      { cycleId },
    );

    if (dilutionEvents.length === 0) return;

    // Refresh equity store to pick up the dilution changes (Req 6.5)
    await useEquityStore.getState().refresh();

    // Validate cap table sum after dilution (Req 21.4)
    const stakes = useEquityStore.getState().stakes;
    if (stakes.length > 0) {
      validateCapTableSum(stakes);
    }

    // Notify affected founders about dilution (Req 2.5)
    for (const event of dilutionEvents) {
      await notifyDilutionTriggered(event.founderId, event.dilutionPct);
    }
  } catch {
    // Dilution check is best-effort; don't block the review flow
  }
}

export const useReviewStore = create<ReviewState & ReviewActions>(
  (set, get) => ({
    currentCycle: null,
    results: [],
    history: [],
    warnings: {},
    loading: false,

    refresh: async () => {
      if (!isTauri()) return;
      set({ loading: true });

      try {
        const user = useAuthStore.getState().user;
        if (!user) {
          set({ loading: false });
          return;
        }

        // Fetch review history for the current user (returns cycles ordered by startDate DESC)
        const history = await invoke<ReviewCycle[]>("get_review_history", {
          founderId: user.id,
        });

        // The most recent cycle is the current one (if any)
        const currentCycle = history.length > 0 ? history[0] : null;

        // If there's a current cycle that's been closed/resolved, fetch its results
        let results: ReviewResult[] = [];
        if (currentCycle && currentCycle.status !== "open") {
          results = await invoke<ReviewResult[]>("close_review_cycle", {
            cycleId: currentCycle.id,
          }).catch(() => []);

          // Check if dilution was triggered and handle frontend side-effects
          await handlePostCycleDilution(currentCycle.id);
        }

        // Fetch warning counts for all founders in history
        const founderIds = new Set<string>();
        for (const result of results) {
          founderIds.add(result.founderId);
        }
        founderIds.add(user.id);

        const warnings: Record<string, number> = {};
        for (const founderId of founderIds) {
          warnings[founderId] = await invoke<number>("get_warning_count", {
            founderId,
          });
        }

        set({ currentCycle, results, history, warnings, loading: false });
      } catch {
        set({ loading: false });
      }
    },

    submitReview: async (revieweeId, output, reliability, initiative) => {
      if (!isTauri()) return;

      const user = useAuthStore.getState().user;
      if (!user) throw new Error("Not authenticated");

      const { currentCycle } = get();
      if (!currentCycle) throw new Error("No active review cycle");

      set({ loading: true });
      try {
        await invoke("submit_founder_review", {
          cycleId: currentCycle.id,
          reviewerId: user.id,
          revieweeId,
          outputScore: output,
          reliabilityScore: reliability,
          initiativeScore: initiative,
        });

        // Refresh state after submission
        await get().refresh();
      } catch (error) {
        set({ loading: false });
        throw error;
      }
    },
  }),
);
