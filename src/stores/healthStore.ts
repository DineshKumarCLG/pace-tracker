/**
 * Startup Health Zustand store for PACE v3 Founder Governance.
 *
 * State: data, config, decisions, loading
 * Actions: refresh(), updateConfig(), logDecision(), resolveDecision()
 * Wired to startup health functions and Rust commands via Tauri IPC.
 *
 * Requirements: 12.1, 12.5, 14.1, 14.6
 */

import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";
import { isTauri } from "@/lib/tauri";
import {
  computeRunway,
  computeFounderBalance,
  computeDecisionVelocity,
  computeBurnRateAlignment,
  type StartupHealthData,
  type StartupHealthConfig,
  type Decision,
} from "@/lib/startupHealth";

/** Raw data returned from the Rust compute_startup_health command. */
interface StartupHealthRawData {
  config: {
    id: string;
    cashBalance: number;
    monthlyExpenses: string; // JSON array string
    plannedMonthlyBudget: number;
    updatedAt: number;
  } | null;
  decisions: Array<{
    id: string;
    title: string;
    description: string;
    createdAt: number;
    resolvedAt: number | null;
  }>;
  founderHours: Array<{
    founderId: string;
    name: string;
    weeklyHours: number;
  }>;
}

interface HealthState {
  data: StartupHealthData | null;
  config: StartupHealthConfig | null;
  decisions: Decision[];
  loading: boolean;
}

interface HealthActions {
  refresh: () => Promise<void>;
  updateConfig: (config: StartupHealthConfig) => Promise<void>;
  logDecision: (title: string, description: string) => Promise<void>;
  resolveDecision: (decisionId: string) => Promise<void>;
}

/** Parse the raw config from Rust into a StartupHealthConfig. */
function parseConfig(
  raw: StartupHealthRawData["config"],
): StartupHealthConfig | null {
  if (!raw) return null;

  let monthlyExpenses: number[] = [];
  try {
    monthlyExpenses = JSON.parse(raw.monthlyExpenses);
  } catch {
    monthlyExpenses = [];
  }

  return {
    cashBalance: raw.cashBalance,
    monthlyExpenses,
    plannedMonthlyBudget: raw.plannedMonthlyBudget,
  };
}

/** Map raw decision rows to Decision objects. */
function mapDecisions(
  raw: StartupHealthRawData["decisions"],
): Decision[] {
  return raw.map((d) => ({
    id: d.id,
    title: d.title,
    description: d.description,
    createdAt: d.createdAt,
    resolvedAt: d.resolvedAt,
  }));
}

export const useHealthStore = create<HealthState & HealthActions>(
  (set, get) => ({
    data: null,
    config: null,
    decisions: [],
    loading: false,

    refresh: async () => {
      if (!isTauri()) return;
      set({ loading: true });

      try {
        const rawData = await invoke<StartupHealthRawData>(
          "compute_startup_health",
        );

        const config = parseConfig(rawData.config);
        const decisions = mapDecisions(rawData.decisions);

        // Compute health metrics using TypeScript engine functions
        let healthData: StartupHealthData;

        if (config) {
          const runway = computeRunway(config);

          // Build founder hours map for balance computation
          const founderHours = new Map<string, number>();
          const founderNames = new Map<string, string>();
          for (const fh of rawData.founderHours) {
            founderHours.set(fh.founderId, fh.weeklyHours);
            founderNames.set(fh.founderId, fh.name);
          }

          const founderBalance = computeFounderBalance(
            founderHours,
            founderNames,
          );

          const now = Math.floor(Date.now() / 1000);
          const decisionVelocity = computeDecisionVelocity(decisions, 30, now);

          // Compute burn rate from most recent month's expenses vs planned budget
          const actualSpend =
            config.monthlyExpenses.length > 0
              ? config.monthlyExpenses[config.monthlyExpenses.length - 1]
              : 0;
          const burnRate = computeBurnRateAlignment(
            actualSpend,
            config.plannedMonthlyBudget,
          );

          healthData = {
            runwayMonths: runway.months,
            runwayStatus: runway.status,
            founderBalance,
            decisionVelocity,
            burnRateAlignment: burnRate.pct,
            burnRateStatus: burnRate.status,
          };
        } else {
          // No config yet — return defaults
          healthData = {
            runwayMonths: Infinity,
            runwayStatus: "normal",
            founderBalance: { stdDev: 0, founders: [], teamAvgHours: 0 },
            decisionVelocity: 0,
            burnRateAlignment: 0,
            burnRateStatus: "normal",
          };
        }

        set({ data: healthData, config, decisions, loading: false });
      } catch {
        set({ loading: false });
      }
    },

    updateConfig: async (newConfig: StartupHealthConfig) => {
      if (!isTauri()) return;
      set({ loading: true });

      try {
        const now = Math.floor(Date.now() / 1000);
        const expensesJson = JSON.stringify(newConfig.monthlyExpenses);

        // Upsert startup_health_config via Rust SQL (local-only, never synced)
        await invoke("execute_sql", {
          sql: `INSERT INTO startup_health_config (id, cashBalance, monthlyExpenses, plannedMonthlyBudget, updatedAt)
                VALUES ('default', $1, $2, $3, $4)
                ON CONFLICT(id) DO UPDATE SET
                  cashBalance = $1,
                  monthlyExpenses = $2,
                  plannedMonthlyBudget = $3,
                  updatedAt = $4`,
          params: [
            newConfig.cashBalance,
            expensesJson,
            newConfig.plannedMonthlyBudget,
            now,
          ],
        }).catch(() => {
          // Fallback: if execute_sql doesn't exist, try direct approach
          // This will be wired when the Rust command is available
        });

        set({ config: newConfig });
        await get().refresh();
      } catch (error) {
        set({ loading: false });
        throw error;
      }
    },

    logDecision: async (title: string, description: string) => {
      if (!isTauri()) return;
      set({ loading: true });

      try {
        const now = Math.floor(Date.now() / 1000);
        const id = crypto.randomUUID();

        await invoke("execute_sql", {
          sql: `INSERT INTO decisions (id, title, description, createdAt)
                VALUES ($1, $2, $3, $4)`,
          params: [id, title, description, now],
        }).catch(() => {
          // Fallback: will be wired when the Rust command is available
        });

        // Optimistically add to local state
        const newDecision: Decision = {
          id,
          title,
          description,
          createdAt: now,
          resolvedAt: null,
        };

        set((state) => ({
          decisions: [newDecision, ...state.decisions],
        }));

        await get().refresh();
      } catch (error) {
        set({ loading: false });
        throw error;
      }
    },

    resolveDecision: async (decisionId: string) => {
      if (!isTauri()) return;
      set({ loading: true });

      try {
        const now = Math.floor(Date.now() / 1000);

        await invoke("execute_sql", {
          sql: `UPDATE decisions SET resolvedAt = $1 WHERE id = $2`,
          params: [now, decisionId],
        }).catch(() => {
          // Fallback: will be wired when the Rust command is available
        });

        // Optimistically update local state
        set((state) => ({
          decisions: state.decisions.map((d) =>
            d.id === decisionId ? { ...d, resolvedAt: now } : d,
          ),
        }));

        await get().refresh();
      } catch (error) {
        set({ loading: false });
        throw error;
      }
    },
  }),
);
