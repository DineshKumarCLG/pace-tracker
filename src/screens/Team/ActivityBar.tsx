import { cn } from "@/lib/utils";

export interface ActivitySegment {
  type: "work" | "break" | "away";
  /** Duration in minutes */
  minutes: number;
}

interface ActivityBarProps {
  segments: ActivitySegment[];
  /** Total day span in minutes (default 8h = 480) */
  totalMinutes?: number;
}

const segmentColors: Record<ActivitySegment["type"], string> = {
  work: "bg-indigo-500",
  break: "bg-amber-400",
  away: "bg-gray-400/60",
};

export default function ActivityBar({ segments, totalMinutes = 480 }: ActivityBarProps) {
  const usedMinutes = segments.reduce((sum, s) => sum + s.minutes, 0);
  const cappedTotal = Math.max(totalMinutes, usedMinutes);

  if (segments.length === 0) {
    return (
      <div className="inset-well h-2 w-full rounded-full overflow-hidden" role="img" aria-label="No activity today" />
    );
  }

  return (
    <div className="inset-well h-2 w-full rounded-full overflow-hidden flex" role="img" aria-label="Activity bar">
      {segments.map((seg, i) => {
        const pct = (seg.minutes / cappedTotal) * 100;
        return (
          <div
            key={i}
            className={cn("h-full transition-all duration-300", segmentColors[seg.type])}
            style={{ width: `${pct}%` }}
            title={`${seg.type}: ${seg.minutes}m`}
          />
        );
      })}
    </div>
  );
}
