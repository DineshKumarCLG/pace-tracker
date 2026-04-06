import { useQuery } from "@tanstack/react-query";
import type { Project } from "@/types";

/** Mock projects — replace with Tauri IPC when Rust backend is connected. */
const MOCK_PROJECTS: Project[] = [
  {
    id: "proj-1",
    name: "PACE App",
    color: "#d97706",
    createdBy: "u-arjun",
    createdAt: 1700000000,
    archivedAt: null,
  },
  {
    id: "proj-2",
    name: "Marketing Site",
    color: "#6366f1",
    createdBy: "u-sam",
    createdAt: 1700100000,
    archivedAt: null,
  },
  {
    id: "proj-3",
    name: "API Gateway",
    color: "#10b981",
    createdBy: "u-priya",
    createdAt: 1700200000,
    archivedAt: null,
  },
];

export function useProjects() {
  return useQuery<Project[]>({
    queryKey: ["projects"],
    queryFn: async () => {
      // TODO: Replace with Tauri IPC when Rust backend is connected
      return MOCK_PROJECTS;
    },
  });
}

export function useProject(projectId: string | null) {
  return useQuery<Project | null>({
    queryKey: ["projects", projectId],
    queryFn: async () => {
      if (!projectId) return null;
      // TODO: Replace with Tauri IPC when Rust backend is connected
      return MOCK_PROJECTS.find((p) => p.id === projectId) ?? null;
    },
    enabled: !!projectId,
  });
}
