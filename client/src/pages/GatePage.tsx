import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { api, ApiError } from "../api/client";
import { useAuthStore } from "../store/auth";
import { AuthShell, Field, buttonClass, inputClass } from "../components/FormKit";

export function GatePage() {
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const setUnlocked = useAuthStore((s) => s.setUnlocked);
  const navigate = useNavigate();

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    setError(null);
    setLoading(true);
    try {
      await api.enter(code);
      setUnlocked(true);
      navigate("/roster");
    } catch (err) {
      setError(err instanceof ApiError ? err.message : "Couldn't enter, please try again");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell title="Guild Manager" subtitle="Enter the guild invite code to access the roster and raid teams.">
      <form onSubmit={handleSubmit} className="flex flex-col gap-5">
        <Field label="Guild invite code">
          <input
            value={code}
            onChange={(e) => setCode(e.target.value)}
            autoFocus
            required
            className={inputClass}
          />
        </Field>
        {error && <p className="text-sm text-danger">{error}</p>}
        <button type="submit" disabled={loading} className={buttonClass}>
          {loading ? "Checking…" : "Enter"}
        </button>
      </form>
    </AuthShell>
  );
}
