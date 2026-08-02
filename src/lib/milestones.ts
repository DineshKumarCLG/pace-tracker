/**
 * Milestone CRUD and computation functions for PACE v2 Team Ops.
 *
 * Pure functions for:
 * - Creating milestones with name, project, deadline
 * - Checking if a milestone can be completed (all tasks done)
 * - Computing deadline warnings (within 3 days)
 * - Sorting milestones by deadline
 *
 * Requirements: 17.1, 17.2, 17.3, 17.4
 */

import type { Milestone, MilestoneTask, Task } from "@/types";

/**
 * Create a new Milestone object.
 *
 * Requirements: 17.1
 *
 * @param id - Unique identifier
 * @param name - Milestone name (required, non-empty)
 * @param projectId - Associated project ID
 * @param deadline - Deadline as UTC timestamp
 * @param createdBy - User ID of the creator
 * @returns A new Milestone object
 */
export function createMilestone(
  id: string,
  name: string,
  projectId: string,
  deadline: number,
  createdBy: string,
): Milestone {
  if (!name || name.trim().length === 0) {
    throw new Error("Milestone name is required");
  }

  const now = Math.floor(Date.now() / 1000);

  return {
    id,
    projectId,
    name: name.trim(),
    deadline,
    completedAt: null,
    createdBy,
    createdAt: now,
  };
}

/**
 * Check whether a milestone can be marked as complete.
 *
 * A milestone can only be completed when ALL associated tasks are in "done" status.
 * If there are no associated tasks, the milestone cannot be completed.
 *
 * Requirements: 17.4
 *
 * @param milestoneId - The milestone to check
 * @param milestoneTasks - All milestone-task associations
 * @param tasks - All tasks (used to check status)
 * @returns true if all associated tasks are "done", false otherwise
 */
export function canCompleteMilestone(
  milestoneId: string,
  milestoneTasks: MilestoneTask[],
  tasks: Task[],
): boolean {
  // Find tasks associated with this milestone
  const associatedTaskIds = milestoneTasks
    .filter((mt) => mt.milestoneId === milestoneId)
    .map((mt) => mt.taskId);

  // No associated tasks → cannot complete
  if (associatedTaskIds.length === 0) {
    return false;
  }

  // Check that every associated task exists and has status "done"
  return associatedTaskIds.every((taskId) => {
    const task = tasks.find((t) => t.id === taskId);
    return task !== undefined && task.status === "done";
  });
}

/**
 * Milestone deadline warning info.
 */
export interface MilestoneWarning {
  milestoneId: string;
  name: string;
  projectId: string;
  deadline: number;
  daysRemaining: number;
}

/**
 * Get warnings for milestones whose deadline is within 3 calendar days
 * and that are not yet completed.
 *
 * Requirements: 17.3
 *
 * @param milestones - All milestones
 * @param milestoneTasks - All milestone-task associations (unused here but available for context)
 * @param tasks - All tasks (unused here but available for context)
 * @param now - Current time as UTC timestamp (seconds)
 * @returns Array of warnings for milestones within 3 days of deadline
 */
export function getMilestoneWarnings(
  milestones: Milestone[],
  _milestoneTasks: MilestoneTask[],
  _tasks: Task[],
  now: number,
): MilestoneWarning[] {
  const THREE_DAYS_SECONDS = 3 * 86400;
  const warnings: MilestoneWarning[] = [];

  for (const milestone of milestones) {
    // Skip completed milestones
    if (milestone.completedAt !== null) {
      continue;
    }

    const remaining = milestone.deadline - now;

    // Warning if deadline is within 3 days (and not already past — still warn if past)
    if (remaining <= THREE_DAYS_SECONDS) {
      const daysRemaining = Math.max(0, Math.floor(remaining / 86400));
      warnings.push({
        milestoneId: milestone.id,
        name: milestone.name,
        projectId: milestone.projectId,
        deadline: milestone.deadline,
        daysRemaining,
      });
    }
  }

  return warnings;
}

/**
 * Sort milestones by deadline ascending.
 *
 * Requirements: 17.2
 *
 * @param milestones - Array of milestones to sort
 * @returns A new array sorted by deadline ascending
 */
export function sortMilestonesByDeadline(milestones: Milestone[]): Milestone[] {
  return [...milestones].sort((a, b) => a.deadline - b.deadline);
}
