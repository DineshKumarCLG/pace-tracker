import { useAuthStore } from "@/stores/authStore";
import { isAdmin } from "@/lib/roles";

export default function AdminGuard({ children }: { children: React.ReactNode }) {
  const role = useAuthStore((s) => s.user?.role ?? "");
  if (!isAdmin(role)) {
    return (
      <div className="flex h-full items-center justify-center text-muted-foreground">
        <p className="text-sm">Admin access required</p>
      </div>
    );
  }
  return <>{children}</>;
}
