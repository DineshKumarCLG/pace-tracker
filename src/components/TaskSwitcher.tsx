import { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { Search, Command } from "lucide-react";
import { useTasks } from "@/queries/tasks";
import { useProjects } from "@/queries/projects";
import { useTaskStore } from "@/stores/taskStore";
import { cn } from "@/lib/utils";
import type { Task, Project } from "@/types";

interface TaskSwitcherProps {
  open: boolean;
  onClose: () => void;
}

/** Format accumulated minutes into a human-readable string. */
function formatTime(minutes: number): string {
  if (minutes < 1) return "0m";
  const h = Math.floor(minutes / 60);
  const m = Math.round(minutes % 60);
  if (h === 0) return `${m}m`;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}

/** Group tasks by project, returning groups with project metadata. */
function groupByProject(
  tasks: Task[],
  projects: Project[],
): { project: Project; tasks: Task[] }[] {
  const projectMap = new Map(projects.map((p) => [p.id, p]));
  const groups = new Map<string, Task[]>();

  for (const task of tasks) {
    const existing = groups.get(task.projectId);
    if (existing) {
      existing.push(task);
    } else {
      groups.set(task.projectId, [task]);
    }
  }

  return Array.from(groups.entries())
    .map(([projectId, groupTasks]) => ({
      project: projectMap.get(projectId) ?? {
        id: projectId,
        name: "Unknown Project",
        color: "#888",
        createdBy: "",
        createdAt: 0,
        archivedAt: null,
      },
      tasks: groupTasks,
    }))
    .sort((a, b) => a.project.name.localeCompare(b.project.name));
}

export default function TaskSwitcher({ open, onClose }: TaskSwitcherProps) {
  const [filter, setFilter] = useState("");
  const [selectedIndex, setSelectedIndex] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const { data: allTasks = [] } = useTasks();
  const { data: projects = [] } = useProjects();
  const activeTaskId = useTaskStore((s) => s.activeTaskId);
  const setActiveTask = useTaskStore((s) => s.setActiveTask);

  // Filter to switchable tasks (not done) and apply text filter
  const switchableTasks = useMemo(() => {
    const base = allTasks.filter((t) => t.status !== "done");
    if (!filter.trim()) return base;
    const q = filter.toLowerCase();
    return base.filter((t) => t.title.toLowerCase().includes(q));
  }, [allTasks, filter]);

  // Group filtered tasks by project
  const groups = useMemo(
    () => groupByProject(switchableTasks, projects),
    [switchableTasks, projects],
  );

  // Flat list of tasks for keyboard navigation indexing
  const flatTasks = useMemo(
    () => groups.flatMap((g) => g.tasks),
    [groups],
  );

  // Reset state when overlay opens
  useEffect(() => {
    if (open) {
      setFilter("");
      setSelectedIndex(0);
      // Auto-focus the search input after a tick (for animation)
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  // Clamp selected index when list changes
  useEffect(() => {
    setSelectedIndex((prev) =>
      flatTasks.length === 0 ? 0 : Math.min(prev, flatTasks.length - 1),
    );
  }, [flatTasks.length]);

  // Scroll selected item into view
  useEffect(() => {
    if (!listRef.current) return;
    const selected = listRef.current.querySelector("[data-selected='true']");
    selected?.scrollIntoView({ block: "nearest" });
  }, [selectedIndex]);

  const handleSelect = useCallback(
    (task: Task) => {
      if (task.id === activeTaskId) return; // no self-switch

      // Update Zustand active task
      setActiveTask(task.id);

      // TODO: When Rust commands are ready, wire up:
      // 1. Close current session_task (set endTime = now)
      // 2. Create new session_task for selected task
      // 3. Update task status to "inprogress" if was "open"

      onClose();
    },
    [activeTaskId, setActiveTask, onClose],
  );

  const handleKeyDown = useCallback(
    (e: React.KeyboardEvent) => {
      switch (e.key) {
        case "ArrowDown":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev < flatTasks.length - 1 ? prev + 1 : 0,
          );
          break;
        case "ArrowUp":
          e.preventDefault();
          setSelectedIndex((prev) =>
            prev > 0 ? prev - 1 : flatTasks.length - 1,
          );
          break;
        case "Enter":
          e.preventDefault();
          if (flatTasks[selectedIndex]) {
            handleSelect(flatTasks[selectedIndex]);
          }
          break;
        case "Escape":
          e.preventDefault();
          onClose();
          break;
      }
    },
    [flatTasks, selectedIndex, handleSelect, onClose],
  );

  if (!open) return null;

  // Build a running index counter for mapping group items to flat index
  let runningIndex = 0;

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center pt-[15vh] bg-black/40 backdrop-blur-sm"
      onClick={onClose}
      role="presentation"
    >
      {/* Panel */}
      <div
        className="glass-elevated w-full max-w-lg rounded-xl animate-scale-in overflow-hidden"
        onClick={(e) => e.stopPropagation()}
        onKeyDown={handleKeyDown}
        role="dialog"
        aria-modal="true"
        aria-label="Task switcher"
      >
        {/* Search input */}
        <div className="flex items-center gap-3 border-b border-border px-4 py-3">
          <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            type="text"
            className="inset-well flex-1 rounded-md bg-transparent px-3 py-1.5 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none"
            placeholder="Search tasks…"
            value={filter}
            onChange={(e) => {
              setFilter(e.target.value);
              setSelectedIndex(0);
            }}
            aria-label="Filter tasks"
          />
          <kbd className="hidden sm:flex items-center gap-0.5 rounded border border-border bg-muted px-1.5 py-0.5 text-[10px] font-mono text-muted-foreground">
            <Command className="h-2.5 w-2.5" />K
          </kbd>
        </div>

        {/* Task list */}
        <div
          ref={listRef}
          className="max-h-[50vh] overflow-y-auto py-2"
          role="listbox"
          aria-label="Tasks"
        >
          {flatTasks.length === 0 ? (
            <div className="px-4 py-8 text-center text-sm text-muted-foreground">
              {filter ? "No tasks match your search" : "No open tasks"}
            </div>
          ) : (
            groups.map((group) => {
              const groupItems = group.tasks.map((task) => {
                const idx = runningIndex++;
                const isActive = task.id === activeTaskId;
                const isSelected = idx === selectedIndex;

                return (
                  <button
                    key={task.id}
                    data-selected={isSelected}
                    onClick={() => handleSelect(task)}
                    className={cn(
                      "flex w-full items-center gap-3 px-4 py-2 text-left text-sm transition-colors",
                      "focus:outline-none",
                      isSelected
                        ? "bg-accent text-accent-foreground"
                        : "text-foreground hover:bg-accent/50",
                      isActive && "opacity-60",
                    )}
                    role="option"
                    aria-selected={isSelected}
                    disabled={isActive}
                  >
                    {/* Active indicator */}
                    <span className="w-3 shrink-0 text-center">
                      {isActive && (
                        <span className="inline-block h-2 w-2 rounded-full bg-primary" title="Current task" />
                      )}
                    </span>

                    {/* Task info */}
                    <div className="flex-1 min-w-0">
                      <span className="truncate block">{task.title}</span>
                    </div>

                    {/* Status badge */}
                    <span
                      className={cn(
                        "shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium",
                        task.status === "inprogress" && "bg-primary/15 text-primary",
                        task.status === "open" && "bg-muted text-muted-foreground",
                        task.status === "blocked" && "bg-destructive/15 text-destructive",
                      )}
                    >
                      {task.status}
                    </span>

                    {/* Estimated time */}
                    {task.estimatedMinutes != null && (
                      <span className="shrink-0 text-xs text-muted-foreground font-mono">
                        {formatTime(task.estimatedMinutes)}
                      </span>
                    )}
                  </button>
                );
              });

              return (
                <div key={group.project.id}>
                  {/* Project header */}
                  <div className="flex items-center gap-2 px-4 py-1.5">
                    <span
                      className="h-2 w-2 rounded-full shrink-0"
                      style={{ backgroundColor: group.project.color }}
                    />
                    <span className="text-xs font-semibold text-muted-foreground uppercase tracking-wider">
                      {group.project.name}
                    </span>
                  </div>
                  {groupItems}
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
