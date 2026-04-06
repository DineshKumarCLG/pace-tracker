import { useState, useMemo } from "react";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import ProjectList from "./ProjectList";
import TaskList from "./TaskList";
import TaskDetail from "./TaskDetail";
import { useTaskStore } from "@/stores/taskStore";
import { useTasks } from "@/queries/tasks";

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 30_000,
      refetchOnWindowFocus: false,
    },
  },
});

function TasksContent() {
  const [selectedProjectId, setSelectedProjectId] = useState<string | null>(
    null,
  );
  const [selectedTaskId, setSelectedTaskId] = useState<string | null>(null);

  const { data: queryTasks = [] } = useTasks(selectedProjectId);
  const storeTasks = useTaskStore((s) => s.tasks);

  // Merge query + store tasks to find the selected task
  const allTasks = useMemo(() => {
    const queryIds = new Set(queryTasks.map((t) => t.id));
    const localOnly = storeTasks.filter((t) => !queryIds.has(t.id));
    return [...queryTasks, ...localOnly];
  }, [queryTasks, storeTasks]);

  const selectedTask = selectedTaskId
    ? allTasks.find((t) => t.id === selectedTaskId) ?? null
    : null;

  return (
    <div className="flex h-full flex-col">
      <div className="px-5 pt-4 pb-2">
        <h1 className="text-[22px] font-bold tracking-tight">Tasks</h1>
      </div>
      <div className="relative flex flex-1 gap-3 px-4 pb-4 overflow-hidden">
        <ProjectList
          selectedProjectId={selectedProjectId}
          onSelectProject={setSelectedProjectId}
        />
        <div className="flex flex-1 glass rounded-xl overflow-hidden relative">
          <TaskList
            projectId={selectedProjectId}
            onTaskClick={setSelectedTaskId}
          />
          {selectedTask && (
            <TaskDetail
              task={selectedTask}
              onClose={() => setSelectedTaskId(null)}
            />
          )}
        </div>
      </div>
    </div>
  );
}

export default function TasksScreen() {
  return (
    <QueryClientProvider client={queryClient}>
      <TasksContent />
    </QueryClientProvider>
  );
}
