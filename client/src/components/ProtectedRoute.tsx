import { Navigate, Outlet } from "react-router-dom";
import { useAuthStore } from "../store/auth";
import { Navbar } from "./Navbar";

export function ProtectedRoute() {
  const user = useAuthStore((s) => s.user);
  const checked = useAuthStore((s) => s.checked);

  if (!checked) {
    return <div className="flex h-screen items-center justify-center text-ink-dim">Loading…</div>;
  }
  if (!user) return <Navigate to="/login" replace />;

  return (
    <div className="min-h-screen">
      <Navbar />
      <main className="mx-auto max-w-[1600px] px-6 py-8">
        <Outlet />
      </main>
    </div>
  );
}
