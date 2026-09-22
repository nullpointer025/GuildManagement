import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { GatePage } from "./pages/GatePage";
import { RosterPage } from "./pages/RosterPage";
import { RaidsListPage } from "./pages/RaidsListPage";
import { RaidBuilderPage } from "./pages/RaidBuilderPage";

export default function App() {
  const init = useAuthStore((s) => s.init);

  useEffect(() => {
    init();
  }, [init]);

  return (
    <Routes>
      <Route path="/enter" element={<GatePage />} />
      <Route element={<ProtectedRoute />}>
        <Route path="/roster" element={<RosterPage />} />
        <Route path="/raids" element={<RaidsListPage />} />
        <Route path="/raids/:id" element={<RaidBuilderPage />} />
      </Route>
      <Route path="/" element={<Navigate to="/roster" replace />} />
      <Route path="*" element={<Navigate to="/roster" replace />} />
    </Routes>
  );
}
