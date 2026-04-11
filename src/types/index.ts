// PACE Data Model Types

export interface Session {
  id: string;
  userId: string;
  startTime: number;
  endTime: number | null;
  startType: "manual" | "backfill" | "recovered";
  startVerified: boolean;
  outputNote: string | null;
  lastHeartbeat: number | null;
  syncedAt: number | null;
  createdAt: number;
}

export interface SessionTask {
  id: string;
  sessionId: string;
  taskId: string;
  startTime: number;
  endTime: number | null;
}

export interface Break {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number | null;
  type: "lunch" | "short" | "meeting" | "discarded";
  autoDetected: boolean;
}

export interface IdleEvent {
  id: string;
  sessionId: string;
  startTime: number;
  endTime: number | null;
  resolution: "lunch" | "short" | "meeting" | "discarded" | "pending";
}

export interface Task {
  id: string;
  projectId: string;
  title: string;
  status: "open" | "inprogress" | "done" | "blocked";
  assigneeId: string | null;
  priority: "high" | "medium" | "low";
  dueDate: number | null;
  estimatedMinutes: number | null;
  notes: string | null;
  createdBy: string;
  createdAt: number;
  closedAt: number | null;
}

export interface Project {
  id: string;
  name: string;
  color: string;
  createdBy: string;
  createdAt: number;
  archivedAt: number | null;
}

export interface User {
  id: string;
  name: string;
  role: string | null;
  email: string;
  avatarColor: string;
  createdAt: number;
}

export interface Settings {
  userId: string;
  theme: "light" | "dark" | "system";
  idleThresholdMin: number;
  nudgeIntervalMin: number;
  breakCapMin: number;
  weeklyReviewDay: number;
  weeklyReviewHour: number;
  autoPauseOnLock: boolean;
  autoPauseOnSleep: boolean;
  litellmUrl: string | null;
  litellmModel: string;
  litellmApiKey: string | null;
  aiEnabled: boolean;
  gitRepoPaths: string[];
}

export interface WeeklyReview {
  id: string;
  userId: string;
  weekStart: number;
  weekEnd: number;
  aiNarrative: string | null;
  nextPriority: string | null;
  savedAt: number | null;
  createdAt: number;
}

export interface GitEvent {
  id: string;
  sessionId: string | null;
  userId: string;
  repoPath: string;
  commitHash: string;
  message: string | null;
  commitTime: number;
}

/** Team record — a group of founders working together */
export interface Team {
  id: string;
  name: string;
  inviteCode: string;
  createdBy: string;
  createdAt: number;
}

/** Team membership — links a user to a team */
export interface TeamMembership {
  teamId: string;
  userId: string;
  joinedAt: number;
}

/** Team member live status for the team view */
export type TeamMemberStatus = "active" | "on_break" | "away" | "offline";

export interface TeamMember {
  userId: string;
  name: string;
  status: TeamMemberStatus;
  currentTask: string | null;
  sessionStart: number | null;
  breakStart: number | null;
  outputNote: string | null;
  avatarColor: string;
}


/** Leave request record — a founder's request for leave or WFH */
export interface LeaveRequest {
  id: string;
  requesterId: string;
  type: "annual" | "sick" | "wfh";
  startDate: number; // UTC timestamp (start of day)
  endDate: number; // UTC timestamp (end of day)
  reason: string;
  status: "pending" | "approved" | "declined";
  reviewerId: string | null;
  reviewReason: string | null;
  createdAt: number;
  updatedAt: number;
}

/** Public holiday entry */
export interface PublicHoliday {
  id: string;
  date: number; // UTC timestamp (start of day)
  name: string;
  year: number;
  createdAt: number;
}

/** Leave balance for a user in a given year */
export interface LeaveBalance {
  userId: string;
  year: number;
  annualAllocated: number;
  annualUsed: number;
  annualRemaining: number;
  sickAllocated: number;
  sickUsed: number;
  sickRemaining: number;
}

/** Result of validating a leave request */
export interface ValidationResult {
  valid: boolean;
  reason?: string;
  remainingBalance?: number;
  requestedDays?: number;
}

/** Attendance alert for a team member who hasn't logged in by noon */
export interface AttendanceAlert {
  userId: string;
  name: string;
  label: string;
}

/** Overwork signal for a team member working excessive hours */
export interface OverworkSignal {
  userId: string;
  name: string;
  daysOver10h: number;
  message: string;
  severity: "warning";
}

/** Computed daily attendance record derived from session data */
export interface AttendanceRecord {
  userId: string;
  date: string;                    // YYYY-MM-DD (local timezone)
  loginTime: number | null;        // earliest session start (UTC timestamp)
  logoutTime: number | null;       // latest session end (UTC timestamp)
  totalHours: number;              // sum(session durations - break durations) / 3600
  breakMinutes: number;            // sum(break durations) / 60
  outputNote: string | null;       // from last closed session of the day
}

/** Dashboard data aggregated from multiple sources for the Founder Dashboard */
export interface DashboardData {
  teamStatus: Array<{
    userId: string;
    name: string;
    status: "Active" | "On Break" | "Away" | "Offline" | "On Leave" | "WFH";
    currentTask: string | null;
    sessionDuration: number | null;
  }>;
  todayTeamHours: number;
  pendingApprovals: number;
  projectHealth: Array<{
    projectId: string;
    name: string;
    openTasks: number;
    overdueTasks: number;
    hoursThisWeek: number;
  }>;
  weeklyVelocity: { current: number; previous: number };
  upcomingLeave: Array<{
    userId: string;
    name: string;
    type: string;
    startDate: number;
    endDate: number;
  }>;
  attendanceAlerts: AttendanceAlert[];
  milestoneWarnings: Array<{
    milestoneId: string;
    name: string;
    projectName: string;
    deadline: number;
    daysRemaining: number;
  }>;
  overworkSignals: OverworkSignal[];
}


/** Individual analytics computed from session and task data (4-week rolling window) */
export interface IndividualAnalytics {
  userId: string;
  avgDailyHours: number;
  mostProductiveDay: string; // "Monday", "Tuesday", etc.
  peakFocusRange: string; // "10:00-12:00"
  taskCompletionRate: number; // 0.0 - 1.0
  outputConsistency: number; // std dev of daily hours (lower = more consistent)
}


/** Team analytics computed from session, task, and leave data */
export interface TeamAnalytics {
  hoursPerProject: Array<{ projectId: string; projectName: string; totalHours: number }>;
  velocityTrend: Array<{ weekStart: string; tasksCompleted: number }>;
  availabilityHeatmap: Array<{ userId: string; name: string; dailyHours: Array<{ date: string; hours: number }> }>;
  leaveImpactPct: number;
}


/** Focus score — private metric, local-only, never synced (Req 16.1, 16.3, 16.4) */
export interface FocusScore {
  sessionContinuity: number;    // 0.0 - 1.0
  avgUninterruptedMin: number;
  taskCompletionRate: number;   // 0.0 - 1.0
  compositeScore: number;       // 0-100
}


/** Milestone — a named checkpoint within a project with a deadline */
export interface Milestone {
  id: string;
  projectId: string;
  name: string;
  deadline: number;              // UTC timestamp
  completedAt: number | null;    // null if not complete
  createdBy: string;
  createdAt: number;
}

/** MilestoneTask — junction table linking milestones to tasks */
export interface MilestoneTask {
  milestoneId: string;
  taskId: string;
}

/** End-of-day report generated on session close */
export interface DailyReport {
  id: string;
  userId: string;
  sessionId: string;
  date: string;                  // YYYY-MM-DD
  totalMinutes: number;
  tasksWorked: Array<{ taskId: string; title: string; minutes: number }>;
  breaks: Array<{ type: string; minutes: number }>;
  outputNote: string | null;
  gitCommits: Array<{ hash: string; message: string }>;
  createdAt: number;
}





/** Workspace access proof — mandatory check-in/check-out record */
export interface WorkspaceProof {
  id: string;
  sessionId: string;
  userId: string;
  type: "checkin" | "checkout";
  photoPath: string;
  photoHash: string;
  lat: number | null;
  lng: number | null;
  accuracy: number | null;        // meters
  locationId: string | null;      // FK → workspace_locations
  aiVerified: "yes" | "no" | "pending" | "unavailable";
  aiReason: string | null;
  exifTimestamp: number | null;   // UTC timestamp from EXIF data
  createdAt: number;
}

/** Saved workspace location for auto-tagging */
export interface WorkspaceLocation {
  id: string;
  userId: string;
  name: string;                   // e.g. "Kenesis HQ", "Home Office"
  lat: number;
  lng: number;
  radiusMeters: number;           // default 200
  isOfficeZone: boolean;
  createdAt: number;
}

/** Team-level office zone for zone matching */
export interface OfficeZone {
  id: string;
  teamId: string;
  name: string;
  lat: number;
  lng: number;
  radiusMeters: number;           // default 500
  createdBy: string;
  createdAt: number;
}
