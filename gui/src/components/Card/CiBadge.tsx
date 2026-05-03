"use client";

interface CiBadgeProps {
  iteration: number;       // current fix iteration (0 = first poll, no fix yet)
  maxIterations: number;   // CI_MAX_FIX_ITERATIONS from env (default 3)
  lastConclusion: "pass" | "fail" | "pending";
}

export function CiBadge({ iteration, maxIterations, lastConclusion }: CiBadgeProps) {
  const isPulse = lastConclusion === "pending";
  
  let label = "CI · checking";
  let color = "var(--text-muted)";
  let dotColor = "var(--text-muted)";

  if (lastConclusion === "pass") {
    label = "CI · passing";
    color = "var(--accent-primary)";
    dotColor = "var(--accent-primary)";
  } else if (lastConclusion === "fail") {
    label = `CI · fail ${iteration}/${maxIterations}`;
    color = "var(--status-error)";
    dotColor = "var(--status-error)";
  } else if (iteration > 0) {
    label = `CI · fix ${iteration}/${maxIterations}`;
  }

  // Override dot color if iteration > 0 and pending to use CI status color
  if (lastConclusion === "pending") {
    dotColor = "var(--status-ci, var(--status-review))";
  }

  return (
    <div
      className="inline-flex items-center gap-1.5 border border-[var(--border)] px-2 py-1 font-mono text-[10px] uppercase tracking-widest transition"
      style={{ color }}
    >
      {isPulse ? (
        <span className="flex items-center gap-0.5">
          <span className="h-1 w-1 animate-dot-1" style={{ background: dotColor }} />
          <span className="h-1 w-1 animate-dot-2" style={{ background: dotColor }} />
          <span className="h-1 w-1 animate-dot-3" style={{ background: dotColor }} />
        </span>
      ) : (
        <span className="h-1 w-1" style={{ background: dotColor }} />
      )}
      <span>{label}</span>
    </div>
  );
}
