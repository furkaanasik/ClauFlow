import { commitAll, run as gitRun } from "../services/gitService.js";
import type { SkillCatalogRoots } from "../services/skillCatalogService.js";
import {
  appendAgentLog,
  getTaskEffectiveBudget,
  updateTask,
} from "../services/taskService.js";
import { resolveTeamForTask } from "../services/teamService.js";
import {
  createTeamRun,
  getLatestTeamRun,
  insertTeamArtifact,
  listTeamArtifactsByRun,
  updateTeamRun,
  type InsertTeamArtifactInput,
  type TeamRunPatch,
} from "../services/teamRunService.js";
import {
  broadcastLog,
  broadcastStatus,
  broadcastTaskUpdated,
  broadcastTeamArtifact,
  broadcastTeamRunUpdated,
} from "../services/wsService.js";
import type {
  Project,
  QaVerdict,
  RoleKind,
  Task,
  TeamArtifact,
  TeamArtifactKind,
  TeamRole,
  TeamRun,
} from "../types/index.js";
import { RoleRunError, runRole } from "./roleRunner.js";
import { extractSpecAcceptanceCriteria, isStalled, parseQaVerdict } from "./teamArtifacts.js";
import { buildRolePrompt, buildRoleSystemPrompt, loadRoleSkills } from "./teamPrompts.js";

export type TeamStopReason = "stalled" | "round_limit" | "budget";

interface OutcomeBase {
  run: TeamRun;
  /** Every agent text chunk of every role, for the legacy "## Code Review Report" auto-comment. */
  allText: string;
}

export type TeamOutcome =
  | (OutcomeBase & {
      kind: "delivered";
      summary: string;
      spec: string | null;
      qaVerdict: QaVerdict | null;
      qaReport: string | null;
    })
  | (OutcomeBase & { kind: "explored"; summary: string })
  | (OutcomeBase & { kind: "stuck"; reason: TeamStopReason; reasonText: string; summary: string })
  | (OutcomeBase & { kind: "awaiting_approval" });

export interface RunTeamOptions {
  task: Task;
  project: Project;
  controller: AbortController;
  /** Test hook: skill catalog roots (defaults to the real home/project/plugins). */
  skillRoots?: SkillCatalogRoots;
}

const ARTIFACT_KIND: Record<RoleKind, TeamArtifactKind> = {
  ceo: "brief",
  analyst: "spec",
  developer: "delivery",
  qa: "qa_report",
};

async function pushLog(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}

async function setRoleStep(taskId: string, kind: RoleKind): Promise<void> {
  const step = `team:${kind}`;
  const t = await updateTask(taskId, { agent: { status: "running", currentStep: step } });
  broadcastStatus(taskId, "running", step);
  broadcastTaskUpdated(t);
}

function patchRun(id: string, patch: TeamRunPatch): TeamRun {
  const run = updateTeamRun(id, patch);
  broadcastTeamRunUpdated(run);
  return run;
}

function addArtifact(input: InsertTeamArtifactInput): TeamArtifact {
  const artifact = insertTeamArtifact(input);
  broadcastTeamArtifact(artifact);
  return artifact;
}

function lastOfKind(artifacts: TeamArtifact[], kind: TeamArtifactKind): TeamArtifact | undefined {
  return [...artifacts].reverse().find((a) => a.kind === kind);
}

async function headSha(repo: string): Promise<string | null> {
  const r = await gitRun("git", ["rev-parse", "HEAD"], repo);
  return r.code === 0 ? r.stdout.trim() : null;
}

function stopReasonText(reason: TeamStopReason, info: { qaMaxRounds: number; spent: number; budget: number | null }): string {
  switch (reason) {
    case "stalled":
      return "QA arka arkaya iki kez esasen aynı hata listesini döndü";
    case "round_limit":
      return `QA tur sınırına ulaşıldı (${info.qaMaxRounds})`;
    case "budget":
      return `Bütçe aşıldı ($${info.spent.toFixed(2)} / $${(info.budget ?? 0).toFixed(2)})`;
  }
}

const OUTCOME_LABEL: Record<string, string> = {
  delivered: "Teslim edildi",
  explored: "Keşif tamamlandı",
  stuck: "Takıldı",
};

function roleLine(role: TeamRole, artifacts: TeamArtifact[]): string {
  const mine = artifacts.filter((a) => a.roleId === role.id && a.kind === ARTIFACT_KIND[role.kind]);
  const last = mine[mine.length - 1];
  if (!last) return `- ${role.name}: çalışmadı`;
  switch (role.kind) {
    case "ceo":
      return `- ${role.name}: brief yazdı`;
    case "analyst": {
      const acs = new Set(last.body.match(/\bAC-\d+\b/g) ?? []).size;
      return `- ${role.name}: şartname yazdı${acs ? ` (${acs} kabul kriteri)` : ""}`;
    }
    case "developer": {
      const commit = last.commitSha ? `, commit ${last.commitSha.slice(0, 7)}` : "";
      return `- ${role.name}: ${mine.length} teslim (son tur ${last.round}${commit})`;
    }
    case "qa":
      return `- ${role.name}: ${last.verdict === "pass" ? "PASS" : "FAIL"} (tur ${last.round})`;
  }
}

export function buildTeamSummary(
  run: TeamRun,
  artifacts: TeamArtifact[],
  outcome: "delivered" | "explored" | "stuck",
  reasonText?: string,
): string {
  const team = run.teamSnapshot;
  const qaRuns = artifacts.filter((a) => a.kind === "qa_report").length;
  const head = [
    `**Ekip:** ${team.name}`,
    `**Sonuç:** ${OUTCOME_LABEL[outcome]}${reasonText ? ` (${reasonText})` : ""}`,
    team.roles.some((r) => r.kind === "qa") ? `**QA turu:** ${qaRuns}` : null,
    `**Maliyet:** $${run.costUsd.toFixed(4)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = team.roles.map((r) => roleLine(r, artifacts));
  const work = artifacts.filter((a) => a.kind !== "summary" && a.kind !== "stuck");
  let tail: string;
  if (outcome === "explored") {
    tail = work.map((a) => a.body.trim()).join("\n\n---\n\n");
  } else {
    const last = work[work.length - 1];
    tail = last ? `### Son çıktı\n\n${last.body.trim()}` : "";
  }
  return [`## Ekip özeti`, head, lines.join("\n"), tail].filter(Boolean).join("\n\n");
}

export async function runTeam(opts: RunTeamOptions): Promise<TeamOutcome> {
  const { task, project, controller } = opts;
  const repo = project.repoPath;
  const base = project.defaultBranch;

  let run: TeamRun | null = null;
  let startIndex = 0;
  let brief: string | null = null;
  let spec: string | null = null;
  let resumed = false;

  const latest = getLatestTeamRun(task.id);
  if (latest?.status === "awaiting_approval") {
    const prior = listTeamArtifactsByRun(latest.id);
    const approvedSpec = lastOfKind(prior, "spec");
    if (approvedSpec?.approved) {
      run = patchRun(latest.id, { status: "running", finishedAt: null, stopReason: null });
      brief = lastOfKind(prior, "brief")?.body ?? null;
      spec = approvedSpec.body;
      startIndex = run.teamSnapshot.roles.findIndex((r) => r.kind === "analyst") + 1;
      resumed = true;
    } else {
      patchRun(latest.id, { status: "aborted", stopReason: "superseded", finishedAt: new Date().toISOString() });
    }
  }
  if (!run) {
    run = createTeamRun(task.id, resolveTeamForTask(task, project));
    broadcastTeamRunUpdated(run);
  }

  const team = run.teamSnapshot;
  const roles = team.roles;
  const solo = roles.length === 1 && roles[0]!.kind === "developer";
  const devIndex = roles.findIndex((r) => r.kind === "developer");
  const analystIndex = roles.findIndex((r) => r.kind === "analyst");
  const budget = getTaskEffectiveBudget(task.id);
  const qaMaxRounds = project.qaMaxRounds ?? 3;

  await pushLog(task.id, "");
  await pushLog(
    task.id,
    resumed
      ? `▸ Şartname onaylandı; ekip devam ediyor: ${team.name}`
      : `▸ Ekip: ${team.name} (${roles.map((r) => r.name).join(" → ")})`,
  );

  let delivery: string | null = null;
  let bugList: string | null = null;
  let prevBugs: string[] | null = null;
  let qaVerdict: QaVerdict | null = null;
  let qaReport: string | null = null;
  let allText = "";

  const runId = run.id;
  const current = (): TeamRun => run!;

  const finish = (outcome: "delivered" | "explored" | "stuck", reasonText?: string, stopReason?: TeamStopReason) => {
    run = patchRun(runId, {
      status: outcome,
      stopReason: stopReason ?? null,
      finishedAt: new Date().toISOString(),
    });
    if (outcome === "stuck") {
      const body = [`## Takıldı`, reasonText ?? "", bugList ? `### Son hata listesi\n\n${bugList}` : ""]
        .filter(Boolean)
        .join("\n\n");
      addArtifact({ runId, taskId: task.id, kind: "stuck", round: run.qaRound, body });
    }
    const summary = buildTeamSummary(run, listTeamArtifactsByRun(runId), outcome, reasonText);
    addArtifact({ runId, taskId: task.id, kind: "summary", round: run.qaRound, body: summary });
    return summary;
  };

  const stop = async (reason: TeamStopReason): Promise<TeamOutcome> => {
    const reasonText = stopReasonText(reason, { qaMaxRounds, spent: current().costUsd, budget });
    await pushLog(task.id, `✖ Takıldı: ${reasonText}`);
    const summary = finish("stuck", reasonText, reason);
    return { kind: "stuck", run: current(), reason, reasonText, summary, allText };
  };

  try {
    let i = startIndex;
    while (i < roles.length) {
      const role = roles[i]!;
      if (controller.signal.aborted) throw new RoleRunError("aborted", true);
      if (budget != null && current().costUsd >= budget) return await stop("budget");

      const round = current().qaRound + 1;
      await setRoleStep(task.id, role.kind);
      await pushLog(task.id, "");
      await pushLog(task.id, `▸ Rol: ${role.name} (${role.kind}, tur ${round}, model ${role.model})`);

      const { skills, missing } = await loadRoleSkills(role.skills, repo, opts.skillRoots);
      const system = buildRoleSystemPrompt(role, round, skills);
      if (system.skills.injected.length > 0) {
        await pushLog(task.id, `⚡ Skills injected: ${system.skills.injected.join(", ")}`);
      }
      if (missing.length > 0) await pushLog(task.id, `[warn] Skill bulunamadı: ${missing.join(", ")}`);
      if (system.skills.skipped.length > 0) {
        await pushLog(task.id, `[warn] Skill tavanı (60k) doldu, atlandı: ${system.skills.skipped.join(", ")}`);
      }

      let diff: string | null = null;
      if (role.kind === "qa") {
        const d = await gitRun("git", ["diff", `${base}...HEAD`], repo);
        diff = d.code === 0 ? d.stdout : null;
      }
      const prompt = buildRolePrompt(role, {
        task,
        project,
        round,
        solo,
        brief,
        spec,
        delivery,
        bugList,
        diff,
        baseBranch: base,
      });

      const headBefore = role.kind === "developer" ? await headSha(repo) : null;
      const out = await runRole({
        taskId: task.id,
        cwd: repo,
        signal: controller.signal,
        nodeId: `role:${role.kind}:${round}`,
        nodeType: role.kind,
        prompt,
        appendSystemPrompt: system.text,
        model: role.model,
        advisorModel: role.advisorModel,
        tools: role.tools,
        isolate: true,
        budgetUsd: budget,
        spentBeforeUsd: current().costUsd,
        inputArtifact: { roleId: role.id, round, team: team.name },
      });
      allText += (allText ? "\n" : "") + out.text;
      run = patchRun(runId, { costUsd: current().costUsd + out.costUsd });

      const artifactBase = {
        runId,
        taskId: task.id,
        roleId: role.id,
        roleKind: role.kind,
        kind: ARTIFACT_KIND[role.kind],
        round,
        body: out.finalText || "(boş çıktı)",
        nodeRunId: out.nodeRunId,
        costUsd: out.costUsd,
      };

      if (role.kind === "developer") {
        let commitSha: string | null = null;
        if (!out.budgetExceeded) {
          const ref = task.displayId;
          const msg =
            round === 1
              ? ref
                ? `feat(${ref}): ${task.title}`
                : `feat: ${task.title}`
              : ref
                ? `fix(${ref}): QA turu ${round}`
                : `fix: QA turu ${round}`;
          await pushLog(task.id, `▸ git commit: ${msg}`);
          const c = await commitAll(repo, msg);
          const nothing = c.code !== 0 && /nothing to commit|nothing added/i.test(c.stdout + c.stderr);
          if (c.code !== 0 && !nothing) throw new Error(`git commit failed:\n${c.stderr}`);
          if (nothing) await pushLog(task.id, "ℹ Yazılımcı değişiklik yapmadı (commit yok)");
          const after = await headSha(repo);
          commitSha = after && after !== headBefore ? after : null;
        }
        delivery = artifactBase.body;
        addArtifact({ ...artifactBase, commitSha });
      } else {
        const dirty = await gitRun("git", ["status", "--porcelain"], repo);
        if (dirty.code === 0 && dirty.stdout.trim()) {
          const label = `clauflow-discard-${role.kind}`;
          await gitRun("git", ["stash", "push", "-u", "-m", label], repo);
          await pushLog(task.id, `↺ ${role.name} çalışma ağacını değiştirdi; değişiklik stash'e alındı (${label})`);
        }
      }

      if (role.kind === "ceo") {
        brief = artifactBase.body;
        addArtifact(artifactBase);
      }

      if (role.kind === "analyst") {
        spec = artifactBase.body;
        addArtifact(artifactBase);
        const gate = !!project.specApproval && devIndex > i && !resumed && !out.budgetExceeded;
        if (gate) {
          run = patchRun(runId, { status: "awaiting_approval" });
          await pushLog(task.id, "⏸ Şartname onayı bekleniyor");
          return { kind: "awaiting_approval", run: current(), allText };
        }
      }

      if (role.kind === "qa") {
        const parsed = parseQaVerdict(artifactBase.body);
        qaVerdict = parsed.verdict;
        qaReport = artifactBase.body;
        addArtifact({ ...artifactBase, verdict: parsed.verdict });
        await pushLog(task.id, `▸ QA kararı: ${parsed.verdict === "pass" ? "PASS" : "FAIL"} (tur ${round})`);
        if (parsed.verdict === "fail") {
          if (!parsed.hadVerdict) await pushLog(task.id, "[warn] QA raporunda VERDICT satırı yok; FAIL sayıldı");
          run = patchRun(runId, { qaRound: current().qaRound + 1 });
          bugList = parsed.bugListText;
          if (out.budgetExceeded) return await stop("budget");
          if (qaMaxRounds > 0 && current().qaRound >= qaMaxRounds) return await stop("round_limit");
          if (prevBugs && isStalled(prevBugs, parsed.bugs)) return await stop("stalled");
          prevBugs = parsed.bugs;
          i = devIndex;
          continue;
        }
      }

      const isLast = i === roles.length - 1;
      if (out.budgetExceeded && !isLast) return await stop("budget");
      i++;
    }

    if (devIndex < 0) {
      const summary = finish("explored");
      await pushLog(task.id, "✓ Keşif tamamlandı");
      return { kind: "explored", run: current(), summary, allText };
    }
    const summary = finish("delivered");
    await pushLog(task.id, "✓ Ekip teslim etti");
    return { kind: "delivered", run: current(), summary, spec, qaVerdict, qaReport, allText };
  } catch (err) {
    const aborted = controller.signal.aborted || (err instanceof RoleRunError && err.aborted);
    const message = err instanceof Error ? err.message : String(err);
    try {
      patchRun(runId, {
        status: aborted ? "aborted" : "error",
        stopReason: aborted ? "aborted" : message.slice(0, 500),
        finishedAt: new Date().toISOString(),
      });
    } catch (e) {
      console.error(`[teamRunner] failed to mark run ${runId}:`, e);
    }
    throw err;
  }
}

/** PR body section: acceptance criteria from the spec and the QA result. */
export function buildPrTeamSection(outcome: Extract<TeamOutcome, { kind: "delivered" }>): string | null {
  const team = outcome.run.teamSnapshot;
  if (team.roles.length <= 1) return null;
  const parts = [`## Ekip\n**Ekip:** ${team.name} (${team.roles.map((r) => r.name).join(" → ")})`];
  const ac = extractSpecAcceptanceCriteria(outcome.spec);
  if (ac) parts.push(`### Kabul kriterleri\n${ac}`);
  if (outcome.qaVerdict) {
    parts.push(
      `### QA sonucu\n${outcome.qaVerdict === "pass" ? "PASS" : "FAIL"} · QA turu ${outcome.run.qaRound + 1}`,
    );
  }
  return parts.join("\n\n");
}
