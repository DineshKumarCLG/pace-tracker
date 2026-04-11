import { useAuthStore } from "@/stores/authStore";
import { isFounder } from "@/lib/roles";

export default function FounderGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role ?? "");
  if (!isFounder(role)) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Founders only</p>
      </div>
    );
  }
  return <>{children}</>;
}
