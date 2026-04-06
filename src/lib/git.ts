/**
 * Git integration — frontend wrappers for Tauri git commands.
 *
 * Collects git log output for configured repos on session end,
 * parses commits, and stores them as git_events linked to the session.
 */

import { invoke } from "@tauri-apps/api/core";
import { Command } from "@tauri-apps/plugin-shell";
import type { GitEvent } from "@/types";

/**
 * Execute `git log` for a single repo path within a time range.
 * Returns the raw stdout output string.
 */
async function execGitLog(
  repoPath: string,
  startTime: number,
  endTime: number,
): Promise<string> {
  const startDate = new Date(startTime * 1000).toISOString();
  const endDate = new Date(endTime * 1000).toISOString();

  try {
    const cmd = Command.create("git", [
      "log",
      `--format=%H %s %ai`,
      `--since=${startDate}`,
      `--until=${endDate}`,
    ], { cwd: repoPath });

    const output = await cmd.execute();
    return output.stdout ?? "";
  } catch {
    // Repo may not exist or git not installed — fail silently
    return "";
  }
}

/**
 * Collect git events for a session across all configured repo paths.
 * Executes git log for each repo, sends output to Rust for parsing and storage.
 */
export async function collectGitEvents(
  sessionId: string,
  userId: string,
  repoPaths: string[],
  startTime: number,
  endTime: number,
): Promise<GitEvent[]> {
  if (repoPaths.length === 0) return [];

  // Collect git log output for each repo in parallel
  const outputs = await Promise.all(
    repoPaths.map(async (repoPath) => {
      const output = await execGitLog(repoPath, startTime, endTime);
      return [repoPath, output] as [string, string];
    }),
  );

  // Filter out empty outputs
  const nonEmpty = outputs.filter(([, output]) => output.trim().length > 0);
  if (nonEmpty.length === 0) return [];

  // Send to Rust for parsing and storage
  return invoke<GitEvent[]>("collect_git_events", {
    sessionId,
    userId,
    repoOutputs: nonEmpty,
  });
}

/**
 * Get git events for a session from SQLite.
 */
export async function getGitEvents(sessionId: string): Promise<GitEvent[]> {
  return invoke<GitEvent[]>("get_git_events", { sessionId });
}
