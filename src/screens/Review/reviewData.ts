/**
 * Weekly review data types and mock data generator.
 *
 * In production, these would come from TanStack Query hooks
 * aggregating SQLite data. For now, we use deterministic mock data.
 */

export interface DailyHours {
  day: string; // "Mon", "Tue", etc.
  hours: number;
  isWeekend: boolean;
}

export interface ProjectTime {
  projectId: string;
  projectName: string;
  color: string;
  hours: number;
}

export interface OutputNote {
  date: string; // ISO date string
  dayLabel: string; // "Monday", "Tuesday", etc.
  note: string;
}

export interface StaleTask {
  id: string;
  title: string;
  projectName: string;
  daysSinceActivity: number;
}

export interface BlockedTask {
  id: string;
  title: string;
  projectName: string;
}

export interface TeamMemberWeek {
  userId: string;
  name: string;
  avatarColor: string;
  hours: number;
  tasksClosed: number;
  activeDays: number;
}

export interface WeeklyData {
  totalHours: number;
  weekdayHours: number;
  weekendHours: number;
  tasksClosed: number;
  activeDays: number;
  dailyHours: DailyHours[];
  projectBreakdown: ProjectTime[];
  outputNotes: OutputNote[];
  staleTasks: StaleTask[];
  blockedTasks: BlockedTask[];
}

/** Get Monday 00:00 and Sunday 23:59 for a given week offset (0 = current week) */
export function getWeekRange(weekOffset: number): { weekStart: Date; weekEnd: Date } {
  const now = new Date();
  const dayOfWeek = now.getDay(); // 0=Sun, 1=Mon, ...
  const mondayOffset = dayOfWeek === 0 ? -6 : 1 - dayOfWeek;

  const monday = new Date(now);
  monday.setDate(now.getDate() + mondayOffset + weekOffset * 7);
  monday.setHours(0, 0, 0, 0);

  const sunday = new Date(monday);
  sunday.setDate(monday.getDate() + 6);
  sunday.setHours(23, 59, 59, 999);

  return { weekStart: monday, weekEnd: sunday };
}

/** Format week label like "Jan 6 – Jan 12" */
export function formatWeekLabel(weekStart: Date, weekEnd: Date): string {
  const fmt = (d: Date) =>
    d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
  return `${fmt(weekStart)} – ${fmt(weekEnd)}`;
}

const DAY_NAMES = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
const FULL_DAY_NAMES = [
  "Monday",
  "Tuesday",
  "Wednesday",
  "Thursday",
  "Friday",
  "Saturday",
  "Sunday",
];

const PROJECT_PALETTE = [
  { name: "PACE App", color: "#6e6af6" },
  { name: "API Gateway", color: "#f59e0b" },
  { name: "Design System", color: "#10b981" },
  { name: "Docs", color: "#ec4899" },
];

/** Deterministic seeded random for consistent mock data per week offset */
function seededRandom(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807 + 0) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** Generate mock weekly data for a given week offset */
export function getWeeklyMockData(weekOffset: number): WeeklyData {
  const rand = seededRandom(Math.abs(weekOffset) + 42);
  const { weekStart } = getWeekRange(weekOffset);

  // Daily hours (Mon-Sun)
  const dailyHours: DailyHours[] = DAY_NAMES.map((day, i) => {
    const isWeekend = i >= 5;
    const hours = isWeekend
      ? rand() < 0.3 ? Math.round(rand() * 3 * 10) / 10 : 0
      : Math.round((4 + rand() * 5) * 10) / 10;
    return { day, hours, isWeekend };
  });

  const weekdayHours = dailyHours
    .filter((d) => !d.isWeekend)
    .reduce((s, d) => s + d.hours, 0);
  const weekendHours = dailyHours
    .filter((d) => d.isWeekend)
    .reduce((s, d) => s + d.hours, 0);
  const totalHours = weekdayHours + weekendHours;
  const activeDays = dailyHours.filter((d) => d.hours > 0).length;

  // Project breakdown
  const projectCount = 2 + Math.floor(rand() * 3);
  const projectBreakdown: ProjectTime[] = PROJECT_PALETTE.slice(
    0,
    projectCount,
  ).map((p) => ({
    projectId: p.name.toLowerCase().replace(/\s/g, "-"),
    projectName: p.name,
    color: p.color,
    hours: Math.round((totalHours / projectCount) * (0.5 + rand()) * 10) / 10,
  }));

  // Tasks closed
  const tasksClosed = Math.floor(3 + rand() * 8);

  // Output notes (one per active weekday)
  const sampleNotes = [
    "Shipped the session card redesign with 3D glass effects",
    "Fixed idle detection edge case for sleep/wake transitions",
    "Reviewed PRs and paired on sync service retry logic",
    "Built team view WebSocket integration, all statuses working",
    "Refactored task switcher for keyboard-first navigation",
    "Wrote property tests for temporal containment",
    "Deployed PocketBase migration for git_events table",
  ];
  const outputNotes: OutputNote[] = dailyHours
    .filter((d, i) => d.hours > 0 && i < 5)
    .map((d, i) => {
      const date = new Date(weekStart);
      date.setDate(weekStart.getDate() + DAY_NAMES.indexOf(d.day));
      return {
        date: date.toISOString().split("T")[0],
        dayLabel: FULL_DAY_NAMES[DAY_NAMES.indexOf(d.day)],
        note: sampleNotes[i % sampleNotes.length],
      };
    });

  // Stale tasks
  const staleTasks: StaleTask[] =
    rand() > 0.4
      ? [
          {
            id: "stale-1",
            title: "Update onboarding copy",
            projectName: "PACE App",
            daysSinceActivity: 12,
          },
          {
            id: "stale-2",
            title: "Add CSV export for timesheets",
            projectName: "API Gateway",
            daysSinceActivity: 9,
          },
        ]
      : [];

  // Blocked tasks
  const blockedTasks: BlockedTask[] =
    rand() > 0.6
      ? [
          {
            id: "blocked-1",
            title: "SSO integration",
            projectName: "API Gateway",
          },
        ]
      : [];

  return {
    totalHours,
    weekdayHours,
    weekendHours,
    tasksClosed,
    activeDays,
    dailyHours,
    projectBreakdown,
    outputNotes,
    staleTasks,
    blockedTasks,
  };
}

/** Generate mock team data for a given week offset */
export function getTeamWeeklyData(weekOffset: number): TeamMemberWeek[] {
  const rand = seededRandom(Math.abs(weekOffset) + 99);

  const teamMembers = [
    { userId: "u1", name: "Arjun", avatarColor: "#6e6af6" },
    { userId: "u2", name: "Priya", avatarColor: "#f59e0b" },
    { userId: "u3", name: "Kenesis", avatarColor: "#10b981" },
    { userId: "u4", name: "Sam", avatarColor: "#ec4899" },
  ];

  return teamMembers.map((m) => ({
    ...m,
    hours: Math.round((25 + rand() * 20) * 10) / 10,
    tasksClosed: Math.floor(2 + rand() * 8),
    activeDays: Math.floor(3 + rand() * 3),
  }));
}
