import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AuthShell, Field, buttonClass, inputClass } from "../components/FormKit";

export function LoginPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user } = await api.login({ username, password });
      setUser(user);
      navigate("/roster");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Login failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Officer Login" subtitle="Sign in to manage the guild roster and raid teams.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Signing in…" : "Sign in"}
        </button>
      </form>
      <p className="mt-7 text-center text-base text-ink-dim">
        New officer?{" "}
        <Link to="/register" className="text-gold hover:underline">
          Create an account
        </Link>
      </p>
    </AuthShell>
  );
}
