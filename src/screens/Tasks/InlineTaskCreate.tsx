import { useState, useRef, useEffect } from "react";
import { Plus, ChevronDown, Sparkles, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useTaskStore } from "@/stores/taskStore";
import { useAuthStore } from "@/stores/authStore";
import { parseTask } from "@/lib/ai";
import { toast } from "sonner";
import type { Task } from "@/types";

type Priority = Task["priority"];

const priorityOptions: { value: Priority; label: string; color: string }[] = [
  { value: "high", label: "High", color: "bg-red-400" },
  { value: "medium", label: "Med", color: "bg-amber-400" },
  { value: "low", label: "Low", color: "bg-emerald-400" },
];

/**
 * Detect if input looks like natural language (vs. a simple task title).
 * NL indicators: contains action verbs directed at someone, or
 * combines a person name with a deadline/priority keyword.
 * Must match at least 2 patterns to be considered NL.
 */
function looksLikeNaturalLanguage(text: string): boolean {
  const nlPatterns = [
    /\b(remind|tell|ask|assign|schedule|set up)\b/i,  // directive verbs
    /\b(to|for)\s+[A-Z][a-z]+/,                       // "to Arjun", "for Priya"
    /\b(by|before|until|on)\s+(friday|monday|tuesday|wednesday|thursday|saturday|sunday|next|tomorrow)\b/i, // deadline
  ];
  const matchCount = nlPatterns.filter((p) => p.test(text)).length;
  return matchCount >= 2;
}

interface InlineTaskCreateProps {
  projectId: string | null;
}

export default function InlineTaskCreate({ projectId }: InlineTaskCreateProps) {
  const [isOpen, setIsOpen] = useState(false);
  const [title, setTitle] = useState("");
  const [priority, setPriority] = useState<Priority>("medium");
  const [showPriorityMenu, setShowPriorityMenu] = useState(false);
  const [isParsing, setIsParsing] = useState(false);
  const [pendingConfirm, setPendingConfirm] = useState(false);
  const [parsedAssigneeId, setParsedAssigneeId] = useState<string | null>(null);
  const [parsedProjectId, setParsedProjectId] = useState<string | null>(null);
  const [parsedDueDate, setParsedDueDate] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const priorityRef = useRef<HTMLDivElement>(null);
  const addTask = useTaskStore((s) => s.addTask);
  const userId = useAuthStore((s) => s.user?.id ?? "default-user");

  // Auto-focus input when row opens
  useEffect(() => {
    if (isOpen) {
      inputRef.current?.focus();
    }
  }, [isOpen]);

  // Close priority dropdown on outside click
  useEffect(() => {
    if (!showPriorityMenu) return;
    function handleClick(e: MouseEvent) {
      if (priorityRef.current && !priorityRef.current.contains(e.target as Node)) {
        setShowPriorityMenu(false);
      }
    }
    document.addEventListener("mousedown", handleClick);
    return () => document.removeEventListener("mousedown", handleClick);
  }, [showPriorityMenu]);

  function reset() {
    setTitle("");
    setPriority("medium");
    setShowPriorityMenu(false);
    setIsParsing(false);
    setPendingConfirm(false);
    setParsedAssigneeId(null);
    setParsedProjectId(null);
    setParsedDueDate(null);
    setIsOpen(false);
  }

  async function handleCreate() {
    const trimmed = title.trim();
    if (!trimmed) return;

    // If NL detected and not yet confirmed, parse first
    if (looksLikeNaturalLanguage(trimmed) && !pendingConfirm) {
      setIsParsing(true);
      try {
        // TODO: pass real projects/team from store when available
        const parsed = await parseTask(trimmed, [], []);
        setTitle(parsed.title);
        if (parsed.priority) setPriority(parsed.priority);
        setParsedAssigneeId(parsed.assigneeId);
        setParsedProjectId(parsed.projectId);
        setParsedDueDate(parsed.dueDate);
        setPendingConfirm(true);
      } catch {
        // Parsing failed — use raw text as title
        toast.info("AI parsing unavailable", {
          description: "Using your text as the task title.",
        });
        setPendingConfirm(true);
      } finally {
        setIsParsing(false);
      }
      return;
    }

    // Create the task (either direct or after NL confirmation)
    const resolvedProjectId = parsedProjectId ?? projectId ?? "proj-1";

    const now = Math.floor(Date.now() / 1000);
    const newTask: Task = {
      id: `task-${crypto.randomUUID()}`,
      projectId: resolvedProjectId,
      title: trimmed,
      status: "open",
      assigneeId: parsedAssigneeId,
      priority,
      dueDate: parsedDueDate ? Math.floor(new Date(parsedDueDate).getTime() / 1000) : null,
      estimatedMinutes: null,
      notes: null,
      createdBy: userId,
      createdAt: now,
      closedAt: null,
    };

    addTask(newTask);

    // Reset for next entry
    setTitle("");
    setPriority("medium");
    setPendingConfirm(false);
    setParsedAssigneeId(null);
    setParsedProjectId(null);
    setParsedDueDate(null);
    inputRef.current?.focus();
  }

  function handleKeyDown(e: React.KeyboardEvent) {
    if (e.key === "Enter") {
      e.preventDefault();
      handleCreate();
    } else if (e.key === "Escape") {
      e.preventDefault();
      reset();
    }
  }

  const currentPriority = priorityOptions.find((p) => p.value === priority)!;

  if (!isOpen) {
    return (
      <button
        onClick={() => setIsOpen(true)}
        className={cn(
          "btn-ghost flex items-center gap-1.5 rounded-lg px-2.5 py-1.5",
          "text-[12px] font-medium text-muted-foreground",
          "hover:text-foreground transition-colors mb-3",
        )}
      >
        <Plus className="h-3.5 w-3.5" />
        Add task
      </button>
    );
  }

  return (
    <div
      className={cn(
        "inset-well flex items-center gap-2 rounded-lg px-3 py-2 mb-3",
        "animate-slide-up",
      )}
    >
      {/* Title input */}
      <input
        ref={inputRef}
        type="text"
        value={title}
        onChange={(e) => setTitle(e.target.value)}
        onKeyDown={handleKeyDown}
        placeholder="Task title…"
        className={cn(
          "flex-1 bg-transparent text-[13px] font-medium",
          "placeholder:text-muted-foreground/50 outline-none",
        )}
      />

      {/* Priority selector */}
      <div ref={priorityRef} className="relative">
        <button
          onClick={() => setShowPriorityMenu((v) => !v)}
          className={cn(
            "flex items-center gap-1 rounded-md px-2 py-1",
            "text-[11px] font-medium text-muted-foreground",
            "hover:bg-accent/50 transition-colors",
          )}
        >
          <span className={cn("h-2 w-2 rounded-full", currentPriority.color)} />
          <span>{currentPriority.label}</span>
          <ChevronDown className="h-3 w-3 opacity-50" />
        </button>

        {showPriorityMenu && (
          <div className="glass-elevated absolute right-0 top-full mt-1 z-50 rounded-lg py-1 min-w-[100px] animate-scale-in">
            {priorityOptions.map((opt) => (
              <button
                key={opt.value}
                onClick={() => {
                  setPriority(opt.value);
                  setShowPriorityMenu(false);
                }}
                className={cn(
                  "flex w-full items-center gap-2 px-3 py-1.5 text-[12px]",
                  "hover:bg-accent/50 transition-colors",
                  opt.value === priority && "text-foreground font-medium",
                  opt.value !== priority && "text-muted-foreground",
                )}
              >
                <span className={cn("h-2 w-2 rounded-full", opt.color)} />
                {opt.label}
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Hint */}
      {isParsing ? (
        <span className="flex items-center gap-1 text-[10px] text-primary/60 select-none whitespace-nowrap">
          <Loader2 className="h-3 w-3 animate-spin" />
          Parsing…
        </span>
      ) : pendingConfirm ? (
        <span className="flex items-center gap-1 text-[10px] text-primary/60 select-none whitespace-nowrap">
          <Sparkles className="h-3 w-3" />
          ↵ confirm · esc cancel
        </span>
      ) : (
        <span className="text-[10px] text-muted-foreground/40 select-none whitespace-nowrap">
          ↵ create · esc cancel
        </span>
      )}
    </div>
  );
}
