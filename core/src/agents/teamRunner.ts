import { commitAll, run as gitRun, shieldNoiseDirs } from "../services/gitService.js";
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
import { RoleRunError, RoleTimeoutError, roleTimeoutMs, runRole } from "./roleRunner.js";
import { extractSpecAcceptanceCriteria, isStalled, parseQaVerdict } from "./teamArtifacts.js";
import { buildRolePrompt, buildRoleSystemPrompt, loadRoleSkills } from "./teamPrompts.js";
import { formatUsd, uiText, type UiLang, type UiText } from "./uiText.js";

export type TeamStopReason = "stalled" | "round_limit" | "budget" | "timeout";

interface OutcomeBase {
  run: TeamRun;
}

type TeamOutcome =
  | (OutcomeBase & {
      kind: "delivered";
      summary: string;
      spec: string | null;
      qaVerdict: QaVerdict | null;
      qaReport: string | null;
    })
  | (OutcomeBase & { kind: "explored"; summary: string })
  | (OutcomeBase & {
      kind: "stuck";
      reason: TeamStopReason;
      reasonText: string;
      summary: string;
      /** `agent.error` code when it is not `stuck_<reason>` (E7a: `role_timeout:<kind>`). */
      code?: string;
    })
  | (OutcomeBase & { kind: "awaiting_approval" });

interface RunTeamOptions {
  task: Task;
  project: Project;
  controller: AbortController;
  /** Test hook: skill catalog roots (defaults to the real home/project/plugins). */
  skillRoots?: SkillCatalogRoots;
  /** GUI language for the summary, stop reasons and stuck artifact (default en). */
  uiLang?: UiLang;
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

/** Drops this run's `clauflow-discard-<runId>-…` stashes, newest index last. */
async function dropRunStashes(taskId: string, repo: string, runId: string): Promise<void> {
  const list = await gitRun("git", ["stash", "list", "--format=%gd%x09%s"], repo);
  if (list.code !== 0) return;
  const prefix = `clauflow-discard-${runId}-`;
  const refs = list.stdout
    .split("\n")
    .map((line) => line.split("\t"))
    .filter(([ref, subject]) => ref && subject?.includes(prefix))
    .map(([ref]) => ref!)
    .sort((a, b) => stashIndex(b) - stashIndex(a));
  for (const ref of refs) await gitRun("git", ["stash", "drop", ref], repo);
  if (refs.length > 0) await pushLog(taskId, `↺ Koşunun ${refs.length} discard stash'i düşürüldü`);
}

function stashIndex(ref: string): number {
  return Number(/\{(\d+)\}/.exec(ref)?.[1] ?? -1);
}

function stopReasonText(
  reason: TeamStopReason,
  info: { qaMaxRounds: number; spent: number; budget: number | null; role?: string; timeoutMs?: number },
  tx: UiText,
): string {
  switch (reason) {
    case "stalled":
      return tx.stopStalled;
    case "round_limit":
      return tx.stopRoundLimit(info.qaMaxRounds);
    case "budget":
      return tx.stopBudget(info.spent, info.budget ?? 0);
    case "timeout":
      return tx.stopTimeout(info.role ?? "?", info.timeoutMs ?? roleTimeoutMs());
  }
}

function roleLine(role: TeamRole, artifacts: TeamArtifact[], tx: UiText): string {
  const mine = artifacts.filter((a) => a.roleId === role.id && a.kind === ARTIFACT_KIND[role.kind]);
  const last = mine[mine.length - 1];
  if (!last) return `- ${role.name}: ${tx.roleDidNotRun}`;
  switch (role.kind) {
    case "ceo":
      return `- ${role.name}: ${tx.roleBrief}`;
    case "analyst":
      return `- ${role.name}: ${tx.roleSpec(new Set(last.body.match(/\bAC-\d+\b/g) ?? []).size)}`;
    case "developer":
      return `- ${role.name}: ${tx.roleDelivery(mine.length, last.round, last.commitSha?.slice(0, 7) ?? null)}`;
    case "qa":
      return `- ${role.name}: ${tx.roleQa(last.verdict === "pass" ? "PASS" : "FAIL", last.round)}`;
  }
}

function buildTeamSummary(
  run: TeamRun,
  artifacts: TeamArtifact[],
  outcome: "delivered" | "explored" | "stuck",
  reasonText?: string,
  lang?: UiLang,
): string {
  const tx = uiText(lang);
  const team = run.teamSnapshot;
  const qaRuns = artifacts.filter((a) => a.kind === "qa_report").length;
  const head = [
    `**${tx.team}:** ${team.name}`,
    `**${tx.outcome}:** ${tx.outcomeLabel[outcome]}${reasonText ? ` (${reasonText})` : ""}`,
    team.roles.some((r) => r.kind === "qa") ? `**${tx.qaRounds}:** ${qaRuns}` : null,
    `**${tx.cost}:** ${formatUsd(run.costUsd, 4)}`,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines = team.roles.map((r) => roleLine(r, artifacts, tx));
  const work = artifacts.filter((a) => a.kind !== "summary" && a.kind !== "stuck");
  let tail: string;
  if (outcome === "explored") {
    tail = work.map((a) => a.body.trim()).join("\n\n---\n\n");
  } else {
    const last = work[work.length - 1];
    tail = last ? `${tx.lastOutput}\n\n${last.body.trim()}` : "";
  }
  return [tx.summaryTitle, head, lines.join("\n"), tail].filter(Boolean).join("\n\n");
}

export async function runTeam(opts: RunTeamOptions): Promise<TeamOutcome> {
  const { task, project, controller } = opts;
  const tx = uiText(opts.uiLang);
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

  const runId = run.id;
  const current = (): TeamRun => run!;

  const finish = (outcome: "delivered" | "explored" | "stuck", reasonText?: string, stopReason?: TeamStopReason) => {
    run = patchRun(runId, {
      status: outcome,
      stopReason: stopReason ?? null,
      finishedAt: new Date().toISOString(),
    });
    if (outcome === "stuck") {
      const body = [tx.stuckTitle, reasonText ?? "", bugList ? `${tx.lastBugList}\n\n${bugList}` : ""]
        .filter(Boolean)
        .join("\n\n");
      addArtifact({ runId, taskId: task.id, kind: "stuck", round: run.qaRound, body });
    }
    const summary = buildTeamSummary(run, listTeamArtifactsByRun(runId), outcome, reasonText, opts.uiLang);
    addArtifact({ runId, taskId: task.id, kind: "summary", round: run.qaRound, body: summary });
    return summary;
  };

  const stop = async (reason: TeamStopReason, extra: { role?: string; code?: string } = {}): Promise<TeamOutcome> => {
    const reasonText = stopReasonText(reason, { qaMaxRounds, spent: current().costUsd, budget, role: extra.role }, tx);
    await pushLog(task.id, `✖ Takıldı: ${reasonText}`);
    const summary = finish("stuck", reasonText, reason);
    return { kind: "stuck", run: current(), reason, reasonText, summary, ...(extra.code ? { code: extra.code } : {}) };
  };
  /** Role being run; names the role in the timeout stop text. */
  let activeRole: TeamRole | null = null;

  try {
    let i = startIndex;
    while (i < roles.length) {
      const role = roles[i]!;
      activeRole = role;
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
        budgetContext: {
          taskTitle: task.title,
          displayId: task.displayId ?? null,
          projectId: project.id,
          projectName: project.name,
        },
        inputArtifact: { roleId: role.id, round, team: team.name },
      });
      run = patchRun(runId, { costUsd: current().costUsd + out.costUsd });

      const artifactBase = {
        runId,
        taskId: task.id,
        roleId: role.id,
        roleKind: role.kind,
        kind: ARTIFACT_KIND[role.kind],
        round,
        body: out.finalText || tx.emptyOutput,
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
        // Shield (§3/10): a role's `npm install` is excluded locally instead of
        // going into the discard stash (which `dropRunStashes` deletes).
        const shielded = await shieldNoiseDirs(repo);
        if (shielded.length > 0) await pushLog(task.id, `[kanban] ignored locally: ${shielded.join(" ")}`);
        const dirty = await gitRun("git", ["status", "--porcelain"], repo);
        if (dirty.code === 0 && dirty.stdout.trim()) {
          const label = `clauflow-discard-${runId}-${role.kind}-${round}`;
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
          return { kind: "awaiting_approval", run: current() };
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

      // A3: a role that ran over budget stops the run whatever its position —
      // otherwise a last-role developer's half-done work would be delivered.
      // The only exception is a QA turn that passed: the work is verified.
      const qaPassed = role.kind === "qa" && qaVerdict === "pass";
      if (out.budgetExceeded && !qaPassed) return await stop("budget");
      i++;
    }

    // A8c: a finished run no longer needs the edits its non-developer roles
    // made; stuck/error runs keep them for inspection.
    await dropRunStashes(task.id, repo, runId);
    if (devIndex < 0) {
      const summary = finish("explored");
      await pushLog(task.id, "✓ Keşif tamamlandı");
      return { kind: "explored", run: current(), summary };
    }
    const summary = finish("delivered");
    await pushLog(task.id, "✓ Ekip teslim etti");
    return { kind: "delivered", run: current(), summary, spec, qaVerdict, qaReport };
  } catch (err) {
    // E7a: a role that ran out of time ends the run as stuck (wip commit, branch
    // kept), not as an error (reset --hard would drop the developer's work).
    // A user abort wins over a timeout.
    if (err instanceof RoleTimeoutError && !controller.signal.aborted) {
      return await stop("timeout", { role: activeRole?.name ?? err.roleKind, code: err.message });
    }
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
export function buildPrTeamSection(
  outcome: Extract<TeamOutcome, { kind: "delivered" }>,
  lang?: UiLang,
): string | null {
  const tx = uiText(lang);
  const team = outcome.run.teamSnapshot;
  if (team.roles.length <= 1) return null;
  const parts = [`${tx.prTeamTitle}\n**${tx.team}:** ${team.name} (${team.roles.map((r) => r.name).join(" → ")})`];
  const ac = extractSpecAcceptanceCriteria(outcome.spec);
  if (ac) parts.push(`${tx.prAcceptance}\n${ac}`);
  if (outcome.qaVerdict) {
    parts.push(
      `${tx.prQaResult}\n${outcome.qaVerdict === "pass" ? "PASS" : "FAIL"} · ${tx.prQaRound(outcome.run.qaRound + 1)}`,
    );
  }
  return parts.join("\n\n");
}
