import { useQuery } from "@tanstack/react-query";
import type { Task } from "@/types";

/** Mock tasks — replace with Tauri IPC when Rust backend is connected. */
const MOCK_TASKS: Task[] = [
  {
    id: "task-1",
    projectId: "proj-1",
    title: "Implement leave balance computation",
    status: "done",
    assigneeId: "u-arjun",
    priority: "high",
    dueDate: null,
    estimatedMinutes: 120,
    notes: null,
    createdBy: "u-arjun",
    createdAt: Date.now() / 1000 - 86400 * 5,
    closedAt: Date.now() / 1000 - 86400 * 2,
  },
  {
    id: "task-2",
    projectId: "proj-1",
    title: "Build attendance log screen",
    status: "inprogress",
    assigneeId: "u-arjun",
    priority: "high",
    dueDate: null,
    estimatedMinutes: 180,
    notes: null,
    createdBy: "u-arjun",
    createdAt: Date.now() / 1000 - 86400 * 3,
    closedAt: null,
  },
  {
    id: "task-3",
    projectId: "proj-1",
    title: "Wire dashboard realtime subscriptions",
    status: "inprogress",
    assigneeId: "u-priya",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: 90,
    notes: null,
    createdBy: "u-priya",
    createdAt: Date.now() / 1000 - 86400 * 2,
    closedAt: null,
  },
  {
    id: "task-4",
    projectId: "proj-2",
    title: "Design landing page hero section",
    status: "done",
    assigneeId: "u-sam",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: 60,
    notes: null,
    createdBy: "u-sam",
    createdAt: Date.now() / 1000 - 86400 * 7,
    closedAt: Date.now() / 1000 - 86400 * 4,
  },
  {
    id: "task-5",
    projectId: "proj-1",
    title: "Add workspace proof photo capture",
    status: "open",
    assigneeId: "u-priya",
    priority: "high",
    dueDate: null,
    estimatedMinutes: 150,
    notes: null,
    createdBy: "u-arjun",
    createdAt: Date.now() / 1000 - 86400,
    closedAt: null,
  },
  {
    id: "task-6",
    projectId: "proj-3",
    title: "Set up Caddy reverse proxy for SSL",
    status: "open",
    assigneeId: "u-mika",
    priority: "medium",
    dueDate: null,
    estimatedMinutes: 90,
    notes: null,
    createdBy: "u-mika",
    createdAt: Date.now() / 1000 - 86400 * 2,
    closedAt: null,
  },
  {
    id: "task-7",
    projectId: "proj-1",
    title: "Property test for session proof enforcement",
    status: "done",
    assigneeId: "u-arjun",
    priority: "low",
    dueDate: null,
    estimatedMinutes: 45,
    notes: null,
    createdBy: "u-arjun",
    createdAt: Date.now() / 1000 - 86400 * 4,
    closedAt: Date.now() / 1000 - 86400,
  },
  {
    id: "task-8",
    projectId: "proj-2",
    title: "Responsive layout for mobile preview",
    status: "inprogress",
    assigneeId: "u-sam",
    priority: "low",
    dueDate: null,
    estimatedMinutes: 120,
    notes: null,
    createdBy: "u-sam",
    createdAt: Date.now() / 1000 - 86400 * 3,
    closedAt: null,
  },
];

export function useTasks(projectId?: string | null) {
  return useQuery<Task[]>({
    queryKey: ["tasks", projectId ?? "all"],
    queryFn: async () => {
      // TODO: Replace with Tauri IPC when Rust backend is connected
      if (projectId) {
        return MOCK_TASKS.filter((t) => t.projectId === projectId);
      }
      return MOCK_TASKS;
    },
  });
}

export function useTasksByProject(projectId: string) {
  return useTasks(projectId);
}
