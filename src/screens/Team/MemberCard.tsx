import { useState, useEffect } from "react";
import { ArrowRightLeft, Coffee, Flame, Moon } from "lucide-react";
import { cn } from "@/lib/utils";
import type { TeamMember, TeamMemberStatus } from "@/types";
import { getStatusLabel } from "@/stores/teamStore";
import StatusDot from "@/components/StatusDot";
import ActivityBar, { type ActivitySegment } from "./ActivityBar";

const badgeStyles: Record<TeamMemberStatus, string> = {
  active: "bg-indigo-500/15 text-indigo-300 border-indigo-500/20",
  on_break: "bg-amber-500/15 text-amber-300 border-amber-500/20",
  away: "bg-gray-500/15 text-gray-400 border-gray-500/20",
  offline: "bg-muted/50 text-muted-foreground border-border/40",
};

function useLiveTimer(startTime: number | null, active: boolean): string {
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));
  useEffect(() => {
    if (!active || !startTime) return;
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, [active, startTime]);
  if (!startTime) return "";
  const elapsed = Math.max(0, now - startTime);
  const h = Math.floor(elapsed / 3600);
  const m = Math.floor((elapsed % 3600) / 60);
  const s = elapsed % 60;
  return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}:${String(s).padStart(2, "0")}`;
}

function getMockSegments(member: TeamMember): ActivitySegment[] {
  if (!member.sessionStart) return [];
  const now = Math.floor(Date.now() / 1000);
  const totalMin = Math.floor((now - member.sessionStart) / 60);
  if (member.status === "on_break" && member.breakStart) {
    const breakMin = Math.floor((now - member.breakStart) / 60);
    return [
      { type: "work", minutes: Math.max(0, totalMin - breakMin) },
      { type: "break", minutes: breakMin },
    ];
  }
  if (member.status === "away") {
    const awayMin = Math.floor(totalMin * 0.2);
    return [
      { type: "work", minutes: totalMin - awayMin },
      { type: "away", minutes: awayMin },
    ];
  }
  return [{ type: "work", minutes: totalMin }];
}

export default function MemberCard({ member, streak = 0 }: { member: TeamMember; streak?: number }) {
  const label = getStatusLabel(member.status);
  const isActive = member.status === "active";
  const isBreak = member.status === "on_break";
  const timer = useLiveTimer(
    isBreak ? member.breakStart : member.sessionStart,
    isActive || isBreak,
  );
  const segments = getMockSegments(member);

  return (
    <div className="glass noise rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5">
      <div className="flex items-start gap-3">
        {/* Avatar */}
        <div
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-[13px] font-bold"
          style={{
            background: `linear-gradient(135deg, ${member.avatarColor} 0%, ${member.avatarColor}cc 100%)`,
            color: "#fff",
            boxShadow: `0 2px 6px ${member.avatarColor}40`,
          }}
        >
          {member.name.charAt(0).toUpperCase()}
        </div>

        <div className="flex-1 min-w-0">
          {/* Name + badge row */}
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold truncate">{member.name}</span>
            {streak > 0 && (
              <span className="inline-flex items-center gap-0.5 text-[11px] font-semibold text-orange-400" title={`${streak}-day streak`}>
                <Flame className="h-3.5 w-3.5" />
                {streak}
              </span>
            )}
            <span className={cn(
              "inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[10px] font-semibold",
              badgeStyles[member.status],
            )}>
              <StatusDot status={member.status} pulse={isActive} />
              {label}
            </span>
          </div>

          {/* Timer line */}
          {(isActive || isBreak) && timer && (
            <div className="flex items-center gap-1.5 mt-1">
              {isBreak && <Coffee className="h-3 w-3 text-amber-400" />}
              <span className="font-mono text-[12px] tabular-nums text-muted-foreground">
                {isBreak ? `☕ ON BREAK · ${Math.floor((Date.now() / 1000 - (member.breakStart ?? 0)) / 60)}m` : timer}
              </span>
            </div>
          )}

          {member.status === "away" && member.sessionStart && (
            <div className="flex items-center gap-1.5 mt-1">
              <Moon className="h-3 w-3 text-gray-400" />
              <span className="text-[11px] text-muted-foreground">Away · Since {new Date(member.sessionStart * 1000).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
            </div>
          )}

          {/* Current task */}
          {member.currentTask && (
            <div className="flex items-center gap-1 mt-1.5 text-muted-foreground">
              <ArrowRightLeft className="h-3 w-3 shrink-0" />
              <span className="text-[11px] truncate">{member.currentTask}</span>
            </div>
          )}

          {/* Activity bar */}
          <div className="mt-2.5">
            <ActivityBar segments={segments} />
          </div>

          {/* Output note */}
          {member.outputNote && (
            <p className="mt-2 text-[11px] text-muted-foreground/70 italic truncate">
              "{member.outputNote}"
            </p>
          )}
        </div>
      </div>
    </div>
  );
}
