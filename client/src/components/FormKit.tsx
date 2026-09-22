import type { ReactNode } from "react";

export const inputClass =
  "w-full rounded-lg border border-border bg-panel-alt px-4 py-2.5 text-base text-ink outline-none transition-colors focus:border-gold";

export const buttonClass =
  "w-full rounded-lg bg-gold px-4 py-2.5 text-base font-semibold text-bg transition-colors hover:bg-gold-bright disabled:cursor-not-allowed disabled:opacity-60";

export function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm font-medium uppercase tracking-wide text-ink-dim">{label}</span>
      {children}
    </label>
  );
}

export function AuthShell({
  title,
  subtitle,
  children,
}: {
  title: string;
  subtitle: string;
  children: ReactNode;
}) {
  return (
    <div className="flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-md rounded-2xl border border-border bg-panel p-10 shadow-2xl shadow-black/40">
        <div className="mb-8 text-center">
          <div className="mb-3 text-4xl">⚔</div>
          <h1 className="text-2xl font-bold text-heading">{title}</h1>
          <p className="mt-2 text-base text-ink-dim">{subtitle}</p>
        </div>
        {children}
      </div>
    </div>
  );
}
