import { z } from "zod";
import { run } from "./gitService.js";
import type { CiFailure, CiFailureArtifact, CiVerdict } from "../types/index.js";

const LOG_TAIL_MAX = 4000;

const checkSchema = z.object({
  name: z.string(),
  bucket: z.string(),
  link: z.string().nullable().optional(),
});

const checksArraySchema = z.array(checkSchema);

// gh pr checks --json returns bucket: "pass"|"fail"|"cancel"|"skipping"|"pending"|"waiting"|"error"
const FAIL_BUCKETS = new Set(["fail", "cancel", "error"]);
const PASS_BUCKETS = new Set(["pass", "skipping"]);

export function parseChecksJson(raw: string): CiVerdict {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return { kind: "pending" };
  }

  const result = checksArraySchema.safeParse(parsed);
  if (!result.success) return { kind: "pending" };

  const checks = result.data;
  if (checks.length === 0) return { kind: "no_checks" };

  const failures: CiFailure[] = [];

  for (const check of checks) {
    const bucket = (check.bucket ?? "").toLowerCase();
    if (FAIL_BUCKETS.has(bucket)) {
      failures.push({
        jobName: check.name,
        conclusion: bucket === "cancel" ? "CANCELLED" : "FAILURE",
        link: check.link ?? null,
        logTail: null,
      });
    } else if (!PASS_BUCKETS.has(bucket)) {
      return { kind: "pending" };
    }
  }

  if (failures.length > 0) return { kind: "fail", failures };
  return { kind: "pass" };
}

function extractRunId(link: string | null): string | null {
  if (!link) return null;
  const match = link.match(/\/actions\/runs\/(\d+)/);
  return match?.[1] ?? null;
}

export async function fetchFailedLogs(
  repoPath: string,
  failures: CiFailure[],
): Promise<Map<string, string>> {
  const logMap = new Map<string, string>();
  const runIds = new Set<string>();

  for (const f of failures) {
    const id = extractRunId(f.link);
    if (id) runIds.add(id);
  }

  for (const runId of runIds) {
    try {
      const result = await run("gh", ["run", "view", runId, "--log-failed"], repoPath);
      if (result.code === 0 && result.stdout.trim()) {
        logMap.set(runId, result.stdout.slice(-LOG_TAIL_MAX));
      }
    } catch {
      // timeout or gh error — log tail stays absent
    }
  }

  return logMap;
}

export function buildFailureArtifact(
  prNumber: number,
  iteration: number,
  failures: CiFailure[],
  logsByRunId: Map<string, string>,
): CiFailureArtifact {
  const enriched = failures.map((f) => {
    const runId = extractRunId(f.link);
    return { ...f, logTail: runId ? (logsByRunId.get(runId) ?? null) : null };
  });

  return {
    prNumber,
    iteration,
    failures: enriched,
    capturedAt: new Date().toISOString(),
  };
}
