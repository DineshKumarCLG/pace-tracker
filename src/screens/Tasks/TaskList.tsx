import { useTasks } from "@/queries/tasks";
import { useProject } from "@/queries/projects";
import { useTaskStore } from "@/stores/taskStore";
import TaskRow from "./TaskRow";
import InlineTaskCreate from "./InlineTaskCreate";
import type { Task } from "@/types";

interface TaskListProps {
  projectId: string | null;
  onTaskClick?: (taskId: string) => void;
}

export default function TaskList({ projectId, onTaskClick }: TaskListProps) {
  const { data: queryTasks = [], isLoading } = useTasks(projectId);
  const storeTasks = useTaskStore((s) => s.tasks);
  const { data: project } = useProject(projectId);

  // Merge query tasks with locally-created tasks (deduplicated by id)
  const queryIds = new Set(queryTasks.map((t) => t.id));
  const localOnly = storeTasks.filter(
    (t) => !queryIds.has(t.id) && (!projectId || t.projectId === projectId),
  );
  const tasks = [...queryTasks, ...localOnly];

  const openTasks = tasks.filter(
    (t) => t.status === "open" || t.status === "inprogress" || t.status === "blocked",
  );
  const closedThisWeek = tasks.filter((t) => {
    if (t.status !== "done" || !t.closedAt) return false;
    const weekAgo = Math.floor(Date.now() / 1000) - 7 * 24 * 60 * 60;
    return t.closedAt >= weekAgo;
  });

  const heading = project ? project.name : "All Tasks";

  if (isLoading) {
    return (
      <div className="flex flex-1 items-center justify-center text-muted-foreground text-sm">
        Loading tasks…
      </div>
    );
  }

  return (
    <div className="flex flex-1 flex-col overflow-y-auto px-4 py-4">
      <h2 className="text-lg font-bold tracking-tight mb-4">{heading}</h2>

      {/* Inline task creation row */}
      <InlineTaskCreate projectId={projectId} />

      {/* Open tasks */}
      <TaskGroup label="Open" count={openTasks.length} tasks={openTasks} onTaskClick={onTaskClick} />

      {/* Closed this week */}
      {closedThisWeek.length > 0 && (
        <TaskGroup
          label="Closed This Week"
          count={closedThisWeek.length}
          tasks={closedThisWeek}
          onTaskClick={onTaskClick}
          dimmed
        />
      )}

      {tasks.length === 0 && (
        <div className="flex flex-1 items-center justify-center text-muted-foreground text-[13px]">
          No tasks yet
        </div>
      )}
    </div>
  );
}

function TaskGroup({
  label,
  count,
  tasks,
  onTaskClick,
  dimmed = false,
}: {
  label: string;
  count: number;
  tasks: Task[];
  onTaskClick?: (taskId: string) => void;
  dimmed?: boolean;
}) {
  return (
    <div className="mb-5">
      <div className="flex items-center gap-2 mb-2 px-3">
        <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          {label}
        </span>
        <span className="text-[11px] tabular-nums text-muted-foreground/60">
          {count}
        </span>
      </div>
      <div
        className={dimmed ? "opacity-60" : undefined}
      >
        {tasks.map((task) => (
          <TaskRow key={task.id} task={task} onClick={onTaskClick} />
        ))}
      </div>
    </div>
  );
}
