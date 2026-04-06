/**
 * Proof Detail Modal — shows full photo, map pin, timestamp, AI verification status.
 *
 * Opened when clicking a proof thumbnail in the Attendance Log.
 *
 * Requirements: Task 18.13
 */

import { X, MapPin, Clock, ShieldCheck, ShieldAlert, ShieldQuestion, Camera } from "lucide-react";
import Badge from "@/components/ui/Badge";
import { cn } from "@/lib/utils";
import type { WorkspaceProof } from "@/types";
import { getVerificationLabel } from "@/lib/workspaceProof";

interface ProofDetailModalProps {
  proof: WorkspaceProof;
  locationName: string;
  onClose: () => void;
}

function formatTimestamp(ts: number): string {
  const d = new Date(ts * 1000);
  return d.toLocaleString("en", {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  });
}

function getVerificationBadgeVariant(
  status: WorkspaceProof["aiVerified"],
): "success" | "warning" | "danger" | "muted" {
  switch (status) {
    case "yes": return "success";
    case "no": return "danger";
    case "pending": return "muted";
    case "unavailable": return "warning";
  }
}

function getVerificationIcon(status: WorkspaceProof["aiVerified"]) {
  switch (status) {
    case "yes": return <ShieldCheck className="h-4 w-4 text-emerald-400" />;
    case "no": return <ShieldAlert className="h-4 w-4 text-rose-400" />;
    case "pending": return <ShieldQuestion className="h-4 w-4 text-muted-foreground" />;
    case "unavailable": return <ShieldQuestion className="h-4 w-4 text-amber-400" />;
  }
}

export default function ProofDetailModal({ proof, locationName, onClose }: ProofDetailModalProps) {
  const typeLabel = proof.type === "checkin" ? "Check-in" : "Check-out";

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label={`${typeLabel} proof detail`}
    >
      <div
        className="w-full max-w-md rounded-xl border border-border bg-card p-5 shadow-lg"
        onClick={(e) => e.stopPropagation()}
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-4">
          <h2 className="text-[15px] font-semibold text-foreground">
            {typeLabel} Proof — {formatTimestamp(proof.createdAt)}
          </h2>
          <button
            onClick={onClose}
            className="rounded-md p-1 text-muted-foreground hover:bg-accent hover:text-foreground transition-colors"
            aria-label="Close"
          >
            <X className="h-4 w-4" />
          </button>
        </div>

        {/* Photo */}
        <div className="rounded-lg overflow-hidden border border-border bg-muted/30 mb-4">
          <div className="flex items-center justify-center h-[200px]">
            <div className="flex flex-col items-center gap-2 text-muted-foreground">
              <Camera className="h-8 w-8" />
              <span className="text-[11px]">{proof.photoPath}</span>
            </div>
          </div>
        </div>

        {/* Details */}
        <div className="space-y-3">
          {/* Location */}
          <div className="flex items-center gap-2 text-[13px]">
            <MapPin className="h-4 w-4 text-primary shrink-0" />
            <span className="font-medium">{locationName}</span>
            {proof.lat !== null && proof.lng !== null && (
              <span className="text-muted-foreground text-[11px]">
                ({proof.lat.toFixed(4)}°, {proof.lng.toFixed(4)}°)
              </span>
            )}
            {proof.accuracy !== null && (
              <span className="text-muted-foreground text-[11px]">
                ±{Math.round(proof.accuracy)}m
              </span>
            )}
          </div>

          {/* Timestamp */}
          <div className="flex items-center gap-2 text-[13px]">
            <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
            <span>Captured: {formatTimestamp(proof.createdAt)}</span>
          </div>

          {/* EXIF timestamp */}
          {proof.exifTimestamp && (
            <div className="flex items-center gap-2 text-[13px]">
              <Clock className="h-4 w-4 text-muted-foreground shrink-0" />
              <span>EXIF: {formatTimestamp(proof.exifTimestamp)}</span>
            </div>
          )}

          {/* AI Verification */}
          <div className="flex items-center gap-2 text-[13px]">
            {getVerificationIcon(proof.aiVerified)}
            <span className="font-medium">AI Verification:</span>
            <Badge variant={getVerificationBadgeVariant(proof.aiVerified)} size="sm">
              {getVerificationLabel(proof.aiVerified)}
            </Badge>
          </div>

          {/* AI Reason */}
          {proof.aiReason && (
            <div className={cn(
              "rounded-md px-3 py-2 text-[12px]",
              proof.aiVerified === "yes" ? "bg-emerald-500/10 text-emerald-400" : "bg-amber-500/10 text-amber-400",
            )}>
              "{proof.aiReason}"
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
