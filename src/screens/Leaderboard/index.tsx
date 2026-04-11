/**
 * Leaderboard Screen — Weekly founder scores, ranking, and Founder of the Week.
 *
 * Requirements: 5.1, 5.2, 5.3, 5.4, 5.5, 5.6
 */

import { useEffect } from "react";
import {
  Trophy,
  Clock,
  CheckSquare,
  Users,
  Star,
  TrendingUp,
} from "lucide-react";
import { cn } from "@/lib/utils";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import { useLeaderboardStore } from "@/stores/leaderboardStore";

/* ── Main Component ── */

export default function LeaderboardScreen() {
  const scores = useLeaderboardStore((s) => s.scores);
  const currentWeek = useLeaderboardStore((s) => s.currentWeek);
  const loading = useLeaderboardStore((s) => s.loading);
  const refresh = useLeaderboardStore((s) => s.refresh);

  useEffect(() => {
    refresh();
  }, [refresh]);

  if (loading && scores.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground animate-pulse">Loading leaderboard…</div>
      </div>
    );
  }

  return (
    <div className="h-full overflow-y-auto transition-all duration-200">
      <div className="space-y-6 px-6 py-6 pb-12">
        {/* Header */}
        <div className="mb-2">
          <div className="flex items-center gap-3 mb-1">
            <div className="h-8 w-1 rounded-full bg-gradient-to-b from-primary to-primary/30" />
            <div>
              <h1 className="text-[26px] font-extrabold tracking-tight leading-tight">Leaderboard</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
                Week of {currentWeek}
              </p>
            </div>
          </div>
        </div>

        {/* Founder of the Week highlight */}
        {scores.length > 0 && (
          <FounderOfWeekCard scores={scores} />
        )}

        {/* Ranked list (Req 5.1) */}
        <section>
          <SectionLabel icon={<Users className="h-3.5 w-3.5" />} label="Rankings" />
          <div className="space-y-3 mt-3">
            {scores.map((score, index) => (
              <FounderScoreCard key={score.founderId} score={score} rank={index + 1} />
            ))}
            {scores.length === 0 && (
              <Card className="p-5">
                <p className="text-[12px] text-muted-foreground">No scores available for this week</p>
              </Card>
            )}
          </div>
        </section>
      </div>
    </div>
  );
}

/* ── Sub-components ── */

function SectionLabel({ icon, label }: { icon: React.ReactNode; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="text-muted-foreground">{icon}</span>
      <span className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60">
        {label}
      </span>
    </div>
  );
}

function FounderOfWeekCard({ scores }: { scores: Array<{ founderId: string; name: string; compositeScore: number; isFounderOfWeek: boolean }> }) {
  const winner = scores.find((s) => s.isFounderOfWeek);
  if (!winner) return null;

  return (
    <Card className="relative overflow-hidden p-5" glow>
      <div className="absolute left-0 inset-y-0 w-[3px] rounded-l-xl bg-amber-400" />
      <div className="pl-3 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-full bg-amber-400/10">
          <Trophy className="h-5 w-5 text-amber-400" />
        </div>
        <div>
          <div className="flex items-center gap-2">
            <span className="text-[14px] font-bold">{winner.name}</span>
            <Badge variant="warning" size="sm">
              <Star className="h-3 w-3 mr-0.5 inline" />
              Founder of the Week
            </Badge>
          </div>
          <p className="text-[11px] text-muted-foreground mt-0.5">
            Score: {winner.compositeScore.toFixed(3)}
          </p>
        </div>
      </div>
    </Card>
  );
}

function FounderScoreCard({
  score,
  rank,
}: {
  score: {
    founderId: string;
    name: string;
    hours: number;
    tasksCompleted: number;
    peerReviewAvg: number;
    compositeScore: number;
    isFounderOfWeek: boolean;
  };
  rank: number;
}) {
  const rankColors: Record<number, string> = {
    1: "text-amber-400",
    2: "text-gray-300",
    3: "text-amber-600",
  };

  return (
    <Card
      className={cn("p-4", score.isFounderOfWeek && "ring-1 ring-amber-400/20")}
      interactive
    >
      <div className="flex items-center gap-3">
        {/* Rank */}
        <div className={cn("text-[18px] font-extrabold w-8 text-center shrink-0", rankColors[rank] ?? "text-muted-foreground")}>
          #{rank}
        </div>

        {/* Avatar */}
        <div className="relative shrink-0">
          <div className="flex h-9 w-9 items-center justify-center rounded-full bg-accent/60 text-[13px] font-bold text-foreground">
            {score.name.charAt(0)}
          </div>
          {score.isFounderOfWeek && (
            <Star className="absolute -top-1 -right-1 h-3.5 w-3.5 text-amber-400 fill-amber-400" />
          )}
        </div>

        {/* Info */}
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-[13px] font-semibold truncate">{score.name}</span>
            {score.isFounderOfWeek && (
              <Badge variant="warning" size="sm">🏆</Badge>
            )}
          </div>
          {/* Metrics row (Req 5.2) */}
          <div className="flex items-center gap-4 mt-1 text-[11px] text-muted-foreground">
            <span className="flex items-center gap-1">
              <Clock className="h-3 w-3" />
              {score.hours.toFixed(1)}h
            </span>
            <span className="flex items-center gap-1">
              <CheckSquare className="h-3 w-3" />
              {score.tasksCompleted} tasks
            </span>
            <span className="flex items-center gap-1">
              <TrendingUp className="h-3 w-3" />
              {score.peerReviewAvg.toFixed(1)} review
            </span>
          </div>
        </div>

        {/* Score */}
        <div className="text-right shrink-0">
          <div className="text-[18px] font-extrabold">{score.compositeScore.toFixed(3)}</div>
          <div className="text-[10px] text-muted-foreground">score</div>
        </div>
      </div>

      {/* Score breakdown bar */}
      <div className="mt-3 h-1.5 rounded-full inset-well overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${Math.min(score.compositeScore * 100, 100)}%`,
            background: score.isFounderOfWeek
              ? "linear-gradient(90deg, #d97706 0%, #f59e0b 100%)"
              : "linear-gradient(90deg, hsl(var(--primary)) 0%, hsl(var(--primary) / 0.6) 100%)",
            boxShadow: score.isFounderOfWeek ? "0 0 8px rgba(217,119,6,0.3)" : undefined,
          }}
        />
      </div>
    </Card>
  );
}
