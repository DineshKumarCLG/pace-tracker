import type { ProjectTime } from "./reviewData";

interface ProjectBarsProps {
  data: ProjectTime[];
}

export default function ProjectBars({ data }: ProjectBarsProps) {
  const maxHours = Math.max(...data.map((p) => p.hours), 1);
  const totalHours = data.reduce((s, p) => s + p.hours, 0);

  return (
    <div
      className="glass noise rounded-xl p-4 animate-slide-up"
      style={{ animationDelay: "180ms" }}
    >
      <h3 className="text-[12px] font-semibold uppercase tracking-widest text-muted-foreground mb-3">
        Time by Project
      </h3>
      <div className="space-y-3">
        {data.map((project) => {
          const pct = maxHours > 0 ? (project.hours / maxHours) * 100 : 0;
          const share =
            totalHours > 0
              ? Math.round((project.hours / totalHours) * 100)
              : 0;
          return (
            <div key={project.projectId}>
              <div className="flex items-center justify-between mb-1">
                <div className="flex items-center gap-2">
                  <div
                    className="h-2.5 w-2.5 rounded-full"
                    style={{ backgroundColor: project.color }}
                  />
                  <span className="text-[12px] font-medium">
                    {project.projectName}
                  </span>
                </div>
                <span className="text-[11px] text-muted-foreground tabular-nums">
                  {project.hours.toFixed(1)}h · {share}%
                </span>
              </div>
              <div className="h-2 rounded-full inset-well overflow-hidden">
                <div
                  className="h-full rounded-full transition-all duration-500"
                  style={{
                    width: `${pct}%`,
                    backgroundColor: project.color,
                    boxShadow: `0 0 8px ${project.color}40`,
                  }}
                />
              </div>
            </div>
          );
        })}
      </div>
    </div>
  );
}
