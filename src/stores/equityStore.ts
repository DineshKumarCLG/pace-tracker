/**
 * Equity Zustand store for PACE v3 Founder Governance.
 *
 * State: stakes, dilutionHistory, loading
 * Actions: refresh()
 * Wired to equity computation functions and PocketBase realtime subscriptions.
 *
 * Requirements: 6.1, 7.1, 22.3
 */

import { create } from "zustand";
import { pb } from "@/lib/pocketbase";
import type { EquityStake, DilutionEvent } from "@/lib/equity";

interface EquityState {
  stakes: EquityStake[];
  dilutionHistory: DilutionEvent[];
  loading: boolean;
}

interface EquityActions {
  refresh: () => Promise<void>;
}

/** Map a PocketBase record to an EquityStake. */
function mapStakeRecord(record: Record<string, unknown>): EquityStake {
  return {
    id: record.id as string,
    founderId: record.founderId as string,
    initialStakePct: record.initialStakePct as number,
    currentStakePct: record.currentStakePct as number,
    vestingStartDate: record.vestingStartDate as number,
    cliffDate: record.cliffDate as number,
    vestingEndDate: record.vestingEndDate as number,
    vestingScheduleMonths: record.vestingScheduleMonths as number,
    updatedAt: record.updatedAt as number,
  };
}

/** Map a PocketBase record to a DilutionEvent. */
function mapDilutionRecord(record: Record<string, unknown>): DilutionEvent {
  const redistribution = record.redistributionDetails;
  const parsed =
    typeof redistribution === "string"
      ? JSON.parse(redistribution)
      : (redistribution as Record<string, { previous: number; new: number }>);

  return {
    id: record.id as string,
    founderId: record.founderId as string,
    cycleId: record.cycleId as string,
    dilutionPct: record.dilutionPct as number,
    previousStakePct: record.previousStakePct as number,
    newStakePct: record.newStakePct as number,
    redistributionDetails: parsed ?? {},
    createdAt: record.createdAt as number,
  };
}

export const useEquityStore = create<EquityState & EquityActions>(
  (set) => ({
    stakes: [],
    dilutionHistory: [],
    loading: false,

    refresh: async () => {
      set({ loading: true });

      try {
        // Fetch equity stakes from PocketBase
        const stakeRecords = await pb
          .collection("equity_stakes")
          .getFullList({ sort: "-currentStakePct" });

        const stakes = stakeRecords.map((r) =>
          mapStakeRecord(r as unknown as Record<string, unknown>),
        );

        // Fetch dilution history from PocketBase
        const dilutionRecords = await pb
          .collection("dilution_events")
          .getFullList({ sort: "-createdAt" });

        const dilutionHistory = dilutionRecords.map((r) =>
          mapDilutionRecord(r as unknown as Record<string, unknown>),
        );

        set({ stakes, dilutionHistory, loading: false });
      } catch {
        set({ loading: false });
      }
    },
  }),
);

/**
 * Subscribe to PocketBase realtime updates for equity data.
 * Returns an unsubscribe function. (Req 22.3)
 */
export async function subscribeEquityRealtime(): Promise<() => void> {
  const unsubStakes = await pb
    .collection("equity_stakes")
    .subscribe("*", () => {
      useEquityStore.getState().refresh();
    });

  const unsubDilution = await pb
    .collection("dilution_events")
    .subscribe("*", () => {
      useEquityStore.getState().refresh();
    });

  return () => {
    pb.collection("equity_stakes").unsubscribe("*").catch(() => {});
    pb.collection("dilution_events").unsubscribe("*").catch(() => {});
    void unsubStakes;
    void unsubDilution;
  };
}
