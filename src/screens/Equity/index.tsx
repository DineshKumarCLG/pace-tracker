/**
 * Equity Dashboard Screen — Cap table pie chart, vesting, dilution history, projections.
 *
 * Requirements: 6.1, 6.2, 6.3, 7.1, 7.3, 7.4, 7.5, 22.1, 22.2, 22.4
 */

import { useEffect, useState, useMemo } from "react";
import {
  PieChart,
  TrendingDown,
  DollarSign,
  Percent,
  ShieldCheck,
} from "lucide-react";
import Card from "@/components/ui/Card";
import Badge from "@/components/ui/Badge";
import Input from "@/components/ui/Input";
import { useEquityStore } from "@/stores/equityStore";
import {
  computeVestingProgress,
  computeCliffStatus,
  computeProjectedPayout,
  type CliffStatus,
} from "@/lib/equity";
import { pb } from "@/lib/pocketbase";

/* ── Constants ── */

const FOUNDER_COLORS = [
  "#6366f1", // indigo
  "#f59e0b", // amber
  "#10b981", // emerald
  "#ef4444", // red
  "#8b5cf6", // violet
  "#06b6d4", // cyan
  "#f97316", // orange
  "#ec4899", // pink
];

/* ── Main Component ── */

export default function EquityScreen() {
  const stakes = useEquityStore((s) => s.stakes);
  const dilutionHistory = useEquityStore((s) => s.dilutionHistory);
  const loading = useEquityStore((s) => s.loading);
  const refresh = useEquityStore((s) => s.refresh);

  const [founderNames, setFounderNames] = useState<Record<string, string>>({});
  const [founderColors, setFounderColors] = useState<Record<string, string>>({});
  const [valuation, setValuation] = useState<string>("");

  useEffect(() => {
    refresh();
    loadFounderInfo();
  }, [refresh]);

  async function loadFounderInfo() {
    try {
      const users = await pb.collection("users").getFullList({
        filter: 'role ~ "founder" || role ~ "ceo" || role ~ "Founder" || role ~ "CEO"',
      });
      const names: Record<string, string> = {};
      const colors: Record<string, string> = {};
      users.forEach((u, i) => {
        names[u.id] = (u.name as string) ?? u.id;
        colors[u.id] = (u.avatarColor as string) ?? FOUNDER_COLORS[i % FOUNDER_COLORS.length];
      });
      setFounderNames(names);
      setFounderColors(colors);
    } catch {
      // Fallback: use founderId as name
    }
  }

  const now = Math.floor(Date.now() / 1000);
  const valuationNum = parseFloat(valuation) || 0;

  // Assign colors to stakes based on founder avatarColor or fallback
  const stakeColors = useMemo(() => {
    const map: Record<string, string> = {};
    stakes.forEach((s, i) => {
      map[s.founderId] = founderColors[s.founderId] ?? FOUNDER_COLORS[i % FOUNDER_COLORS.length];
    });
    return map;
  }, [stakes, founderColors]);

  if (loading && stakes.length === 0) {
    return (
      <div className="flex h-full items-center justify-center">
        <div className="text-[13px] text-muted-foreground animate-pulse">Loading equity data…</div>
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
              <h1 className="text-[26px] font-extrabold tracking-tight leading-tight">Equity Dashboard</h1>
              <p className="text-[13px] text-muted-foreground mt-0.5 font-medium">
                Cap table, vesting, and dilution tracking
              </p>
            </div>
          </div>
        </div>

        {/* Cap Table Pie Chart + Legend (Req 22.1, 22.2, 22.4) */}
        <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <section>
            <SectionLabel icon={<PieChart className="h-3.5 w-3.5" />} label="Cap Table" />
            <Card className="p-5 mt-3 flex items-center justify-center" glow>
              {stakes.length > 0 ? (
                <CapTablePieChart
                  stakes={stakes}
                  colors={stakeColors}
                  names={founderNames}
                />
              ) : (
                <p className="text-[12px] text-muted-foreground">No equity data available</p>
              )}
            </Card>
          </section>

          {/* Legend + Projected Payout */}
          <section>
            <SectionLabel icon={<DollarSign className="h-3.5 w-3.5" />} label="Projections" />
            <Card className="p-5 mt-3 space-y-4" glow>
              {/* Legend */}
              <div className="space-y-2">
                {stakes.map((stake) => (
                  <div key={stake.founderId} className="flex items-center gap-2 text-[12px]">
                    <div
                      className="h-3 w-3 rounded-sm shrink-0"
                      style={{ backgroundColor: stakeColors[stake.founderId] }}
                    />
                    <span className="font-medium">{founderNames[stake.founderId] ?? stake.founderId}</span>
                    <span className="text-muted-foreground ml-auto">{stake.currentStakePct.toFixed(2)}%</span>
                  </div>
                ))}
              </div>

              {/* Valuation input (Req 7.3) */}
              <div className="border-t border-border/50 pt-4">
                <label className="text-[10px] font-bold uppercase tracking-widest text-muted-foreground/60 block mb-2">
                  Company Valuation
                </label>
                <Input
                  type="number"
                  placeholder="Enter valuation (e.g. 5000000)"
                  value={valuation}
                  onChange={(e) => setValuation(e.target.value)}
                  inputSize="sm"
                  min={0}
                  aria-label="Company valuation"
                />
                {valuationNum > 0 && (
                  <div className="mt-3 space-y-1.5">
                    {stakes.map((stake) => (
                      <div key={stake.founderId} className="flex items-center justify-between text-[12px]">
                        <span className="text-muted-foreground">{founderNames[stake.founderId] ?? stake.founderId}</span>
                        <span className="font-semibold">
                          ${computeProjectedPayout(stake.currentStakePct, valuationNum).toLocaleString("en", { maximumFractionDigits: 0 })}
                        </span>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </Card>
          </section>
        </div>

        {/* Vesting Progress (Req 6.1, 6.2, 6.3) */}
        {stakes.length > 0 && (
          <section>
            <SectionLabel icon={<ShieldCheck className="h-3.5 w-3.5" />} label="Vesting Progress" />
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 mt-3">
              {stakes.map((stake) => (
                <VestingCard
                  key={stake.founderId}
                  stake={stake}
                  name={founderNames[stake.founderId] ?? stake.founderId}
                  color={stakeColors[stake.founderId]}
                  now={now}
                />
              ))}
            </div>
          </section>
        )}

        {/* Dilution History (Req 7.1) */}
        {dilutionHistory.length > 0 && (
          <section>
            <SectionLabel icon={<TrendingDown className="h-3.5 w-3.5 text-rose-400" />} label="Dilution History" />
            <Card className="p-5 mt-3">
              <div className="space-y-3">
                {dilutionHistory.map((event) => (
                  <DilutionEventRow
                    key={event.id}
                    event={event}
                    founderNames={founderNames}
                  />
                ))}
              </div>
            </Card>
          </section>
        )}
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

/** SVG-based pie chart — no external chart library (Req 22.1, 22.2, 22.4) */
function CapTablePieChart({
  stakes,
  colors,
  names,
}: {
  stakes: Array<{ founderId: string; currentStakePct: number }>;
  colors: Record<string, string>;
  names: Record<string, string>;
}) {
  const size = 200;
  const cx = size / 2;
  const cy = size / 2;
  const radius = 80;

  // Build pie segments
  let cumulativeAngle = -90; // start from top
  const segments = stakes.map((stake) => {
    const angle = (stake.currentStakePct / 100) * 360;
    const startAngle = cumulativeAngle;
    cumulativeAngle += angle;
    const endAngle = cumulativeAngle;

    const startRad = (startAngle * Math.PI) / 180;
    const endRad = (endAngle * Math.PI) / 180;

    const x1 = cx + radius * Math.cos(startRad);
    const y1 = cy + radius * Math.sin(startRad);
    const x2 = cx + radius * Math.cos(endRad);
    const y2 = cy + radius * Math.sin(endRad);

    const largeArc = angle > 180 ? 1 : 0;

    const pathD = [
      `M ${cx} ${cy}`,
      `L ${x1} ${y1}`,
      `A ${radius} ${radius} 0 ${largeArc} 1 ${x2} ${y2}`,
      "Z",
    ].join(" ");

    // Label position at midpoint of arc
    const midAngle = ((startAngle + endAngle) / 2 * Math.PI) / 180;
    const labelRadius = radius * 0.6;
    const labelX = cx + labelRadius * Math.cos(midAngle);
    const labelY = cy + labelRadius * Math.sin(midAngle);

    return {
      founderId: stake.founderId,
      pathD,
      color: colors[stake.founderId] ?? "#6366f1",
      labelX,
      labelY,
      pct: stake.currentStakePct,
      name: names[stake.founderId] ?? stake.founderId,
      angle,
    };
  });

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      role="img"
      aria-label="Cap table pie chart"
    >
      {segments.map((seg) => (
        <path
          key={seg.founderId}
          d={seg.pathD}
          fill={seg.color}
          stroke="hsl(var(--card))"
          strokeWidth="2"
        />
      ))}
      {segments.map((seg) =>
        seg.angle > 20 ? (
          <text
            key={`label-${seg.founderId}`}
            x={seg.labelX}
            y={seg.labelY}
            textAnchor="middle"
            dominantBaseline="middle"
            className="fill-white text-[9px] font-bold"
            style={{ pointerEvents: "none" }}
          >
            {seg.pct.toFixed(1)}%
          </text>
        ) : null,
      )}
    </svg>
  );
}

function VestingCard({
  stake,
  name,
  color,
  now,
}: {
  stake: import("@/lib/equity").EquityStake;
  name: string;
  color: string;
  now: number;
}) {
  const progress = computeVestingProgress(stake, now);
  const cliffStatus: CliffStatus = computeCliffStatus(stake, now);
  const progressPct = Math.round(progress * 100);

  return (
    <Card className="p-4">
      <div className="flex items-center justify-between mb-2">
        <div className="flex items-center gap-2">
          <div className="h-3 w-3 rounded-sm shrink-0" style={{ backgroundColor: color }} />
          <span className="text-[13px] font-semibold">{name}</span>
        </div>
        <Badge
          variant={cliffStatus.status === "fully_vested" ? "success" : cliffStatus.status === "cliff_passed" ? "default" : "warning"}
          size="sm"
        >
          {cliffStatus.status === "pre_cliff"
            ? `Pre-cliff (${cliffStatus.daysRemaining}d)`
            : cliffStatus.status === "cliff_passed"
              ? "Cliff passed"
              : "Fully vested"}
        </Badge>
      </div>
      <div className="flex items-center gap-2 text-[11px] text-muted-foreground mb-2">
        <Percent className="h-3 w-3" />
        <span>{stake.currentStakePct.toFixed(2)}% equity</span>
        <span className="ml-auto">{progressPct}% vested</span>
      </div>
      {/* Progress bar */}
      <div className="h-2 rounded-full inset-well overflow-hidden">
        <div
          className="h-full rounded-full transition-all duration-700"
          style={{
            width: `${progressPct}%`,
            background: `linear-gradient(90deg, ${color} 0%, ${color}99 100%)`,
            boxShadow: `0 0 6px ${color}40`,
          }}
        />
      </div>
    </Card>
  );
}

function DilutionEventRow({
  event,
  founderNames,
}: {
  event: import("@/lib/equity").DilutionEvent;
  founderNames: Record<string, string>;
}) {
  const date = new Date(event.createdAt * 1000).toLocaleDateString("en", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });

  return (
    <div className="rounded-lg border border-rose-500/10 bg-rose-500/[0.03] px-3 py-2.5">
      <div className="flex items-center gap-2 text-[12px]">
        <TrendingDown className="h-3.5 w-3.5 text-rose-400 shrink-0" />
        <span className="font-medium">{founderNames[event.founderId] ?? event.founderId}</span>
        <Badge variant="danger" size="sm">-{event.dilutionPct}%</Badge>
        <span className="text-muted-foreground ml-auto">{date}</span>
      </div>
      <div className="mt-1.5 text-[11px] text-muted-foreground flex gap-3">
        <span>{event.previousStakePct.toFixed(2)}% → {event.newStakePct.toFixed(2)}%</span>
        {event.cycleId && <span>Cycle: {event.cycleId.slice(0, 8)}…</span>}
      </div>
      {/* Resulting stakes */}
      {Object.keys(event.redistributionDetails).length > 0 && (
        <div className="mt-1.5 flex flex-wrap gap-2">
          {Object.entries(event.redistributionDetails).map(([fId, detail]) => (
            <span key={fId} className="text-[10px] text-muted-foreground">
              {founderNames[fId] ?? fId.slice(0, 6)}: {detail.new.toFixed(2)}%
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
