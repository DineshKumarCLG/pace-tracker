import { Clock, ListChecks, CalendarDays } from "lucide-react";
import { getTeamWeeklyData, type TeamMemberWeek } from "./reviewData";

interface TeamReviewProps {
  weekOffset: number;
}

function MemberRow({ member }: { member: TeamMemberWeek }) {
  return (
    <div className="glass noise rounded-xl p-4 transition-all duration-200 hover:-translate-y-0.5">
      <div className="flex items-center gap-3">
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

        {/* Name */}
        <div className="flex-1 min-w-0">
          <p className="text-[13px] font-semibold truncate">{member.name}</p>
        </div>

        {/* Stats — no rankings, no scores */}
        <div className="flex items-center gap-4">
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <Clock className="h-3 w-3" />
            <span className="text-[12px] font-medium tabular-nums">
              {member.hours.toFixed(1)}h
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <ListChecks className="h-3 w-3" />
            <span className="text-[12px] font-medium tabular-nums">
              {member.tasksClosed}
            </span>
          </div>
          <div className="flex items-center gap-1.5 text-muted-foreground">
            <CalendarDays className="h-3 w-3" />
            <span className="text-[12px] font-medium tabular-nums">
              {member.activeDays}d
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function TeamReview({ weekOffset }: TeamReviewProps) {
  const members = getTeamWeeklyData(weekOffset);

  return (
    <div className="space-y-3">
      <p className="text-[11px] text-muted-foreground/60 font-medium">
        Hours, tasks closed, and active days per member. No rankings or scores.
      </p>
      {members.map((m) => (
        <MemberRow key={m.userId} member={m} />
      ))}
    </div>
  );
}
