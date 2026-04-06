import { Plus, FolderOpen } from "lucide-react";
import { cn } from "@/lib/utils";
import { useProjects } from "@/queries/projects";
import { useTasks } from "@/queries/tasks";
import type { Project } from "@/types";

interface ProjectListProps {
  selectedProjectId: string | null;
  onSelectProject: (projectId: string | null) => void;
}

export default function ProjectList({
  selectedProjectId,
  onSelectProject,
}: ProjectListProps) {
  const { data: projects = [] } = useProjects();
  const { data: allTasks = [] } = useTasks();

  const activeProjects = projects.filter((p) => p.archivedAt === null);

  return (
    <div className="flex h-full w-[200px] shrink-0 flex-col glass rounded-xl">
      {/* Header */}
      <div className="flex items-center justify-between px-3 pt-3 pb-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
          Projects
        </h2>
        <button
          className="btn-ghost rounded-md p-1 text-muted-foreground hover:text-foreground transition-colors"
          title="New project"
        >
          <Plus className="h-3.5 w-3.5" />
        </button>
      </div>

      {/* All tasks option */}
      <div className="px-1.5 space-y-0.5 flex-1 overflow-y-auto">
        <button
          onClick={() => onSelectProject(null)}
          className={cn(
            "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-all duration-150",
            selectedProjectId === null
              ? "bg-primary/10 text-foreground"
              : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
          )}
        >
          <FolderOpen className="h-3.5 w-3.5 shrink-0" />
          <span className="flex-1 truncate">All Tasks</span>
          <span className="text-[11px] tabular-nums text-muted-foreground">
            {allTasks.length}
          </span>
        </button>

        {/* Project items */}
        {activeProjects.map((project) => (
          <ProjectItem
            key={project.id}
            project={project}
            taskCount={allTasks.filter((t) => t.projectId === project.id).length}
            openCount={
              allTasks.filter(
                (t) =>
                  t.projectId === project.id &&
                  (t.status === "open" || t.status === "inprogress"),
              ).length
            }
            isSelected={selectedProjectId === project.id}
            onSelect={() => onSelectProject(project.id)}
          />
        ))}
      </div>
    </div>
  );
}

function ProjectItem({
  project,
  taskCount,
  openCount,
  isSelected,
  onSelect,
}: {
  project: Project;
  taskCount: number;
  openCount: number;
  isSelected: boolean;
  onSelect: () => void;
}) {
  return (
    <button
      onClick={onSelect}
      className={cn(
        "flex w-full items-center gap-2 rounded-lg px-2.5 py-2 text-left text-[13px] font-medium transition-all duration-150",
        isSelected
          ? "bg-primary/10 text-foreground"
          : "text-muted-foreground hover:text-foreground hover:bg-accent/50",
      )}
    >
      {/* Color dot */}
      <span
        className="h-2.5 w-2.5 shrink-0 rounded-full"
        style={{ backgroundColor: project.color }}
      />
      <span className="flex-1 truncate">{project.name}</span>
      <span className="text-[11px] tabular-nums text-muted-foreground">
        {openCount}/{taskCount}
      </span>
    </button>
  );
}
