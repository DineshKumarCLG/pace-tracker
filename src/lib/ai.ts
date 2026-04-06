/**
 * AI Module — Desktop client interface to PocketBase AI endpoints.
 *
 * All AI requests go through PocketBase JS hooks which resolve API keys
 * server-side. The desktop client NEVER sends API keys or credentials.
 */

import { pb } from "./pocketbase";
import type { Project, User } from "@/types";

/** Parsed task fields returned by the AI parse-task endpoint. */
export interface ParsedTask {
  title: string;
  projectId: string | null;
  assigneeId: string | null;
  priority: "high" | "medium" | "low";
  dueDate: string | null; // YYYY-MM-DD
}

/** AI review generation result. */
export interface AIReviewResult {
  narrative: string;
}

/**
 * Generate a weekly review narrative via PocketBase AI endpoint.
 *
 * Sends only userId, weekStart, and model preference — no API keys.
 * If AI fails, returns null (caller should show data without narrative).
 */
export async function generateWeeklyReview(
  userId: string,
  weekStart: number,
  model?: string,
): Promise<string | null> {
  try {
    const payload: Record<string, unknown> = { userId, weekStart };
    if (model) payload.model = model;

    const response = await pb.send("/api/generate-review", {
      method: "POST",
      body: payload,
    });

    return response?.narrative || null;
  } catch {
    // AI unavailable — return null, caller shows review data without narrative
    return null;
  }
}

/**
 * Parse natural language text into structured task fields.
 *
 * Sends text, project list, and team list to PocketBase — no API keys.
 * If parsing fails, returns raw text as title with null fields.
 */
export async function parseTask(
  text: string,
  projects: Array<Pick<Project, "id" | "name">>,
  team: Array<Pick<User, "id" | "name">>,
  model?: string,
): Promise<ParsedTask> {
  const fallback: ParsedTask = {
    title: text,
    projectId: null,
    assigneeId: null,
    priority: "medium",
    dueDate: null,
  };

  try {
    const payload: Record<string, unknown> = { text, projects, team };
    if (model) payload.model = model;

    const response = await pb.send("/api/parse-task", {
      method: "POST",
      body: payload,
    });

    return {
      title: response?.title || text,
      projectId: response?.projectId || null,
      assigneeId: response?.assigneeId || null,
      priority: response?.priority || "medium",
      dueDate: response?.dueDate || null,
    };
  } catch {
    // Parsing failed — return raw text as title (graceful fallback)
    return fallback;
  }
}


/** Smart leave conflict and suggestion result from PocketBase hook. */
export interface SmartLeaveConflict {
  type: "team_member_on_leave" | "milestone_deadline" | "low_availability";
  description: string;
}

export interface SmartLeaveSuggestion {
  startDate: number;
  endDate: number;
  reason: string;
}

export interface SmartLeaveResponse {
  conflicts: SmartLeaveConflict[];
  aiSuggestions: SmartLeaveSuggestion[] | null;
}

/**
 * Fetch smart leave suggestions from PocketBase AI endpoint.
 *
 * Returns conflict detection and optional AI-suggested alternative dates.
 * If AI is unavailable, aiSuggestions will be null (conflicts still returned).
 * If the entire call fails, returns null (caller shows form without suggestions).
 *
 * Requirements: 21.1, 21.2, 21.3
 */
export async function getSmartLeaveSuggestions(
  requesterId: string,
  startDate: number,
  endDate: number,
  model?: string,
): Promise<SmartLeaveResponse | null> {
  try {
    const payload: Record<string, unknown> = { requesterId, startDate, endDate };
    if (model) payload.model = model;

    const response = await pb.send("/api/smart-leave-suggest", {
      method: "POST",
      body: payload,
    });

    return {
      conflicts: response?.conflicts ?? [],
      aiSuggestions: response?.aiSuggestions ?? null,
    };
  } catch {
    // Endpoint unavailable — return null, caller shows form without suggestions
    return null;
  }
}
