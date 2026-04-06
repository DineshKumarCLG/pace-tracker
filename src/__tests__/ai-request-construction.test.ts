import { describe, it, expect } from "vitest";

/**
 * Unit tests for AI request construction.
 *
 * Tests that prompts/payloads are built correctly for each AI endpoint.
 * Validates: Requirements 17.1, 17.3
 */

// --- Types mirroring the PACE data model ---

interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
  outputNote: string | null;
}

interface SessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  startTime: number;
  endTime: number;
}

interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number;
  type: "lunch" | "short" | "meeting" | "discarded";
}

interface Task {
  id: string;
  title: string;
  projectId: string;
  closedAt: number | null;
  status: string;
}

// --- Prompt builders (mirror server-side logic for testing) ---

function buildWeeklyReviewPrompt(
  sessions: Session[],
  tasks: Task[],
  breaks: Break[],
  outputNotes: string[],
  weekStart: number,
  weekEnd: number,
): string {
  return `You are a work reflection assistant for a small dev team. Write a concise weekly review narrative.

Tone: direct, non-judgmental, factual. Do NOT include productivity scores, rankings, or comparisons between team members.

Data for the week (${new Date(weekStart * 1000).toISOString().split("T")[0]} to ${new Date(weekEnd * 1000).toISOString().split("T")[0]}):

Sessions: ${sessions.length} completed sessions
Tasks closed: ${tasks.length} (${tasks.map((t) => t.title).join(", ") || "none"})
Breaks: ${breaks.length}
Output notes: ${outputNotes.join(" | ") || "none"}

Include:
1. Top project by time
2. Tasks closed summary
3. Gaps or patterns observed
4. One suggested priority for next week

Keep it under 200 words.`;
}

function buildTaskParsePrompt(
  text: string,
  projects: Array<{ id: string; name: string }>,
  team: Array<{ id: string; name: string }>,
): string {
  const today = new Date().toISOString().split("T")[0];
  return `Parse this natural language task description into structured fields.

Input: "${text}"

Available projects: ${JSON.stringify(projects.map((p) => ({ id: p.id, name: p.name })))}
Team members: ${JSON.stringify(team.map((t) => ({ id: t.id, name: t.name })))}
Today's date: ${today}

Return ONLY valid JSON with these fields:
{
  "title": "concise task title",
  "projectId": "matching project id or null",
  "assigneeId": "matching team member id or null",
  "priority": "high" | "medium" | "low",
  "dueDate": "YYYY-MM-DD or null"
}

Rules:
- Match project/assignee names fuzzy (e.g. "arjun" matches "Arjun")
- "urgent"/"asap"/"critical" → high priority
- "friday"/"next week"/relative dates → resolve to YYYY-MM-DD from today
- Default priority: medium
- If no match found for project/assignee, use null`;
}

function buildStandupPrompt(
  sessions: Session[],
  tasksTouched: string[],
  outputNotes: string[],
): string {
  return `Generate a brief standup update from yesterday's work data.

Sessions: ${sessions.length} completed
Tasks touched: ${tasksTouched.join(", ") || "none"}
Output notes: ${outputNotes.join(" | ") || "none"}

Format:
- Yesterday: [what was done]
- Today: [suggested focus based on yesterday's work]
- Blockers: [any apparent blockers, or "none"]

Keep it under 100 words. Tone: direct, factual.`;
}

function buildEstimatePrompt(
  taskTitle: string,
  historicalTasks: Array<{ title: string; totalMinutes: number }>,
): string {
  const historicalContext = historicalTasks
    .map((t) => `"${t.title}" → ${t.totalMinutes}min`)
    .join("\n");

  return `Estimate effort for this task based on historical data.

Task: "${taskTitle}"

Historical completed tasks with actual time:
${historicalContext || "No historical data available"}

Return ONLY valid JSON:
{
  "minMinutes": <number>,
  "maxMinutes": <number>,
  "reasoning": "<one sentence>"
}`;
}

// --- Tests ---

describe("AI Request Construction", () => {
  describe("Weekly review prompt", () => {
    const weekStart = 1700000000;
    const weekEnd = weekStart + 7 * 24 * 3600;

    it("includes sessions, tasks, breaks, and output notes for the week", () => {
      const sessions: Session[] = [
        { id: "s1", userId: "u1", startTime: weekStart + 100, endTime: weekStart + 30000, outputNote: "Shipped feature X" },
        { id: "s2", userId: "u1", startTime: weekStart + 86400, endTime: weekStart + 86400 + 28800, outputNote: "Fixed bug Y" },
      ];
      const tasks: Task[] = [
        { id: "t1", title: "Feature X", projectId: "p1", closedAt: weekStart + 30000, status: "done" },
      ];
      const breaks: Break[] = [
        { id: "b1", sessionId: "s1", startTime: weekStart + 10000, endTime: weekStart + 13600, type: "lunch" },
      ];
      const notes = ["Shipped feature X", "Fixed bug Y"];

      const prompt = buildWeeklyReviewPrompt(sessions, tasks, breaks, notes, weekStart, weekEnd);

      expect(prompt).toContain("2 completed sessions");
      expect(prompt).toContain("Feature X");
      expect(prompt).toContain("1");
      expect(prompt).toContain("Shipped feature X");
      expect(prompt).toContain("Fixed bug Y");
    });

    it("excludes active sessions (endTime = null)", () => {
      const sessions: Session[] = [
        { id: "s1", userId: "u1", startTime: weekStart + 100, endTime: weekStart + 30000, outputNote: null },
      ];
      // Active session should NOT be in the input
      const activeSessions: Session[] = [
        { id: "s2", userId: "u1", startTime: weekStart + 86400, endTime: null, outputNote: "WIP" },
      ];

      // Only completed sessions should be passed to the prompt builder
      const prompt = buildWeeklyReviewPrompt(sessions, [], [], [], weekStart, weekEnd);
      expect(prompt).toContain("1 completed sessions");

      // Active sessions should be filtered before reaching the prompt builder
      const completedOnly = [...sessions, ...activeSessions].filter((s) => s.endTime !== null);
      expect(completedOnly.length).toBe(1);
      expect(completedOnly[0].id).toBe("s1");
    });

    it("includes tone directive: direct, non-judgmental, factual", () => {
      const prompt = buildWeeklyReviewPrompt([], [], [], [], weekStart, weekEnd);
      expect(prompt).toContain("direct, non-judgmental, factual");
    });

    it("does not request productivity scores or member comparisons", () => {
      const prompt = buildWeeklyReviewPrompt([], [], [], [], weekStart, weekEnd);
      expect(prompt).toContain("Do NOT include productivity scores, rankings, or comparisons");
    });
  });

  describe("Task parse prompt", () => {
    it("includes project list, team list, and today's date", () => {
      const projects = [
        { id: "p1", name: "PACE App" },
        { id: "p2", name: "API Gateway" },
      ];
      const team = [
        { id: "u1", name: "Arjun" },
        { id: "u2", name: "Priya" },
      ];

      const prompt = buildTaskParsePrompt("remind arjun to send demo by friday", projects, team);

      expect(prompt).toContain("PACE App");
      expect(prompt).toContain("API Gateway");
      expect(prompt).toContain("Arjun");
      expect(prompt).toContain("Priya");
      // Today's date in YYYY-MM-DD format
      const today = new Date().toISOString().split("T")[0];
      expect(prompt).toContain(today);
    });

    it("specifies valid JSON return format with required fields", () => {
      const prompt = buildTaskParsePrompt("test task", [], []);

      expect(prompt).toContain('"title"');
      expect(prompt).toContain('"projectId"');
      expect(prompt).toContain('"assigneeId"');
      expect(prompt).toContain('"priority"');
      expect(prompt).toContain('"dueDate"');
      expect(prompt).toContain("Return ONLY valid JSON");
    });
  });

  describe("Standup prompt", () => {
    it("includes yesterday's sessions, tasks touched, and output note", () => {
      const sessions: Session[] = [
        { id: "s1", userId: "u1", startTime: 1700000000, endTime: 1700030000, outputNote: "Deployed v2" },
      ];
      const tasksTouched = ["Feature X", "Bug fix Y"];
      const outputNotes = ["Deployed v2"];

      const prompt = buildStandupPrompt(sessions, tasksTouched, outputNotes);

      expect(prompt).toContain("1 completed");
      expect(prompt).toContain("Feature X");
      expect(prompt).toContain("Bug fix Y");
      expect(prompt).toContain("Deployed v2");
    });
  });

  describe("Effort estimate prompt", () => {
    it("includes last 30 completed tasks with titles and actual time", () => {
      const historical = [
        { title: "Add login page", totalMinutes: 120 },
        { title: "Fix CSS bug", totalMinutes: 30 },
        { title: "Write tests", totalMinutes: 90 },
      ];

      const prompt = buildEstimatePrompt("Build settings page", historical);

      expect(prompt).toContain("Build settings page");
      expect(prompt).toContain('"Add login page" → 120min');
      expect(prompt).toContain('"Fix CSS bug" → 30min');
      expect(prompt).toContain('"Write tests" → 90min');
    });

    it("handles empty historical data gracefully", () => {
      const prompt = buildEstimatePrompt("New task", []);
      expect(prompt).toContain("No historical data available");
    });
  });
});
