import { useState, type FormEvent } from "react";
import { Link, useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AuthShell, Field, buttonClass, inputClass } from "../components/FormKit";

export function RegisterPage() {
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [inviteCode, setInviteCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setUser = useAuthStore((s) => s.setUser);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      const { user } = await api.register({ username, password, inviteCode });
      setUser(user);
      navigate("/roster");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Registration failed");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Officer Sign-up"
      subtitle="You'll need the guild invite code to create an account."
    >
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Username">
          <input
            value={username}
            onChange={(e) => setUsername(e.target.value)}
            autoFocus
            required
            minLength={3}
            maxLength={32}
            className={inputClass}
          />
        </Field>
        <Field label="Password">
          <input
            type="password"
            value={password}
            onChange={(e) => setPassword(e.target.value)}
            required
            minLength={8}
            className={inputClass}
          />
        </Field>
        <Field label="Guild invite code">
          <input
            value={inviteCode}
            onChange={(e) => setInviteCode(e.target.value)}
            required
            className={inputClass}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Creating account…" : "Create account"}
        </button>
      </form>
      <p className="mt-7 text-center text-base text-ink-dim">
        Already an officer?{" "}
        <Link to="/login" className="text-gold hover:underline">
          Sign in
        </Link>
      </p>
    </AuthShell>
  );
}
