import { create } from "zustand";
import type { Task } from "@/types";

interface TaskState {
  activeTaskId: string | null;
  tasks: Task[];
}

interface TaskActions {
  setActiveTask: (taskId: string | null) => void;
  updateTaskList: (tasks: Task[]) => void;
  addTask: (task: Task) => void;
  updateTask: (taskId: string, updates: Partial<Task>) => void;
  removeTask: (taskId: string) => void;
}

export const useTaskStore = create<TaskState & TaskActions>((set) => ({
  activeTaskId: null,
  tasks: [],

  setActiveTask: (taskId) => set({ activeTaskId: taskId }),
  updateTaskList: (tasks) => set({ tasks }),
  addTask: (task) => set((state) => ({ tasks: [...state.tasks, task] })),
  updateTask: (taskId, updates) =>
    set((state) => ({
      tasks: state.tasks.map((t) =>
        t.id === taskId ? { ...t, ...updates } : t
      ),
    })),
  removeTask: (taskId) =>
    set((state) => ({
      tasks: state.tasks.filter((t) => t.id !== taskId),
      activeTaskId:
        state.activeTaskId === taskId ? null : state.activeTaskId,
    })),
}));
