import { useState, useEffect } from "react";
import {
  X,
  Circle,
  ArrowRight,
  Check,
  Ban,
  Calendar,
  User,
  Clock,
  GitBranch,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
import type { Task, GitEvent } from "@/types";

const statusIcons = {
  open: Circle,
  inprogress: ArrowRight,
  done: Check,
  blocked: Ban,
} as const;

const statusColors = {
  open: "text-muted-foreground",
  inprogress: "text-primary",
  done: "text-emerald-400",
  blocked: "text-destructive",
} as const;

const statusLabels = {
  open: "Open",
  inprogress: "In Progress",
  done: "Done",
  blocked: "Blocked",
} as const;

const priorityColors = {
  high: "bg-red-400",
  medium: "bg-amber-400",
  low: "bg-emerald-400",
} as const;

const priorityLabels = {
  high: "High",
  medium: "Medium",
  low: "Low",
} as const;

interface TaskDetailProps {
  task: Task;
  onClose: () => void;
  gitEvents?: GitEvent[];
}

export default function TaskDetail({ task, onClose, gitEvents = [] }: TaskDetailProps) {
  const updateTask = useTaskStore((s) => s.updateTask);
  const [notes, setNotes] = useState(task.notes ?? "");
  const [visible, setVisible] = useState(false);

  // Slide-in animation on mount
  useEffect(() => {
    const frame = requestAnimationFrame(() => setVisible(true));
    return () => cancelAnimationFrame(frame);
  }, []);

  // Sync notes when task changes
  useEffect(() => {
    setNotes(task.notes ?? "");
  }, [task.id, task.notes]);

  const handleClose = () => {
    setVisible(false);
    setTimeout(onClose, 200);
  };

  const handleMarkComplete = () => {
    updateTask(task.id, {
      status: "done",
      closedAt: Math.floor(Date.now() / 1000),
    });
  };

  const handleArchive = () => {
    updateTask(task.id, {
      closedAt: Math.floor(Date.now() / 1000),
      status: "done",
    });
  };

  const handleNotesBlur = () => {
    if (notes !== (task.notes ?? "")) {
      updateTask(task.id, { notes: notes || null });
    }
  };

  const StatusIcon = statusIcons[task.status];
  const dueDate = task.dueDate
    ? new Date(task.dueDate * 1000).toLocaleDateString()
    : "No due date";

  return (
    <div
      className={cn(
        "absolute inset-y-0 right-0 w-[380px] z-20 flex flex-col",
        "glass-elevated rounded-l-xl overflow-hidden",
        "transition-transform duration-200 ease-out",
        visible ? "translate-x-0" : "translate-x-full",
      )}
    >
      {/* Header */}
      <div className="flex items-center justify-between px-5 pt-4 pb-3 border-b border-border/50">
        <h3 className="text-[15px] font-bold tracking-tight truncate pr-3">
          {task.title}
        </h3>
        <button
          onClick={handleClose}
          className="shrink-0 p-1.5 rounded-lg hover:bg-accent/60 transition-colors"
          aria-label="Close task detail"
        >
          <X className="h-4 w-4 text-muted-foreground" />
        </button>
      </div>

      {/* Scrollable content */}
      <div className="flex-1 overflow-y-auto px-5 py-4 space-y-5">
        {/* Metadata grid */}
        <div className="grid grid-cols-2 gap-3">
          {/* Status */}
          <MetaField label="Status">
            <div className="flex items-center gap-1.5">
              <StatusIcon
                className={cn("h-3.5 w-3.5", statusColors[task.status])}
              />
              <span className="text-[13px]">{statusLabels[task.status]}</span>
            </div>
          </MetaField>

          {/* Priority */}
          <MetaField label="Priority">
            <div className="flex items-center gap-1.5">
              <span
                className={cn(
                  "h-2.5 w-2.5 rounded-full",
                  priorityColors[task.priority],
                )}
              />
              <span className="text-[13px]">{priorityLabels[task.priority]}</span>
            </div>
          </MetaField>

          {/* Assignee */}
          <MetaField label="Assignee">
            <div className="flex items-center gap-1.5">
              <User className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[13px]">
                {task.assigneeId ?? "Unassigned"}
              </span>
            </div>
          </MetaField>

          {/* Due date */}
          <MetaField label="Due Date">
            <div className="flex items-center gap-1.5">
              <Calendar className="h-3.5 w-3.5 text-muted-foreground" />
              <span className="text-[13px]">{dueDate}</span>
            </div>
          </MetaField>
        </div>

        {/* Time logged */}
        <section>
          <SectionLabel icon={Clock} label="Time Logged" />
          <div className="inset-well rounded-lg p-3 mt-1.5">
            <div className="grid grid-cols-3 gap-2 text-center">
              <TimeBlock label="Total" value={formatMinutes(task.estimatedMinutes)} />
              <TimeBlock label="Today" value="0m" />
              <TimeBlock label="Sessions" value="0" />
            </div>
          </div>
        </section>

        {/* Notes */}
        <section>
          <SectionLabel label="Notes" />
          <textarea
            value={notes}
            onChange={(e) => setNotes(e.target.value)}
            onBlur={handleNotesBlur}
            placeholder="Add notes…"
            className={cn(
              "inset-well w-full rounded-lg p-3 mt-1.5",
              "text-[13px] text-foreground placeholder:text-muted-foreground/50",
              "resize-none min-h-[80px] outline-none focus:ring-1 focus:ring-primary/30",
            )}
            rows={3}
          />
        </section>

        {/* Session history */}
        <section>
          <SectionLabel icon={Clock} label="Session History" />
          <div className="inset-well rounded-lg p-3 mt-1.5">
            <p className="text-[12px] text-muted-foreground text-center py-2">
              No sessions recorded yet
            </p>
          </div>
        </section>

        {/* Git context — commits during sessions where this task was active */}
        <section>
          <SectionLabel icon={GitBranch} label="Git Context" />
          <div className="inset-well rounded-lg p-3 mt-1.5">
            {gitEvents.length === 0 ? (
              <p className="text-[12px] text-muted-foreground text-center py-2">
                No git commits linked to this task
              </p>
            ) : (
              <div className="space-y-1.5">
                {gitEvents.map((event) => (
                  <div key={event.id} className="flex items-start gap-2">
                    <GitBranch className="h-3 w-3 mt-0.5 shrink-0 text-primary/60" />
                    <div className="min-w-0 flex-1">
                      <p className="text-[12px] text-foreground truncate">
                        {event.message ?? "No message"}
                      </p>
                      <p className="text-[10px] text-muted-foreground/60">
                        {new Date(event.commitTime * 1000).toLocaleString([], {
                          month: "short",
                          day: "numeric",
                          hour: "2-digit",
                          minute: "2-digit",
                        })}
                      </p>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </section>
      </div>

      {/* Actions footer */}
      <div className="flex items-center gap-2 px-5 py-3 border-t border-border/50">
        {task.status !== "done" && (
          <button
            onClick={handleMarkComplete}
            className="btn-3d flex-1 rounded-lg px-4 py-2 text-[13px] font-semibold"
          >
            Mark Complete
          </button>
        )}
        <button
          onClick={handleArchive}
          className="btn-ghost flex-1 rounded-lg px-4 py-2 text-[13px] font-medium text-foreground"
        >
          Archive
        </button>
      </div>
    </div>
  );
}

function MetaField({
  label,
  children,
}: {
  label: string;
  children: React.ReactNode;
}) {
  return (
    <div>
      <span className="text-[11px] font-medium uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
      <div className="mt-0.5">{children}</div>
    </div>
  );
}

function SectionLabel({
  icon: Icon,
  label,
}: {
  icon?: React.ComponentType<{ className?: string }>;
  label: string;
}) {
  return (
    <div className="flex items-center gap-1.5">
      {Icon && <Icon className="h-3.5 w-3.5 text-muted-foreground" />}
      <span className="text-[11px] font-semibold uppercase tracking-widest text-muted-foreground">
        {label}
      </span>
    </div>
  );
}

function TimeBlock({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-[15px] font-bold tabular-nums">{value}</div>
      <div className="text-[10px] text-muted-foreground">{label}</div>
    </div>
  );
}

function formatMinutes(minutes: number | null): string {
  if (minutes == null) return "0m";
  if (minutes < 60) return `${minutes}m`;
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return m > 0 ? `${h}h ${m}m` : `${h}h`;
}
