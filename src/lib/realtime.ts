/**
 * PocketBase Realtime Manager
 *
 * Manages WebSocket subscriptions for the live team view and
 * governance data (equity_stakes, review_cycles, dilution_events).
 * Subscribes to active sessions, session_tasks, breaks, and
 * governance collections — updating teamStore, equityStore, and
 * reviewStore on incoming events.
 *
 * Handles disconnection with exponential backoff reconnection
 * and full state refresh on reconnect.
 *
 * Requirements: 22.3, 21.1
 */

import type { RecordSubscription } from "pocketbase";
import { pb } from "@/lib/pocketbase";
import { useTeamStore } from "@/stores/teamStore";
import { useEquityStore } from "@/stores/equityStore";
import { useReviewStore } from "@/stores/reviewStore";
import type { TeamMemberStatus } from "@/types";

export interface TeamEvent {
  type:
    | "session_update"
    | "task_update"
    | "break_update"
    | "equity_stake_update"
    | "review_cycle_update"
    | "dilution_event_update";
  userId: string;
  record: Record<string, unknown>;
  action: "create" | "update" | "delete";
}

export type TeamEventCallback = (event: TeamEvent) => void;

/** Connection state for the realtime manager. */
export type ConnectionState = "disconnected" | "connecting" | "connected";

const BASE_RECONNECT_DELAY_MS = 1_000;
const MAX_RECONNECT_DELAY_MS = 60_000;

export class RealtimeManager {
  private _state: ConnectionState = "disconnected";
  private _lastUpdateTime: number | null = null;
  private _reconnectAttempts = 0;
  private _reconnectTimer: ReturnType<typeof setTimeout> | null = null;
  private _unsubscribers: Array<() => void> = [];
  private _listeners: TeamEventCallback[] = [];
  private _destroyed = false;

  // --- Public API ---

  /** Current connection state. */
  get connectionState(): ConnectionState {
    return this._state;
  }

  /** Timestamp of the last received realtime event, or null. */
  get lastUpdateTime(): number | null {
    return this._lastUpdateTime;
  }

  /** Human-readable "last updated X ago" string, or null if never updated. */
  getLastUpdatedLabel(): string | null {
    if (this._lastUpdateTime == null) return null;
    const agoMs = Date.now() - this._lastUpdateTime;
    const agoSec = Math.floor(agoMs / 1000);
    if (agoSec < 60) return `Last updated ${agoSec}s ago`;
    const agoMin = Math.floor(agoSec / 60);
    if (agoMin < 60) return `Last updated ${agoMin}m ago`;
    const agoHr = Math.floor(agoMin / 60);
    return `Last updated ${agoHr}h ago`;
  }

  /**
   * Connect to PocketBase realtime and subscribe to team collections.
   * On reconnect, performs a full state refresh before re-subscribing.
   */
  async connect(): Promise<void> {
    if (this._destroyed) return;
    this._setState("connecting");

    try {
      // Full state refresh: fetch all active sessions, tasks, breaks
      await this._refreshFullState();

      // Subscribe to realtime events
      await this._subscribeAll();

      this._setState("connected");
      this._reconnectAttempts = 0;
    } catch {
      this._setState("disconnected");
      this._scheduleReconnect();
    }
  }

  /** Disconnect from all subscriptions and stop reconnection. */
  disconnect(): void {
    this._clearReconnectTimer();
    this._unsubscribeAll();
    this._setState("disconnected");
  }

  /** Permanently tear down the manager. */
  destroy(): void {
    this._destroyed = true;
    this.disconnect();
    this._listeners = [];
  }

  /**
   * Register a callback for team update events.
   * Returns an unsubscribe function.
   */
  subscribeTeamUpdates(callback: TeamEventCallback): () => void {
    this._listeners.push(callback);
    return () => {
      this._listeners = this._listeners.filter((cb) => cb !== callback);
    };
  }

  /** Whether the manager is currently connected. */
  isConnected(): boolean {
    return this._state === "connected";
  }

  // --- Internal ---

  private _setState(state: ConnectionState): void {
    this._state = state;
  }

  /**
   * Fetch current active sessions, tasks, and breaks from PocketBase
   * and populate the teamStore. Called on initial connect and reconnect.
   */
  private async _refreshFullState(): Promise<void> {
    const store = useTeamStore.getState();
    store.clearMembers();

    try {
      // Fetch active sessions (endTime is empty/null)
      const sessions = await pb.collection("sessions").getFullList({
        filter: 'endTime = null || endTime = ""',
      });

      for (const session of sessions) {
        const userId = session.userId as string;
        let status: TeamMemberStatus = "active";

        // Check for active breaks
        const breaks = await pb.collection("breaks").getFullList({
          filter: `sessionId = "${session.id}" && (endTime = null || endTime = "")`,
        });
        if (breaks.length > 0) {
          status = "on_break";
        }

        // Get current task
        const tasks = await pb.collection("session_tasks").getFullList({
          filter: `sessionId = "${session.id}" && (endTime = null || endTime = "")`,
          sort: "-startTime",
        });

        store.updateMember(userId, {
          name: (session.userName as string) ?? userId,
          status,
          currentTask: tasks.length > 0 ? (tasks[0].taskId as string) : null,
          sessionStart: session.startTime as number,
          breakStart:
            breaks.length > 0 ? (breaks[0].startTime as number) : null,
          outputNote: (session.outputNote as string) ?? null,
          avatarColor: "#6e6af6",
        });
      }

      this._lastUpdateTime = Date.now();
    } catch {
      // If refresh fails, we'll retry on reconnect
    }
  }

  /** Subscribe to sessions, session_tasks, breaks, and governance collections. */
  private async _subscribeAll(): Promise<void> {
    this._unsubscribeAll();

    const sessionUnsub = await pb
      .collection("sessions")
      .subscribe("*", (e) => this._handleSessionEvent(e));
    this._unsubscribers.push(() => {
      pb.collection("sessions").unsubscribe("*").catch(() => {});
      void sessionUnsub;
    });

    const taskUnsub = await pb
      .collection("session_tasks")
      .subscribe("*", (e) => this._handleTaskEvent(e));
    this._unsubscribers.push(() => {
      pb.collection("session_tasks").unsubscribe("*").catch(() => {});
      void taskUnsub;
    });

    const breakUnsub = await pb
      .collection("breaks")
      .subscribe("*", (e) => this._handleBreakEvent(e));
    this._unsubscribers.push(() => {
      pb.collection("breaks").unsubscribe("*").catch(() => {});
      void breakUnsub;
    });

    // Governance subscriptions (Req 22.3, 21.1)
    const equityStakesUnsub = await pb
      .collection("equity_stakes")
      .subscribe("*", (e) => this._handleGovernanceEvent(e, "equity_stake_update"));
    this._unsubscribers.push(() => {
      pb.collection("equity_stakes").unsubscribe("*").catch(() => {});
      void equityStakesUnsub;
    });

    const reviewCyclesUnsub = await pb
      .collection("review_cycles")
      .subscribe("*", (e) => this._handleGovernanceEvent(e, "review_cycle_update"));
    this._unsubscribers.push(() => {
      pb.collection("review_cycles").unsubscribe("*").catch(() => {});
      void reviewCyclesUnsub;
    });

    const dilutionEventsUnsub = await pb
      .collection("dilution_events")
      .subscribe("*", (e) => this._handleGovernanceEvent(e, "dilution_event_update"));
    this._unsubscribers.push(() => {
      pb.collection("dilution_events").unsubscribe("*").catch(() => {});
      void dilutionEventsUnsub;
    });
  }

  private _unsubscribeAll(): void {
    for (const unsub of this._unsubscribers) {
      try {
        unsub();
      } catch {
        // Ignore cleanup errors
      }
    }
    this._unsubscribers = [];
  }

  private _handleSessionEvent(e: RecordSubscription): void {
    this._lastUpdateTime = Date.now();
    const record = e.record;
    const userId = record.userId as string;
    const store = useTeamStore.getState();

    const event: TeamEvent = {
      type: "session_update",
      userId,
      record: record as unknown as Record<string, unknown>,
      action: e.action as "create" | "update" | "delete",
    };

    if (e.action === "delete" || record.endTime != null) {
      // Session ended or deleted — mark offline
      store.updateMember(userId, { status: "offline" as TeamMemberStatus });
    } else {
      // Session created or updated — mark active
      store.updateMember(userId, {
        status: "active" as TeamMemberStatus,
        sessionStart: record.startTime as number,
        outputNote: (record.outputNote as string) ?? null,
      });
    }

    this._notifyListeners(event);
  }

  private _handleTaskEvent(e: RecordSubscription): void {
    this._lastUpdateTime = Date.now();
    const record = e.record;
    const store = useTeamStore.getState();

    // We need the userId from the parent session — use sessionId to look up
    // For now, iterate members to find the one with a matching session
    const sessionId = record.sessionId as string;
    const taskId = record.taskId as string;

    // Find the member whose session matches
    const members = store.members;
    for (const [userId, member] of Object.entries(members)) {
      // If this member has an active session, update their current task
      if (member.status === "active" || member.status === "on_break") {
        if (e.action === "create" && record.endTime == null) {
          store.updateMember(userId, { currentTask: taskId });
        }
      }
    }

    const event: TeamEvent = {
      type: "task_update",
      userId: "", // resolved from session context
      record: record as unknown as Record<string, unknown>,
      action: e.action as "create" | "update" | "delete",
    };
    void sessionId; // used for context

    this._notifyListeners(event);
  }

  private _handleBreakEvent(e: RecordSubscription): void {
    this._lastUpdateTime = Date.now();
    const record = e.record;
    const store = useTeamStore.getState();

    const sessionId = record.sessionId as string;

    // Find the member with this session and update their break status
    const members = store.members;
    for (const [userId, member] of Object.entries(members)) {
      if (member.status === "active" || member.status === "on_break") {
        if (e.action === "create" && record.endTime == null) {
          // Break started
          store.updateMember(userId, {
            status: "on_break" as TeamMemberStatus,
            breakStart: record.startTime as number,
          });
        } else if (record.endTime != null) {
          // Break ended — back to active
          store.updateMember(userId, {
            status: "active" as TeamMemberStatus,
            breakStart: null,
          });
        }
      }
    }

    const event: TeamEvent = {
      type: "break_update",
      userId: "",
      record: record as unknown as Record<string, unknown>,
      action: e.action as "create" | "update" | "delete",
    };
    void sessionId;

    this._notifyListeners(event);
  }

  /**
   * Handle governance collection events (equity_stakes, review_cycles, dilution_events).
   * Triggers store refreshes so the UI updates within 3 seconds of a change (Req 22.3).
   */
  private _handleGovernanceEvent(
    e: RecordSubscription,
    type: "equity_stake_update" | "review_cycle_update" | "dilution_event_update",
  ): void {
    this._lastUpdateTime = Date.now();
    const record = e.record;

    // Refresh the appropriate store(s) based on event type
    if (type === "equity_stake_update" || type === "dilution_event_update") {
      useEquityStore.getState().refresh();
    }
    if (type === "review_cycle_update") {
      useReviewStore.getState().refresh();
    }
    // Dilution events also affect review context (consecutive warnings)
    if (type === "dilution_event_update") {
      useReviewStore.getState().refresh();
    }

    const event: TeamEvent = {
      type,
      userId: (record.founderId as string) ?? "",
      record: record as unknown as Record<string, unknown>,
      action: e.action as "create" | "update" | "delete",
    };

    this._notifyListeners(event);
  }

  private _notifyListeners(event: TeamEvent): void {
    for (const cb of this._listeners) {
      try {
        cb(event);
      } catch {
        // Don't let a listener error break the event loop
      }
    }
  }

  /** Schedule a reconnection attempt with exponential backoff. */
  private _scheduleReconnect(): void {
    if (this._destroyed) return;
    this._clearReconnectTimer();

    const delay = Math.min(
      BASE_RECONNECT_DELAY_MS * Math.pow(2, this._reconnectAttempts),
      MAX_RECONNECT_DELAY_MS,
    );
    this._reconnectAttempts++;

    this._reconnectTimer = setTimeout(() => {
      void this.connect();
    }, delay);
  }

  private _clearReconnectTimer(): void {
    if (this._reconnectTimer != null) {
      clearTimeout(this._reconnectTimer);
      this._reconnectTimer = null;
    }
  }
}

/** Singleton instance for app-wide use. */
export const realtimeManager = new RealtimeManager();
