/**
 * Background Sync Service
 *
 * Queues local data mutations and flushes them to PocketBase every 60 seconds.
 * Uses an in-memory queue with the same interface as the SQLite-backed queue.
 * The actual SQLite backing will be wired when running in Tauri.
 *
 * Queue management (ordering, retry, dead letter) is fully implemented.
 */

import { useUiStore } from "@/stores/uiStore";

export type SyncOperationType = "create" | "update" | "delete";

export interface SyncOperation {
  id: string;
  collection: string;
  operation: SyncOperationType;
  recordId: string;
  data: Record<string, unknown>;
  timestamp: number;
  retryCount: number;
}

export interface DeadLetterEntry {
  id: string;
  collection: string;
  operation: SyncOperationType;
  recordId: string;
  data: Record<string, unknown>;
  error: string;
  timestamp: number;
}

export interface SyncResult {
  synced: number;
  failed: number;
  queued: number;
}

const SYNC_INTERVAL_MS = 60_000;
const MAX_BATCH_SIZE = 50;
const MAX_RETRIES = 5;

/**
 * Collections that are synced to PocketBase.
 * v1: sessions, breaks, tasks, projects, idle_events, output_notes
 * v2: leave_requests, public_holidays, milestones, milestone_tasks,
 *     daily_reports
 * v3: review_cycles, founder_reviews, accountability_warnings,
 *     equity_stakes, dilution_events, decisions
 */
export const SYNCED_COLLECTIONS = [
  // v1
  "sessions",
  "breaks",
  "tasks",
  "projects",
  "idle_events",
  "output_notes",
  // v2
  "leave_requests",
  "public_holidays",
  "milestones",
  "milestone_tasks",
  "daily_reports",
  // v2 workspace proof
  "workspace_proofs",
  "workspace_locations",
  "office_zones",
  // v3 governance
  "review_cycles",
  "founder_reviews",
  "accountability_warnings",
  "equity_stakes",
  "dilution_events",
  "decisions",
] as const;

/**
 * Private collections that must NEVER be synced to PocketBase.
 * These contain personal data visible only to the individual user.
 * Requirements: 16.3, 16.4, 19.3, 25.1, 25.3
 */
export const PRIVATE_COLLECTIONS = [
  "focus_score_history",
] as const;

/**
 * Local-only collections that must NEVER be synced to PocketBase.
 * These contain per-device settings that are not shared across devices.
 * Requirements: 21.1, 21.3
 */
export const LOCAL_ONLY_COLLECTIONS = [
  "startup_health_config",
] as const;

/**
 * Compute exponential backoff delay in ms for a given retry count.
 * Formula: 2^retryCount * 1000 (1s, 2s, 4s, 8s, 16s)
 */
export function computeBackoffMs(retryCount: number): number {
  return Math.pow(2, retryCount) * 1000;
}

/**
 * Stub for PocketBase REST calls.
 * Returns true on success, throws on failure.
 * Will be replaced with real PocketBase client calls.
 */
export type PocketBaseCaller = (op: SyncOperation) => Promise<void>;

const defaultPocketBaseCaller: PocketBaseCaller = async (_op: SyncOperation) => {
  // Stub: no-op until PocketBase is wired up
};

export class SyncService {
  private _queue: SyncOperation[] = [];
  private _deadLetter: DeadLetterEntry[] = [];
  private _intervalId: ReturnType<typeof setInterval> | null = null;
  private _running = false;
  private _online = true;
  private _pbCall: PocketBaseCaller;

  constructor(pbCall?: PocketBaseCaller) {
    this._pbCall = pbCall ?? defaultPocketBaseCaller;
  }

  // --- Public API ---

  /**
   * Add a sync operation to the queue.
   * Called on every local write to ensure offline-first ordering.
   */
  queue(
    collection: string,
    operation: SyncOperationType,
    recordId: string,
    data: Record<string, unknown>,
  ): void {
    if ((PRIVATE_COLLECTIONS as readonly string[]).includes(collection)) {
      throw new Error(
        `Collection "${collection}" is private and must not be synced`,
      );
    }

    if ((LOCAL_ONLY_COLLECTIONS as readonly string[]).includes(collection)) {
      throw new Error(
        `Collection "${collection}" is local-only and must not be synced`,
      );
    }

    const op: SyncOperation = {
      id: crypto.randomUUID(),
      collection,
      operation,
      recordId,
      data,
      timestamp: Date.now(),
      retryCount: 0,
    };
    this._queue.push(op);
  }

  /** Start the 60-second sync interval. */
  start(): void {
    if (this._running) return;
    this._running = true;
    this._intervalId = setInterval(() => {
      void this._syncCycle();
    }, SYNC_INTERVAL_MS);
  }

  /** Stop the sync interval. */
  stop(): void {
    if (this._intervalId !== null) {
      clearInterval(this._intervalId);
      this._intervalId = null;
    }
    this._running = false;
  }

  /** Trigger an immediate sync cycle (flush). */
  async forceSync(): Promise<SyncResult> {
    return this._syncCycle();
  }

  /** Number of operations currently in the queue. */
  getQueueSize(): number {
    return this._queue.length;
  }

  /** Get a snapshot of the current queue (for testing). */
  getQueue(): ReadonlyArray<SyncOperation> {
    return [...this._queue];
  }

  /** Get a snapshot of the dead letter queue (for testing). */
  getDeadLetterQueue(): ReadonlyArray<DeadLetterEntry> {
    return [...this._deadLetter];
  }

  /** Whether the service interval is running. */
  isRunning(): boolean {
    return this._running;
  }

  /** Set online/offline status. */
  setOnline(online: boolean): void {
    this._online = online;
    useUiStore.getState().setSyncStatus(online ? "synced" : "offline");
  }

  /** Current online status. */
  isOnline(): boolean {
    return this._online;
  }

  // --- Internal ---

  /**
   * Process up to 50 operations from the queue in timestamp order.
   * On success: remove from queue.
   * On failure: increment retryCount; after MAX_RETRIES move to dead letter.
   */
  async _syncCycle(): Promise<SyncResult> {
    if (!this._online) {
      useUiStore.getState().setSyncStatus("offline");
      return { synced: 0, failed: 0, queued: this._queue.length };
    }

    if (this._queue.length === 0) {
      return { synced: 0, failed: 0, queued: 0 };
    }

    useUiStore.getState().setSyncStatus("syncing");

    // Sort by timestamp ascending and take up to MAX_BATCH_SIZE
    this._queue.sort((a, b) => a.timestamp - b.timestamp);
    const batch = this._queue.slice(0, MAX_BATCH_SIZE);

    let synced = 0;
    let failed = 0;
    const toRemove = new Set<string>();
    const toDeadLetter: SyncOperation[] = [];

    for (const op of batch) {
      // Check exponential backoff: skip if not enough time has elapsed
      if (op.retryCount > 0) {
        const backoffMs = computeBackoffMs(op.retryCount);
        const elapsed = Date.now() - op.timestamp;
        if (elapsed < backoffMs) {
          // Not ready for retry yet — skip this cycle
          continue;
        }
      }

      try {
        await this._pbCall(op);
        toRemove.add(op.id);
        synced++;
      } catch (error) {
        op.retryCount++;
        if (op.retryCount >= MAX_RETRIES) {
          toDeadLetter.push(op);
          toRemove.add(op.id);
        }
        failed++;
      }
    }

    // Remove synced and dead-lettered operations from queue
    this._queue = this._queue.filter((op) => !toRemove.has(op.id));

    // Move exhausted operations to dead letter
    for (const op of toDeadLetter) {
      this._deadLetter.push({
        id: op.id,
        collection: op.collection,
        operation: op.operation,
        recordId: op.recordId,
        data: op.data,
        error: `Exhausted ${MAX_RETRIES} retries`,
        timestamp: op.timestamp,
      });
    }

    // Update UI store
    const now = Date.now();
    if (synced > 0) {
      useUiStore.getState().setLastSyncTime(now);
    }
    useUiStore.getState().setSyncStatus(
      failed > 0 ? "error" : "synced",
    );

    return { synced, failed, queued: this._queue.length };
  }
}

/** Singleton instance for app-wide use. */
export const syncService = new SyncService();
