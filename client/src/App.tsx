import { useEffect } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuthStore } from "./store/auth";
import { ProtectedRoute } from "./components/ProtectedRoute";
import { LoginPage } from "./pages/LoginPage";
import { RegisterPage } from "./pages/RegisterPage";
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
      <Route path="/login" element={<LoginPage />} />
      <Route path="/register" element={<RegisterPage />} />
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
