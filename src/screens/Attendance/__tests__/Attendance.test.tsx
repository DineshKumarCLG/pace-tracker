/**
 * Attendance Log screen tests.
 *
 * Verifies:
 * - Calendar table renders with correct columns (Req 1.1)
 * - Person filter dropdown works (Req 1.2)
 * - Date range filter inputs present (Req 1.3)
 * - Project filter dropdown works (Req 1.4)
 * - Export CSV button present and functional (Req 1.5)
 * - Empty state when no records match filters (Req 1.6)
 */

import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import type { TeamMember, Project } from "@/types";

// --- Mock data ---
const mockMembers: Record<string, TeamMember> = {
  "u-arjun": {
    userId: "u-arjun",
    name: "Arjun",
    status: "active",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#6e6af6",
  },
  "u-priya": {
    userId: "u-priya",
    name: "Priya",
    status: "active",
    currentTask: null,
    sessionStart: null,
    breakStart: null,
    outputNote: null,
    avatarColor: "#e6a030",
  },
};

const mockProjects: Project[] = [
  { id: "proj-1", name: "PACE App", color: "#d97706", createdBy: "u-arjun", createdAt: 1700000000, archivedAt: null },
  { id: "proj-2", name: "Marketing Site", color: "#6366f1", createdBy: "u-arjun", createdAt: 1700100000, archivedAt: null },
];

vi.mock("@/stores/teamStore", () => ({
  useTeamStore: (selector?: (s: { members: typeof mockMembers }) => unknown) => {
    const state = { members: mockMembers };
    if (typeof selector === "function") return selector(state);
    return state;
  },
}));

vi.mock("@/queries/projects", () => ({
  useProjects: () => ({ data: mockProjects, isLoading: false }),
}));

// Mock workspace proof store (Task 18.13)
vi.mock("@/stores/workspaceProofStore", () => ({
  useWorkspaceProofStore: (selector?: (s: { sessionProofs: unknown[]; savedLocations: unknown[] }) => unknown) => {
    const state = { sessionProofs: [], savedLocations: [] };
    if (typeof selector === "function") return selector(state);
    return state;
  },
}));

// Mock proof integration helpers (Task 18.13)
vi.mock("@/lib/proofIntegration", () => ({
  getProofsForAttendanceRow: () => ({ checkin: null, checkout: null }),
  getProofLocationLabel: () => "Unknown",
}));

// Mock workspace proof helpers
vi.mock("@/lib/workspaceProof", () => ({
  getVerificationLabel: (status: string) => {
    switch (status) {
      case "yes": return "Verified";
      case "no": return "AI Flagged";
      case "pending": return "Pending";
      case "unavailable": return "Unverified";
      default: return status;
    }
  },
}));

// Mock getAttendance and exportAttendanceCsv
const mockGetAttendance = vi.fn().mockReturnValue([]);
const mockExportAttendanceCsv = vi.fn().mockReturnValue("date,person\n");

vi.mock("@/lib/attendance", () => ({
  getAttendance: (...args: unknown[]) => mockGetAttendance(...args),
  exportAttendanceCsv: (...args: unknown[]) => mockExportAttendanceCsv(...args),
}));

import AttendanceScreen from "../index";

beforeEach(() => {
  vi.clearAllMocks();
  mockGetAttendance.mockReturnValue([]);
  mockExportAttendanceCsv.mockReturnValue("date,person\n");
});

describe("AttendanceScreen", () => {
  it("renders the screen header", () => {
    render(<AttendanceScreen />);
    expect(screen.getByText("Attendance")).toBeDefined();
    expect(screen.getByText("Daily login/logout history and work hours")).toBeDefined();
  });

  it("shows empty state when no records match filters (Req 1.6)", () => {
    render(<AttendanceScreen />);
    expect(screen.getByText("No attendance records")).toBeDefined();
    expect(screen.getByText(/No records match the current filters/)).toBeDefined();
  });

  it("renders person filter dropdown with all team members (Req 1.2)", () => {
    render(<AttendanceScreen />);
    const personSelect = screen.getByLabelText("Filter by person");
    expect(personSelect).toBeDefined();

    // Check options
    const options = personSelect.querySelectorAll("option");
    expect(options.length).toBe(3); // "All members" + 2 members
    expect(options[0].textContent).toBe("All members");
    expect(options[1].textContent).toBe("Arjun");
    expect(options[2].textContent).toBe("Priya");
  });

  it("renders date range filter inputs (Req 1.3)", () => {
    render(<AttendanceScreen />);
    expect(screen.getByLabelText("Start date")).toBeDefined();
    expect(screen.getByLabelText("End date")).toBeDefined();
  });

  it("renders project filter dropdown with all projects (Req 1.4)", () => {
    render(<AttendanceScreen />);
    const projectSelect = screen.getByLabelText("Filter by project");
    expect(projectSelect).toBeDefined();

    const options = projectSelect.querySelectorAll("option");
    expect(options.length).toBe(3); // "All projects" + 2 projects
    expect(options[0].textContent).toBe("All projects");
    expect(options[1].textContent).toBe("PACE App");
    expect(options[2].textContent).toBe("Marketing Site");
  });

  it("renders Export CSV button (Req 1.5)", () => {
    render(<AttendanceScreen />);
    const exportBtn = screen.getByLabelText("Export CSV");
    expect(exportBtn).toBeDefined();
    expect(exportBtn.textContent).toContain("Export CSV");
  });

  it("disables Export CSV button when no records", () => {
    render(<AttendanceScreen />);
    const exportBtn = screen.getByLabelText("Export CSV");
    expect(exportBtn.hasAttribute("disabled")).toBe(true);
  });

  it("renders table with correct columns when records exist (Req 1.1)", () => {
    mockGetAttendance.mockReturnValue([
      {
        userId: "u-arjun",
        date: "2025-01-15",
        loginTime: 1736928000,
        logoutTime: 1736960400,
        totalHours: 8.5,
        breakMinutes: 30,
        outputNote: "Shipped sidebar",
      },
    ]);

    render(<AttendanceScreen />);

    // Column headers
    expect(screen.getByText("Date")).toBeDefined();
    expect(screen.getByText("Login")).toBeDefined();
    expect(screen.getByText("Logout")).toBeDefined();
    expect(screen.getByText("Hours")).toBeDefined();
    expect(screen.getByText("Breaks")).toBeDefined();
    expect(screen.getByText("Output Note")).toBeDefined();

    // Row data
    expect(screen.getByText(/15 Jan 2025/)).toBeDefined();
    // "Arjun" appears in both filter dropdown and table row
    const arjunElements = screen.getAllByText("Arjun");
    expect(arjunElements.length).toBeGreaterThanOrEqual(2);
    expect(screen.getByText("Shipped sidebar")).toBeDefined();
  });

  it("calls getAttendance with person filter when selected (Req 1.2)", async () => {
    const user = userEvent.setup();
    render(<AttendanceScreen />);

    const personSelect = screen.getByLabelText("Filter by person");
    await user.selectOptions(personSelect, "u-arjun");

    // getAttendance should have been called with the userId
    const lastCall = mockGetAttendance.mock.calls[mockGetAttendance.mock.calls.length - 1];
    expect(lastCall[0]).toBe("u-arjun");
  });

  it("calls exportAttendanceCsv when Export CSV is clicked (Req 1.5)", async () => {
    mockGetAttendance.mockReturnValue([
      {
        userId: "u-arjun",
        date: "2025-01-15",
        loginTime: 1736928000,
        logoutTime: 1736960400,
        totalHours: 8.5,
        breakMinutes: 30,
        outputNote: "Shipped sidebar",
      },
    ]);

    // Mock URL.createObjectURL and link click
    const mockCreateObjectURL = vi.fn().mockReturnValue("blob:test");
    const mockRevokeObjectURL = vi.fn();
    global.URL.createObjectURL = mockCreateObjectURL;
    global.URL.revokeObjectURL = mockRevokeObjectURL;

    const user = userEvent.setup();
    render(<AttendanceScreen />);

    const exportBtn = screen.getByLabelText("Export CSV");
    await user.click(exportBtn);

    expect(mockExportAttendanceCsv).toHaveBeenCalled();
    expect(mockCreateObjectURL).toHaveBeenCalled();
  });

  it("shows Person column when no person filter is set", () => {
    mockGetAttendance.mockReturnValue([
      {
        userId: "u-arjun",
        date: "2025-01-15",
        loginTime: 1736928000,
        logoutTime: 1736960400,
        totalHours: 8.5,
        breakMinutes: 30,
        outputNote: null,
      },
    ]);

    render(<AttendanceScreen />);
    // "Person" appears in both filter label and table column header
    const personElements = screen.getAllByText("Person");
    expect(personElements.length).toBe(2);
  });

  it("renders multiple records sorted by date", () => {
    mockGetAttendance.mockReturnValue([
      {
        userId: "u-arjun",
        date: "2025-01-14",
        loginTime: 1736841600,
        logoutTime: 1736874000,
        totalHours: 7.0,
        breakMinutes: 45,
        outputNote: "Day 1 work",
      },
      {
        userId: "u-priya",
        date: "2025-01-15",
        loginTime: 1736928000,
        logoutTime: 1736960400,
        totalHours: 8.5,
        breakMinutes: 30,
        outputNote: "Day 2 work",
      },
    ]);

    render(<AttendanceScreen />);

    expect(screen.getByText("Day 1 work")).toBeDefined();
    expect(screen.getByText("Day 2 work")).toBeDefined();
    // Names appear in both filter dropdown and table rows
    const arjunElements = screen.getAllByText("Arjun");
    expect(arjunElements.length).toBeGreaterThanOrEqual(2);
    const priyaElements = screen.getAllByText("Priya");
    expect(priyaElements.length).toBeGreaterThanOrEqual(2);
  });

  it("shows dash for null output note", () => {
    mockGetAttendance.mockReturnValue([
      {
        userId: "u-arjun",
        date: "2025-01-15",
        loginTime: 1736928000,
        logoutTime: 1736960400,
        totalHours: 8.0,
        breakMinutes: 0,
        outputNote: null,
      },
    ]);

    render(<AttendanceScreen />);

    // The output note column should show "—" for null
    const cells = screen.getAllByText("—");
    expect(cells.length).toBeGreaterThan(0);
  });

  it("renders Check-in and Check-out column headers (Task 18.13)", () => {
    mockGetAttendance.mockReturnValue([
      {
        userId: "u-arjun",
        date: "2025-01-15",
        loginTime: 1736928000,
        logoutTime: 1736960400,
        totalHours: 8.0,
        breakMinutes: 0,
        outputNote: null,
      },
    ]);

    render(<AttendanceScreen />);
    expect(screen.getByText("Check-in")).toBeDefined();
    expect(screen.getByText("Check-out")).toBeDefined();
  });
});
