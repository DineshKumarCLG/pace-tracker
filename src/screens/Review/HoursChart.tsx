import {
  AreaChart,
  Area,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";
import type { DailyHours } from "./reviewData";

interface HoursChartProps {
  data: DailyHours[];
}

function CustomTooltip({
  active,
  payload,
}: {
  active?: boolean;
  payload?: Array<{ payload: DailyHours }>;
}) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="glass-elevated rounded-lg px-3 py-2 text-[12px]">
      <p className="font-semibold">{d.day}</p>
      <p className="text-muted-foreground">
        {d.hours.toFixed(1)}h{d.isWeekend ? " (weekend)" : ""}
      </p>
    </div>
  );
}

export default function HoursChart({ data }: HoursChartProps) {
  return (
    <div
      className="glass noise rounded-xl p-4 animate-slide-up"
      style={{ animationDelay: "120ms" }}
    >
      <h3 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Daily Hours
      </h3>
      <div className="h-[180px]">
        <ResponsiveContainer width="100%" height="100%">
          <AreaChart
            data={data}
            margin={{ top: 4, right: 4, left: -20, bottom: 0 }}
          >
            <defs>
              <linearGradient id="hoursGradient" x1="0" y1="0" x2="0" y2="1">
                <stop offset="0%" stopColor="hsl(40, 95%, 52%)" stopOpacity={0.4} />
                <stop offset="100%" stopColor="hsl(40, 95%, 52%)" stopOpacity={0.02} />
              </linearGradient>
            </defs>
            <CartesianGrid
              strokeDasharray="3 3"
              stroke="hsl(225, 8%, 16%)"
              vertical={false}
            />
            <XAxis
              dataKey="day"
              tick={{ fontSize: 11, fill: "hsl(225, 8%, 48%)" }}
              axisLine={false}
              tickLine={false}
            />
            <YAxis
              tick={{ fontSize: 11, fill: "hsl(225, 8%, 48%)" }}
              axisLine={false}
              tickLine={false}
              tickFormatter={(v: number) => `${v}h`}
            />
            <Tooltip content={<CustomTooltip />} />
            <Area
              type="monotone"
              dataKey="hours"
              stroke="hsl(40, 95%, 52%)"
              strokeWidth={2}
              fill="url(#hoursGradient)"
              dot={{
                r: 3,
                fill: "hsl(40, 95%, 52%)",
                stroke: "hsl(225, 15%, 7%)",
                strokeWidth: 2,
              }}
              activeDot={{
                r: 5,
                fill: "hsl(40, 95%, 52%)",
                stroke: "hsl(225, 15%, 7%)",
                strokeWidth: 2,
              }}
            />
          </AreaChart>
        </ResponsiveContainer>
      </div>
    </div>
  );
}
