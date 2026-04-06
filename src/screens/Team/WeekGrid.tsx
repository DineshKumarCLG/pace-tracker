import type { TeamMember } from "@/types";
import { cn } from "@/lib/utils";

const DAYS = ["Mon", "Tue", "Wed", "Thu", "Fri"] as const;

/** Mock weekly hours per member. In production this comes from session data. */
function getMockWeeklyHours(member: TeamMember): number[] {
  // Deterministic mock based on name hash
  const seed = member.name.charCodeAt(0);
  return DAYS.map((_, i) => {
    if (member.status === "offline" && i >= 3) return 0;
    const base = 4 + ((seed + i * 7) % 5);
    return Math.round(base * 10) / 10;
  });
}

interface WeekGridProps {
  members: TeamMember[];
  onCellClick?: (userId: string, dayIndex: number) => void;
}

export default function WeekGrid({ members, onCellClick }: WeekGridProps) {
  const MAX_HOURS = 10;
  const memberData = members.map((m) => ({
    member: m,
    hours: getMockWeeklyHours(m),
  }));

  // Team totals
  const totals = DAYS.map((_, di) =>
    memberData.reduce((sum, md) => sum + md.hours[di], 0),
  );

  return (
    <div className="glass noise rounded-xl overflow-hidden">
      {/* Header */}
      <div className="grid grid-cols-[140px_repeat(5,1fr)] gap-px border-b border-border/40 px-4 py-2.5">
        <div className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">Member</div>
        {DAYS.map((d) => (
          <div key={d} className="text-center text-[10px] font-semibold uppercase tracking-widest text-muted-foreground">{d}</div>
        ))}
      </div>

      {/* Member rows */}
      {memberData.map(({ member, hours }) => (
        <div key={member.userId} className="grid grid-cols-[140px_repeat(5,1fr)] gap-px items-center px-4 py-2 border-b border-border/20 hover:bg-accent/20 transition-colors">
          <div className="flex items-center gap-2 min-w-0">
            <div
              className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full text-[10px] font-bold text-white"
              style={{ background: member.avatarColor }}
            >
              {member.name.charAt(0)}
            </div>
            <span className="text-[12px] font-medium truncate">{member.name}</span>
          </div>
          {hours.map((h, di) => (
            <button
              key={di}
              onClick={() => onCellClick?.(member.userId, di)}
              className="group flex flex-col items-center gap-0.5 px-1 py-0.5 rounded-md hover:bg-accent/30 transition-colors cursor-pointer"
              title={`${member.name} — ${DAYS[di]}: ${h}h`}
            >
              <div className="inset-well h-1.5 w-full max-w-[60px] rounded-full overflow-hidden">
                <div
                  className={cn(
                    "h-full rounded-full transition-all duration-300",
                    h > 0 ? "bg-indigo-500" : "bg-transparent",
                  )}
                  style={{ width: `${Math.min(100, (h / MAX_HOURS) * 100)}%` }}
                />
              </div>
              <span className={cn(
                "text-[10px] tabular-nums",
                h > 0 ? "text-muted-foreground" : "text-muted-foreground/30",
              )}>
                {h > 0 ? `${h}h` : "—"}
              </span>
            </button>
          ))}
        </div>
      ))}

      {/* Team total row */}
      <div className="grid grid-cols-[140px_repeat(5,1fr)] gap-px items-center px-4 py-2.5 bg-accent/10">
        <div className="text-[11px] font-bold uppercase tracking-wider text-muted-foreground">Team Total</div>
        {totals.map((t, di) => (
          <div key={di} className="text-center text-[11px] font-semibold tabular-nums text-foreground/80">
            {t > 0 ? `${t.toFixed(1)}h` : "—"}
          </div>
        ))}
      </div>
    </div>
  );
}
