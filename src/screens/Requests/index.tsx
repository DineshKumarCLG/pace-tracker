/**
 * Request/Approval Screen — List pending leave requests with approve/decline actions.
 *
 * - Shows all pending leave requests from team members
 * - Each request card: requester name, type, dates, reason
 * - Approve / Decline buttons on each request
 * - Decline requires a reason input (inline)
 * - Hide approve/decline on requests submitted by the current user (Req 7.4)
 * - On decline: send OS notification to requester with decline reason (Req 7.3)
 *
 * Requirements: 7.1, 7.2, 7.3, 7.4
 */

import { useState, useMemo } from "react";
import { ClipboardCheck, Check, X, Clock, AlertCircle } from "lucide-react";
import { cn } from "@/lib/utils";
import Button from "@/components/ui/Button";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { useLeaveStore } from "@/stores/leaveStore";
import { useAuthStore } from "@/stores/authStore";
import { useTeamStore } from "@/stores/teamStore";
import { isTauri } from "@/lib/tauri";
import type { LeaveRequest } from "@/types";

/** Format a UTC timestamp to a readable date string. */
function formatDate(ts: number): string {
  return new Date(ts * 1000).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Human-readable leave type label. */
function typeLabel(type: LeaveRequest["type"]): string {
  switch (type) {
    case "annual":
      return "Annual Leave";
    case "sick":
      return "Sick Leave";
    case "wfh":
      return "Work From Home";
  }
}

/** Badge variant for leave type. */
function typeBadgeVariant(type: LeaveRequest["type"]): "default" | "danger" | "warning" {
  switch (type) {
    case "annual":
      return "default";
    case "sick":
      return "danger";
    case "wfh":
      return "warning";
  }
}

/** Badge variant for request status. */
function statusBadgeVariant(
  status: LeaveRequest["status"],
): "warning" | "success" | "danger" {
  switch (status) {
    case "pending":
      return "warning";
    case "approved":
      return "success";
    case "declined":
      return "danger";
  }
}

/** Send OS notification to the requester on decline. */
async function sendDeclineNotification(
  _requesterName: string,
  reason: string,
): Promise<void> {
  if (!isTauri()) return;
  try {
    const { sendNotification, isPermissionGranted, requestPermission } =
      await import("@tauri-apps/plugin-notification");
    let granted = await isPermissionGranted();
    if (!granted) {
      const perm = await requestPermission();
      granted = perm === "granted";
    }
    if (granted) {
      sendNotification({
        title: "Leave Request Declined",
        body: `Your leave request was declined. Reason: ${reason}`,
      });
    }
  } catch {
    // Notification unavailable — silently ignore
  }
}

type TabFilter = "pending" | "all";

export default function RequestsScreen() {
  const [tab, setTab] = useState<TabFilter>("pending");
  const [decliningId, setDecliningId] = useState<string | null>(null);
  const [declineReason, setDeclineReason] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);
  const [loadingAction, setLoadingAction] = useState<string | null>(null);

  const requests = useLeaveStore((s) => s.requests);
  const approveRequest = useLeaveStore((s) => s.approveRequest);
  const declineRequest = useLeaveStore((s) => s.declineRequest);
  const currentUser = useAuthStore((s) => s.user);
  const members = useTeamStore((s) => s.members);

  /** Resolve requester name from team members or fallback. */
  function getRequesterName(requesterId: string): string {
    const member = members[requesterId];
    if (member) return member.name;
    if (currentUser && currentUser.id === requesterId) return currentUser.name;
    return "Unknown";
  }

  /** Filtered and sorted requests. */
  const filteredRequests = useMemo(() => {
    const list =
      tab === "pending"
        ? requests.filter((r) => r.status === "pending")
        : [...requests];
    // Sort by createdAt descending (newest first)
    return list.sort((a, b) => b.createdAt - a.createdAt);
  }, [requests, tab]);

  /** Handle approve action. */
  async function handleApprove(requestId: string) {
    setActionError(null);
    setLoadingAction(requestId);
    try {
      await approveRequest(requestId);
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : "Failed to approve request",
      );
    } finally {
      setLoadingAction(null);
    }
  }

  /** Handle decline action. */
  async function handleDecline(requestId: string) {
    if (!declineReason.trim()) {
      setActionError("A reason is required when declining a request");
      return;
    }

    const request = requests.find((r) => r.id === requestId);
    setActionError(null);
    setLoadingAction(requestId);
    try {
      await declineRequest(requestId, declineReason.trim());

      // Send OS notification to requester (Req 7.3)
      if (request) {
        const name = getRequesterName(request.requesterId);
        await sendDeclineNotification(name, declineReason.trim());
      }

      setDecliningId(null);
      setDeclineReason("");
    } catch (err: unknown) {
      setActionError(
        err instanceof Error ? err.message : "Failed to decline request",
      );
    } finally {
      setLoadingAction(null);
    }
  }

  /** Cancel decline mode. */
  function cancelDecline() {
    setDecliningId(null);
    setDeclineReason("");
    setActionError(null);
  }

  const pendingCount = requests.filter((r) => r.status === "pending").length;

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-4 px-5 py-5 pb-10">
        {/* Header */}
        <div className="mb-1">
          <h1 className="text-[22px] font-bold tracking-tight leading-tight">
            Requests
          </h1>
          <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
            Review and manage leave requests
          </p>
        </div>

        {/* Tab filter */}
        <div className="flex gap-2">
          <button
            onClick={() => setTab("pending")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
              tab === "pending"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
            )}
          >
            <Clock className="h-3.5 w-3.5" />
            Pending
            {pendingCount > 0 && (
              <span className="ml-1 flex h-4 min-w-[16px] items-center justify-center rounded-full bg-primary/20 px-1 text-[10px] font-bold text-primary">
                {pendingCount}
              </span>
            )}
          </button>
          <button
            onClick={() => setTab("all")}
            className={cn(
              "flex items-center gap-1.5 rounded-lg px-3 py-1.5 text-[12px] font-semibold transition-colors",
              tab === "all"
                ? "bg-primary/10 text-primary"
                : "text-muted-foreground hover:text-foreground hover:bg-accent/40",
            )}
          >
            <ClipboardCheck className="h-3.5 w-3.5" />
            All Requests
          </button>
        </div>

        {/* Error banner */}
        {actionError && (
          <div className="flex items-center gap-2 rounded-lg bg-destructive/10 border border-destructive/20 px-3 py-2 text-[12px] text-destructive">
            <AlertCircle className="h-3.5 w-3.5 shrink-0" />
            {actionError}
          </div>
        )}

        {/* Request list */}
        {filteredRequests.length === 0 ? (
          <div className="glass noise rounded-xl px-6 py-12 text-center">
            <ClipboardCheck className="mx-auto h-8 w-8 text-muted-foreground/40 mb-3" />
            <p className="text-[14px] font-medium text-muted-foreground">
              {tab === "pending"
                ? "No pending requests"
                : "No requests found"}
            </p>
            <p className="text-[12px] text-muted-foreground/60 mt-1">
              {tab === "pending"
                ? "All leave requests have been reviewed"
                : "No leave requests have been submitted yet"}
            </p>
          </div>
        ) : (
          <div className="space-y-3">
            {filteredRequests.map((request) => {
              const isOwnRequest =
                currentUser !== null &&
                request.requesterId === currentUser.id;
              const isDeclineMode = decliningId === request.id;
              const isLoading = loadingAction === request.id;

              return (
                <div
                  key={request.id}
                  className="glass noise rounded-xl p-4 space-y-3"
                  data-testid={`request-card-${request.id}`}
                >
                  {/* Top row: requester + badges */}
                  <div className="flex items-start justify-between gap-3">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <div
                        className="flex h-7 w-7 items-center justify-center rounded-full text-[10px] font-bold shrink-0"
                        style={{
                          background: `linear-gradient(135deg, ${members[request.requesterId]?.avatarColor ?? "#6e6af6"} 0%, ${members[request.requesterId]?.avatarColor ?? "#6e6af6"}cc 100%)`,
                          color: "hsl(30 20% 8%)",
                        }}
                      >
                        {getRequesterName(request.requesterId)
                          .charAt(0)
                          .toUpperCase()}
                      </div>
                      <div className="min-w-0">
                        <div className="text-[13px] font-semibold truncate">
                          {getRequesterName(request.requesterId)}
                        </div>
                        <div className="text-[11px] text-muted-foreground">
                          {formatDate(request.createdAt)}
                        </div>
                      </div>
                    </div>
                    <div className="flex items-center gap-1.5 shrink-0">
                      <Badge variant={typeBadgeVariant(request.type)} size="sm">
                        {typeLabel(request.type)}
                      </Badge>
                      <Badge
                        variant={statusBadgeVariant(request.status)}
                        size="sm"
                      >
                        {request.status.charAt(0).toUpperCase() +
                          request.status.slice(1)}
                      </Badge>
                    </div>
                  </div>

                  {/* Dates */}
                  <div className="text-[12px] text-muted-foreground">
                    <span className="font-medium text-foreground">
                      {formatDate(request.startDate)}
                    </span>
                    {" → "}
                    <span className="font-medium text-foreground">
                      {formatDate(request.endDate)}
                    </span>
                  </div>

                  {/* Reason */}
                  {request.reason && (
                    <div className="text-[12px] text-muted-foreground">
                      <span className="font-medium">Reason:</span>{" "}
                      {request.reason}
                    </div>
                  )}

                  {/* Decline reason (for already-declined requests) */}
                  {request.status === "declined" && request.reviewReason && (
                    <div className="text-[12px] text-destructive/80 bg-destructive/5 rounded-lg px-3 py-2">
                      <span className="font-medium">Decline reason:</span>{" "}
                      {request.reviewReason}
                    </div>
                  )}

                  {/* Actions — only for pending requests, hidden for own requests (Req 7.4) */}
                  {request.status === "pending" && !isOwnRequest && (
                    <div className="pt-1">
                      {isDeclineMode ? (
                        <div className="space-y-2">
                          <label
                            htmlFor={`decline-reason-${request.id}`}
                            className="text-[11px] font-semibold text-muted-foreground"
                          >
                            Reason for declining
                          </label>
                          <Input
                            id={`decline-reason-${request.id}`}
                            inputSize="sm"
                            placeholder="Enter reason for declining..."
                            value={declineReason}
                            onChange={(e) => setDeclineReason(e.target.value)}
                            aria-label="Decline reason"
                          />
                          <div className="flex gap-2">
                            <Button
                              variant="danger"
                              size="sm"
                              disabled={isLoading || !declineReason.trim()}
                              onClick={() => handleDecline(request.id)}
                            >
                              {isLoading ? "Declining..." : "Confirm Decline"}
                            </Button>
                            <Button
                              variant="ghost"
                              size="sm"
                              onClick={cancelDecline}
                              disabled={isLoading}
                            >
                              Cancel
                            </Button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex gap-2">
                          <Button
                            variant="primary"
                            size="sm"
                            disabled={isLoading}
                            onClick={() => handleApprove(request.id)}
                          >
                            <Check className="h-3.5 w-3.5" />
                            {isLoading ? "Approving..." : "Approve"}
                          </Button>
                          <Button
                            variant="danger"
                            size="sm"
                            disabled={isLoading}
                            onClick={() => {
                              setDecliningId(request.id);
                              setDeclineReason("");
                              setActionError(null);
                            }}
                          >
                            <X className="h-3.5 w-3.5" />
                            Decline
                          </Button>
                        </div>
                      )}
                    </div>
                  )}

                  {/* Own request indicator */}
                  {request.status === "pending" && isOwnRequest && (
                    <div className="text-[11px] text-muted-foreground/60 italic">
                      Your request — awaiting review from another team member
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
