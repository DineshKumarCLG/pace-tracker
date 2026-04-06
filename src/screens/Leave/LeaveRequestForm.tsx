/**
 * Leave Request Form — Modal for submitting leave/WFH requests.
 *
 * Fields: type (annual/sick/wfh), start date, end date, reason
 * Shows balance validation and remaining balance on rejection.
 * Sends OS notification to other founders on submission.
 * Sick leave auto-approves immediately.
 *
 * Requirements: 6.1, 6.2, 6.3, 6.4, 6.5
 */

import { useState, useMemo, useCallback, useEffect, useRef } from "react";
import { X, CalendarDays, Send, AlertTriangle, Info, Lightbulb, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "@/components/ui/Button";
import Input from "@/components/ui/Input";
import Badge from "@/components/ui/Badge";
import { useLeaveStore } from "@/stores/leaveStore";
import { useAuthStore } from "@/stores/authStore";
import { validateLeaveRequest } from "@/lib/leave";
import { getSmartLeaveSuggestions } from "@/lib/ai";
import type { SmartLeaveResponse } from "@/lib/ai";
import { isTauri } from "@/lib/tauri";
import type { ValidationResult } from "@/types";

type LeaveType = "annual" | "sick" | "wfh";

interface LeaveRequestFormProps {
  open: boolean;
  onClose: () => void;
}

const TYPE_OPTIONS: { value: LeaveType; label: string; description: string }[] = [
  { value: "annual", label: "Annual Leave", description: "Deducted from annual balance" },
  { value: "sick", label: "Sick Leave", description: "Auto-approved immediately" },
  { value: "wfh", label: "Work From Home", description: "No balance impact" },
];

/** Convert a Date to a UTC midnight timestamp (seconds). */
function dateToTimestamp(dateStr: string): number {
  const [y, m, d] = dateStr.split("-").map(Number);
  return Date.UTC(y, m - 1, d) / 1000;
}

/** Get today's date as YYYY-MM-DD. */
function todayStr(): string {
  const d = new Date();
  const y = d.getFullYear();
  const m = String(d.getMonth() + 1).padStart(2, "0");
  const day = String(d.getDate()).padStart(2, "0");
  return `${y}-${m}-${day}`;
}


/** Send OS notification to other founders about a leave request. Req 6.4 */
async function notifyOtherFounders(
  requesterName: string,
  leaveType: LeaveType,
  startDate: string,
  endDate: string,
): Promise<void> {
  if (!isTauri()) return;

  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");

    let ok = await isPermissionGranted();
    if (!ok) ok = (await requestPermission()) === "granted";

    if (ok) {
      const typeLabel =
        leaveType === "annual" ? "Annual Leave" :
        leaveType === "sick" ? "Sick Leave" : "WFH";

      sendNotification({
        title: "PACE — Leave Request",
        body: `${requesterName} submitted a ${typeLabel} request (${startDate} → ${endDate})`,
      });
    }
  } catch {
    // Notification unavailable — non-blocking
  }
}

export default function LeaveRequestForm({ open, onClose }: LeaveRequestFormProps) {
  const [leaveType, setLeaveType] = useState<LeaveType>("annual");
  const [startDate, setStartDate] = useState(todayStr());
  const [endDate, setEndDate] = useState(todayStr());
  const [reason, setReason] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [success, setSuccess] = useState(false);
  const [smartLeave, setSmartLeave] = useState<SmartLeaveResponse | null>(null);
  const [smartLeaveLoading, setSmartLeaveLoading] = useState(false);

  const dialogRef = useRef<HTMLDivElement>(null);

  const submitRequest = useLeaveStore((s) => s.submitRequest);
  const requests = useLeaveStore((s) => s.requests);
  const publicHolidays = useLeaveStore((s) => s.publicHolidays);
  const balances = useLeaveStore((s) => s.balances);
  const user = useAuthStore((s) => s.user);

  // Current user's balance
  const userBalance = user ? balances[user.id] : null;

  // Live validation as user changes fields
  const validation: ValidationResult | null = useMemo(() => {
    if (!user) return null;
    if (!startDate || !endDate) return null;

    const startTs = dateToTimestamp(startDate);
    const endTs = dateToTimestamp(endDate) + 86399; // end of day

    if (startTs >= endTs) return null;

    return validateLeaveRequest(
      user.id,
      leaveType,
      startTs,
      endTs,
      requests,
      publicHolidays,
    );
  }, [user, leaveType, startDate, endDate, requests, publicHolidays]);

  // Reset form when opened
  useEffect(() => {
    if (open) {
      setLeaveType("annual");
      setStartDate(todayStr());
      setEndDate(todayStr());
      setReason("");
      setError(null);
      setSuccess(false);
      setSmartLeave(null);
      setSmartLeaveLoading(false);
    }
  }, [open]);

  // Fetch smart leave suggestions when dates change (Req 21.1, 21.2, 21.3)
  useEffect(() => {
    if (!open || !user || !startDate || !endDate) return;

    const startTs = dateToTimestamp(startDate);
    const endTs = dateToTimestamp(endDate) + 86399;
    if (startTs >= endTs) return;

    let cancelled = false;
    setSmartLeaveLoading(true);

    getSmartLeaveSuggestions(user.id, startTs, endTs).then((result) => {
      if (!cancelled) {
        setSmartLeave(result);
        setSmartLeaveLoading(false);
      }
    });

    return () => { cancelled = true; };
  }, [open, user, startDate, endDate]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === "Escape") onClose();
    }
    window.addEventListener("keydown", handleKey);
    return () => window.removeEventListener("keydown", handleKey);
  }, [open, onClose]);

  const handleSubmit = useCallback(async () => {
    if (!user) return;
    setError(null);

    const startTs = dateToTimestamp(startDate);
    const endTs = dateToTimestamp(endDate) + 86399;

    if (startTs >= endTs) {
      setError("End date must be after start date");
      return;
    }

    // Pre-validate
    const check = validateLeaveRequest(
      user.id,
      leaveType,
      startTs,
      endTs,
      requests,
      publicHolidays,
    );

    if (!check.valid) {
      setError(check.reason ?? "Validation failed");
      return;
    }

    setSubmitting(true);
    try {
      await submitRequest(leaveType, startTs, endTs, reason.trim());
      setSuccess(true);

      // OS notification to other founders (Req 6.4) — only for pending requests
      if (leaveType !== "sick") {
        await notifyOtherFounders(user.name, leaveType, startDate, endDate);
      }

      // Auto-close after brief success display
      setTimeout(() => {
        onClose();
      }, 1200);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to submit request");
    } finally {
      setSubmitting(false);
    }
  }, [user, leaveType, startDate, endDate, reason, submitRequest, requests, publicHolidays, onClose]);

  if (!open) return null;

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
      role="dialog"
      aria-modal="true"
      aria-label="Submit leave request"
    >
      <div
        ref={dialogRef}
        className="glass noise rounded-2xl w-full max-w-md mx-4 shadow-2xl border border-border/30 animate-in fade-in zoom-in-95 duration-200"
      >
        {/* Header */}
        <div className="flex items-center justify-between px-5 pt-5 pb-3">
          <div>
            <h2 className="text-[16px] font-bold tracking-tight">New Leave Request</h2>
            <p className="text-[11px] text-muted-foreground mt-0.5">
              Submit a leave or WFH request
            </p>
          </div>
          <button
            onClick={onClose}
            className="flex h-7 w-7 items-center justify-center rounded-lg text-muted-foreground hover:text-foreground hover:bg-accent/40 transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        <div className="px-5 pb-5 space-y-4">
          {/* Leave Type Selector */}
          <div>
            <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5 block">
              Type
            </label>
            <div className="flex gap-2">
              {TYPE_OPTIONS.map((opt) => (
                <button
                  key={opt.value}
                  onClick={() => setLeaveType(opt.value)}
                  className={cn(
                    "flex-1 rounded-lg px-3 py-2 text-[12px] font-medium transition-all border",
                    leaveType === opt.value
                      ? "bg-primary/15 border-primary/40 text-primary"
                      : "border-border/30 text-muted-foreground hover:border-border/60 hover:text-foreground",
                  )}
                >
                  {opt.label}
                </button>
              ))}
            </div>
            <p className="text-[10px] text-muted-foreground/60 mt-1">
              {TYPE_OPTIONS.find((o) => o.value === leaveType)?.description}
            </p>
          </div>

          {/* Date Fields */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label
                htmlFor="leave-start"
                className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5 block"
              >
                Start Date
              </label>
              <Input
                id="leave-start"
                type="date"
                value={startDate}
                min={todayStr()}
                onChange={(e) => setStartDate(e.target.value)}
                inputSize="sm"
              />
            </div>
            <div>
              <label
                htmlFor="leave-end"
                className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5 block"
              >
                End Date
              </label>
              <Input
                id="leave-end"
                type="date"
                value={endDate}
                min={startDate}
                onChange={(e) => setEndDate(e.target.value)}
                inputSize="sm"
              />
            </div>
          </div>

          {/* Reason */}
          <div>
            <label
              htmlFor="leave-reason"
              className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 mb-1.5 block"
            >
              Reason
            </label>
            <textarea
              id="leave-reason"
              value={reason}
              onChange={(e) => setReason(e.target.value)}
              placeholder="Brief reason for your request..."
              rows={2}
              className="w-full rounded-lg inset-well text-foreground placeholder:text-muted-foreground/40 focus:outline-none focus-visible:ring-2 focus-visible:ring-ring/30 px-3.5 py-2.5 text-[13px] resize-none"
            />
          </div>

          {/* Balance Display */}
          {leaveType === "annual" && userBalance && (
            <BalanceDisplay
              remaining={userBalance.annualRemaining}
              allocated={userBalance.annualAllocated}
              used={userBalance.annualUsed}
              requestedDays={validation?.requestedDays}
              valid={validation?.valid ?? true}
            />
          )}
          {leaveType === "sick" && userBalance && (
            <BalanceDisplay
              remaining={userBalance.sickRemaining}
              allocated={userBalance.sickAllocated}
              used={userBalance.sickUsed}
              requestedDays={validation?.requestedDays}
              valid={true}
              label="Sick"
            />
          )}

          {/* Smart Leave Suggestions (Req 21.1, 21.2, 21.3) */}
          {smartLeaveLoading && (
            <div className="flex items-center gap-2 rounded-lg bg-primary/5 border border-primary/20 px-3 py-2">
              <Loader2 className="h-3.5 w-3.5 text-primary animate-spin" />
              <span className="text-[11px] text-muted-foreground">Checking for scheduling conflicts...</span>
            </div>
          )}
          {smartLeave && smartLeave.conflicts.length > 0 && (
            <div className="rounded-lg border border-amber-500/30 bg-amber-500/5 px-3 py-2.5 space-y-2">
              <div className="flex items-center gap-1.5">
                <Info className="h-3.5 w-3.5 text-amber-400" />
                <span className="text-[11px] font-semibold text-amber-400">Scheduling Conflicts (advisory)</span>
              </div>
              <ul className="space-y-1">
                {smartLeave.conflicts.map((c, i) => (
                  <li key={i} className="text-[11px] text-muted-foreground flex items-start gap-1.5">
                    <span className="text-amber-400/60 mt-0.5">•</span>
                    {c.description}
                  </li>
                ))}
              </ul>
              {smartLeave.aiSuggestions && smartLeave.aiSuggestions.length > 0 && (
                <div className="pt-1.5 border-t border-amber-500/15">
                  <div className="flex items-center gap-1.5 mb-1">
                    <Lightbulb className="h-3 w-3 text-primary" />
                    <span className="text-[10px] font-semibold text-primary">Suggested alternatives</span>
                  </div>
                  {smartLeave.aiSuggestions.map((s, i) => {
                    const sd = new Date(s.startDate * 1000).toISOString().split("T")[0];
                    const ed = new Date(s.endDate * 1000).toISOString().split("T")[0];
                    return (
                      <div key={i} className="text-[10px] text-muted-foreground ml-4">
                        {sd} → {ed}{s.reason ? ` — ${s.reason}` : ""}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>
          )}

          {/* Validation info */}
          {validation && !validation.valid && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <div>
                <p className="text-[12px] font-medium text-destructive">{validation.reason}</p>
                {validation.remainingBalance !== undefined && (
                  <p className="text-[11px] text-destructive/70 mt-0.5">
                    Remaining balance: {validation.remainingBalance} days
                  </p>
                )}
              </div>
            </div>
          )}

          {/* Sick leave auto-approve notice */}
          {leaveType === "sick" && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2">
              <Badge variant="success" size="sm">Auto-approved</Badge>
              <span className="text-[11px] text-muted-foreground">
                Sick leave is approved immediately
              </span>
            </div>
          )}

          {/* Error */}
          {error && !validation?.reason && (
            <div className="flex items-start gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2.5">
              <AlertTriangle className="h-4 w-4 text-destructive shrink-0 mt-0.5" />
              <p className="text-[12px] font-medium text-destructive">{error}</p>
            </div>
          )}

          {/* Success */}
          {success && (
            <div className="flex items-center gap-2 rounded-lg bg-emerald-500/10 border border-emerald-500/20 px-3 py-2.5">
              <CalendarDays className="h-4 w-4 text-emerald-400" />
              <p className="text-[12px] font-medium text-emerald-400">
                Request submitted{leaveType === "sick" ? " and approved" : ""}!
              </p>
            </div>
          )}

          {/* Submit */}
          <div className="flex justify-end gap-2 pt-1">
            <Button variant="ghost" size="sm" onClick={onClose} disabled={submitting}>
              Cancel
            </Button>
            <Button
              variant="primary"
              size="sm"
              onClick={handleSubmit}
              disabled={submitting || success || (validation !== null && !validation.valid)}
            >
              <Send className="h-3.5 w-3.5" />
              {submitting ? "Submitting..." : "Submit Request"}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}

/* ── Balance Display Sub-component ── */

function BalanceDisplay({
  remaining,
  allocated,
  used,
  requestedDays,
  valid,
  label = "Annual",
}: {
  remaining: number;
  allocated: number;
  used: number;
  requestedDays?: number;
  valid: boolean;
  label?: string;
}) {
  return (
    <div className={cn(
      "rounded-lg border px-3 py-2.5",
      valid ? "border-border/30 bg-card/30" : "border-destructive/30 bg-destructive/5",
    )}>
      <div className="flex items-center justify-between mb-1.5">
        <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
          {label} Leave Balance
        </span>
        <span className={cn(
          "text-[14px] font-bold",
          valid ? "text-foreground" : "text-destructive",
        )}>
          {remaining}
          <span className="text-[11px] font-normal text-muted-foreground"> / {allocated}</span>
        </span>
      </div>
      {/* Progress bar */}
      <div className="h-1.5 rounded-full bg-border/30 overflow-hidden">
        <div
          className={cn(
            "h-full rounded-full transition-all",
            valid ? "bg-primary/60" : "bg-destructive/60",
          )}
          style={{ width: `${Math.min((used / allocated) * 100, 100)}%` }}
        />
      </div>
      <div className="flex justify-between mt-1">
        <span className="text-[10px] text-muted-foreground">{used} used</span>
        {requestedDays !== undefined && requestedDays > 0 && (
          <span className={cn(
            "text-[10px] font-medium",
            valid ? "text-primary" : "text-destructive",
          )}>
            Requesting {requestedDays} day{requestedDays !== 1 ? "s" : ""}
          </span>
        )}
      </div>
    </div>
  );
}
