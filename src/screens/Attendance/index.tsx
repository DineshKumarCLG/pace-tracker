/**
 * Attendance Log Screen — Calendar view of daily attendance records.
 *
 * One row per day, columns: date, login time, logout time, total hours,
 * break duration, output note.
 * Filters: person, date range, project.
 * Export CSV button downloads filtered records.
 * Empty state when no records match filters.
 *
 * Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 18.13
 */

import { useState, useMemo, useCallback } from "react";
import { Download, Calendar, Clock, Coffee, FileText, Search, Camera } from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { useTeamStore } from "@/stores/teamStore";
import { useWorkspaceProofStore } from "@/stores/workspaceProofStore";
import { getAttendance, exportAttendanceCsv } from "@/lib/attendance";
import { getProofsForAttendanceRow, getProofLocationLabel } from "@/lib/proofIntegration";
import { getVerificationLabel } from "@/lib/workspaceProof";
import ProofDetailModal from "@/components/ProofDetailModal";
import type { AttendanceRecord, Session, Break, WorkspaceProof } from "@/types";
import { useProjects } from "@/queries/projects";

/* ── Helpers ── */

/** Format a UTC timestamp to a readable time string (HH:MM). */
function formatTime(timestamp: number | null): string {
  if (timestamp === null) return "—";
  const d = new Date(timestamp * 1000);
  return d.toLocaleTimeString("en", { hour: "2-digit", minute: "2-digit", hour12: false });
}

/** Format hours as Xh Ym. */
function formatHours(hours: number): string {
  if (hours === 0) return "—";
  const h = Math.floor(hours);
  const m = Math.round((hours - h) * 60);
  if (h === 0) return `${m}m`;
  if (m === 0) return `${h}h`;
  return `${h}h ${m}m`;
}

/** Format break minutes. */
function formatBreakMinutes(minutes: number): string {
  if (minutes === 0) return "—";
  return `${Math.round(minutes)}m`;
}

/** Get today's date as YYYY-MM-DD. */
function todayStr(): string {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Get date 30 days ago as YYYY-MM-DD. */
function thirtyDaysAgoStr(): string {
  const d = new Date();
  d.setDate(d.getDate() - 30);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
}

/** Format a YYYY-MM-DD date for display. */
function formatDate(dateStr: string): string {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const dayName = date.toLocaleDateString("en", { weekday: "short" });
  const monthName = date.toLocaleDateString("en", { month: "short" });
  return `${dayName}, ${d} ${monthName} ${y}`;
}

/** Get day of week class for weekend highlighting. */
function isWeekend(dateStr: string): boolean {
  const [y, m, d] = dateStr.split("-").map(Number);
  const date = new Date(y, m - 1, d);
  const day = date.getDay();
  return day === 0 || day === 6;
}

/* ── Mock data provider ── */
// In production, sessions/breaks come from SQLite via Tauri IPC.
// For now, we use the store and compute attendance client-side.

function useMockSessions(): { sessions: Session[]; breaksBySessionId: Record<string, Break[]> } {
  // Return empty arrays — real data comes from Rust commands
  return { sessions: [], breaksBySessionId: {} };
}

/* ── Component ── */

export default function AttendanceScreen() {
  const [personFilter, setPersonFilter] = useState<string | null>(null);
  const [startDate, setStartDate] = useState(thirtyDaysAgoStr);
  const [endDate, setEndDate] = useState(todayStr);
  const [projectFilter, setProjectFilter] = useState<string | null>(null);
  const [selectedProof, setSelectedProof] = useState<WorkspaceProof | null>(null);

  const members = useTeamStore((s) => s.members);
  const memberList = useMemo(() => Object.values(members), [members]);
  const { data: projects } = useProjects();

  const { sessions, breaksBySessionId } = useMockSessions();

  /* Workspace proofs and location names (Task 18.13) */
  const sessionProofs = useWorkspaceProofStore((s) => s.sessionProofs);
  const savedLocations = useWorkspaceProofStore((s) => s.savedLocations);
  const locationNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const loc of savedLocations) {
      map[loc.id] = loc.name;
    }
    return map;
  }, [savedLocations]);

  /* Compute attendance records with filters (Req 1.1, 1.2, 1.3, 1.4) */
  const records: AttendanceRecord[] = useMemo(() => {
    // Build project session IDs set if project filter is active
    let projectSessionIds: Set<string> | undefined;
    if (projectFilter) {
      // In production, this would query session_tasks joined with tasks
      // For now, pass undefined (no project filtering on mock data)
      projectSessionIds = undefined;
    }

    return getAttendance(
      personFilter,
      startDate,
      endDate,
      sessions,
      breaksBySessionId,
      projectSessionIds,
    );
  }, [personFilter, startDate, endDate, sessions, breaksBySessionId, projectFilter]);

  /* Build user name lookup */
  const userNames = useMemo(() => {
    const map: Record<string, string> = {};
    for (const m of memberList) {
      map[m.userId] = m.name;
    }
    return map;
  }, [memberList]);

  /* Export CSV handler (Req 1.5) */
  const handleExportCsv = useCallback(() => {
    const csv = exportAttendanceCsv(records, userNames);
    const blob = new Blob([csv], { type: "text/csv;charset=utf-8;" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = `attendance_${startDate}_${endDate}.csv`;
    link.click();
    URL.revokeObjectURL(url);
  }, [records, userNames, startDate, endDate]);

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-4 px-5 py-5 pb-10">
        {/* Header */}
        <div className="mb-1 flex items-center justify-between">
          <div>
            <h1 className="text-[22px] font-bold tracking-tight leading-tight">Attendance</h1>
            <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
              Daily login/logout history and work hours
            </p>
          </div>
          <Button
            variant="primary"
            size="sm"
            onClick={handleExportCsv}
            disabled={records.length === 0}
            aria-label="Export CSV"
          >
            <Download className="h-3.5 w-3.5" />
            Export CSV
          </Button>
        </div>

        {/* Filters */}
        <div className="glass noise rounded-xl p-4">
          <div className="flex flex-wrap items-end gap-3">
            {/* Person filter (Req 1.2) */}
            <div className="min-w-[160px]">
              <label htmlFor="person-filter" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1 block">
                Person
              </label>
              <select
                id="person-filter"
                value={personFilter ?? ""}
                onChange={(e) => setPersonFilter(e.target.value || null)}
                className="w-full rounded-lg inset-well text-foreground text-[13px] px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                aria-label="Filter by person"
              >
                <option value="">All members</option>
                {memberList.map((m) => (
                  <option key={m.userId} value={m.userId}>
                    {m.name}
                  </option>
                ))}
              </select>
            </div>

            {/* Date range filter (Req 1.3) */}
            <div className="min-w-[140px]">
              <label htmlFor="start-date" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1 block">
                From
              </label>
              <Input
                id="start-date"
                type="date"
                inputSize="sm"
                value={startDate}
                onChange={(e) => setStartDate(e.target.value)}
                aria-label="Start date"
              />
            </div>
            <div className="min-w-[140px]">
              <label htmlFor="end-date" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1 block">
                To
              </label>
              <Input
                id="end-date"
                type="date"
                inputSize="sm"
                value={endDate}
                onChange={(e) => setEndDate(e.target.value)}
                aria-label="End date"
              />
            </div>

            {/* Project filter (Req 1.4) */}
            <div className="min-w-[160px]">
              <label htmlFor="project-filter" className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1 block">
                Project
              </label>
              <select
                id="project-filter"
                value={projectFilter ?? ""}
                onChange={(e) => setProjectFilter(e.target.value || null)}
                className="w-full rounded-lg inset-well text-foreground text-[13px] px-3 py-2 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30"
                aria-label="Filter by project"
              >
                <option value="">All projects</option>
                {(projects ?? []).map((p) => (
                  <option key={p.id} value={p.id}>
                    {p.name}
                  </option>
                ))}
              </select>
            </div>
          </div>
        </div>

        {/* Attendance table (Req 1.1) */}
        {records.length === 0 ? (
          <EmptyState />
        ) : (
          <div className="glass noise rounded-xl overflow-hidden">
            <div className="overflow-x-auto">
              <table className="w-full border-collapse text-[12px]" role="table">
                <thead>
                  <tr>
                    <th className="sticky left-0 z-10 bg-card/90 backdrop-blur-sm px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[180px]">
                      <div className="flex items-center gap-1.5">
                        <Calendar className="h-3 w-3" />
                        Date
                      </div>
                    </th>
                    {!personFilter && (
                      <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[100px]">
                        Person
                      </th>
                    )}
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[80px]">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        Login
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[80px]">
                      <div className="flex items-center gap-1.5">
                        <Clock className="h-3 w-3" />
                        Logout
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[80px]">
                      Hours
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[80px]">
                      <div className="flex items-center gap-1.5">
                        <Coffee className="h-3 w-3" />
                        Breaks
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[200px]">
                      <div className="flex items-center gap-1.5">
                        <FileText className="h-3 w-3" />
                        Output Note
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[130px]">
                      <div className="flex items-center gap-1.5">
                        <Camera className="h-3 w-3" />
                        Check-in
                      </div>
                    </th>
                    <th className="px-4 py-3 text-left text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 min-w-[130px]">
                      <div className="flex items-center gap-1.5">
                        <Camera className="h-3 w-3" />
                        Check-out
                      </div>
                    </th>
                  </tr>
                </thead>
                <tbody>
                  {records.map((record) => (
                    <AttendanceRow
                      key={`${record.userId}-${record.date}`}
                      record={record}
                      userName={userNames[record.userId] ?? record.userId}
                      showPerson={!personFilter}
                      memberColor={members[record.userId]?.avatarColor}
                      proofs={sessionProofs}
                      locationNames={locationNames}
                      onProofClick={setSelectedProof}
                    />
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>

      {/* Proof detail modal (Task 18.13) */}
      {selectedProof && (
        <ProofDetailModal
          proof={selectedProof}
          locationName={getProofLocationLabel(selectedProof, locationNames)}
          onClose={() => setSelectedProof(null)}
        />
      )}
    </div>
  );
}

/* ── Sub-components ── */

function AttendanceRow({
  record,
  userName,
  showPerson,
  memberColor,
  proofs,
  locationNames,
  onProofClick,
}: {
  record: AttendanceRecord;
  userName: string;
  showPerson: boolean;
  memberColor?: string;
  proofs: WorkspaceProof[];
  locationNames: Record<string, string>;
  onProofClick: (proof: WorkspaceProof) => void;
}) {
  const weekend = isWeekend(record.date);
  const { checkin, checkout } = getProofsForAttendanceRow(record.userId, record.date, proofs);

  return (
    <tr
      className={cn(
        "border-t border-border/30 hover:bg-accent/20 transition-colors",
        weekend && "opacity-60",
      )}
    >
      <td className="sticky left-0 z-10 bg-card/90 backdrop-blur-sm px-4 py-2.5">
        <span className="text-[12px] font-medium">{formatDate(record.date)}</span>
      </td>
      {showPerson && (
        <td className="px-4 py-2.5">
          <div className="flex items-center gap-2">
            <div
              className="flex h-5 w-5 items-center justify-center rounded-full text-[9px] font-bold shrink-0"
              style={{
                background: memberColor
                  ? `linear-gradient(135deg, ${memberColor} 0%, ${memberColor}cc 100%)`
                  : "hsl(40 90% 52%)",
                color: "hsl(30 20% 8%)",
              }}
            >
              {userName.charAt(0).toUpperCase()}
            </div>
            <span className="text-[12px] font-medium truncate max-w-[80px]">{userName}</span>
          </div>
        </td>
      )}
      <td className="px-4 py-2.5 text-[12px] tabular-nums">
        {formatTime(record.loginTime)}
      </td>
      <td className="px-4 py-2.5 text-[12px] tabular-nums">
        {formatTime(record.logoutTime)}
      </td>
      <td className="px-4 py-2.5">
        <span className={cn(
          "text-[12px] font-semibold tabular-nums",
          record.totalHours > 10 && "text-amber-400",
          record.totalHours > 0 && record.totalHours <= 10 && "text-emerald-400",
        )}>
          {formatHours(record.totalHours)}
        </span>
      </td>
      <td className="px-4 py-2.5 text-[12px] tabular-nums text-muted-foreground">
        {formatBreakMinutes(record.breakMinutes)}
      </td>
      <td className="px-4 py-2.5">
        <span className="text-[12px] text-muted-foreground truncate block max-w-[300px]">
          {record.outputNote ?? "—"}
        </span>
      </td>
      <td className="px-4 py-2.5">
        <ProofCell proof={checkin} locationNames={locationNames} onClick={onProofClick} />
      </td>
      <td className="px-4 py-2.5">
        <ProofCell proof={checkout} locationNames={locationNames} onClick={onProofClick} />
      </td>
    </tr>
  );
}

/** Proof thumbnail cell for check-in/check-out columns (Task 18.13). */
function ProofCell({
  proof,
  locationNames,
  onClick,
}: {
  proof: WorkspaceProof | null;
  locationNames: Record<string, string>;
  onClick: (proof: WorkspaceProof) => void;
}) {
  if (!proof) {
    return <span className="text-[12px] text-muted-foreground">—</span>;
  }

  const locLabel = getProofLocationLabel(proof, locationNames);
  const verLabel = getVerificationLabel(proof.aiVerified);
  const badgeVariant =
    proof.aiVerified === "yes" ? "success" :
    proof.aiVerified === "no" ? "danger" :
    proof.aiVerified === "pending" ? "muted" : "warning";

  return (
    <button
      onClick={() => onClick(proof)}
      className="flex flex-col items-start gap-0.5 text-left hover:bg-accent/30 rounded-md px-1.5 py-1 -mx-1.5 -my-1 transition-colors cursor-pointer"
      aria-label={`View ${proof.type} proof`}
    >
      <div className="flex items-center gap-1.5">
        <Camera className="h-3 w-3 text-primary shrink-0" />
        <span className="text-[11px] font-medium truncate max-w-[80px]">{locLabel}</span>
      </div>
      <Badge variant={badgeVariant} size="sm">
        {verLabel}
      </Badge>
    </button>
  );
}

/** Empty state when no records match filters (Req 1.6). */
function EmptyState() {
  return (
    <div className="glass noise rounded-xl p-12 text-center" role="status">
      <div className="flex justify-center mb-3">
        <div className="flex h-12 w-12 items-center justify-center rounded-xl bg-muted/30">
          <Search className="h-5 w-5 text-muted-foreground/50" />
        </div>
      </div>
      <h3 className="text-[14px] font-semibold text-foreground mb-1">
        No attendance records
      </h3>
      <p className="text-[12px] text-muted-foreground max-w-[280px] mx-auto">
        No records match the current filters. Try adjusting the date range, person, or project filter.
      </p>
    </div>
  );
}
