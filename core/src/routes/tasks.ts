import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  appendAgentLog,
  createTask,
  deleteTask,
  getAgentTexts,
  getTask,
  getProject,
  listNodeRunsByTask,
  listTasks,
  listToolCallsByTask,
  updateTask,
} from "../services/taskService.js";
import { errorMessage } from "../utils/error.js";
import { assertTeamUsableByProject, TeamServiceError } from "../services/teamService.js";
import {
  broadcastLog,
  broadcastStashCreated,
  broadcastTaskCreated,
  broadcastTaskDeleted,
  broadcastTaskUpdated,
} from "../services/wsService.js";
import type { TaskPatch } from "../services/taskService.js";
import {
  enqueue as enqueueExecutor,
  abort as abortExecutor,
  isRunning as isExecutorRunning,
  runPhase as executorRunPhase,
  waitForIdle as waitForExecutorIdle,
} from "../agents/executor.js";
import {
  getLatestTeamRun,
  listTeamArtifactsByRun,
  listTeamArtifactsByTask,
  listTeamRunsByTask,
  updateTeamArtifact,
  updateTeamRun,
} from "../services/teamRunService.js";
import { broadcastTeamArtifact, broadcastTeamRunUpdated } from "../services/wsService.js";
import { mergeTaskBranch } from "../services/mergeService.js";
import { runTaskBreakdown } from "../agents/taskBreakdownRunner.js";
import { branchExists, getTaskDiff } from "../services/taskDiff.js";
import { uiLangSchema } from "../agents/uiText.js";
import { baseBranchExists, baseBranchHint } from "../services/baseBranch.js";
import {
  DependencyError,
  listDependents,
  MAX_DEPENDENCIES,
  setDependencies,
  unmetDependencies,
} from "../services/dependencyService.js";
import { abortWaiting, gateDoing, tryStartWaiting } from "../services/chainService.js";
import {
  abortResolution,
  baseDrift,
  isConflictResolving,
  onMergeConflict,
  requestResolution,
  resolverPhase,
} from "../agents/conflictResolver.js";
import { existsSync } from "node:fs";
import type { Project } from "../types/index.js";

/**
 * zincir F0.5 (plan §5.0): a read-only check before a task is queued. Returns
 * the repo's current branch hint when the project's base branch is missing,
 * null when it exists (or the repo path is not there; the executor reports that).
 */
async function missingBaseBranch(project: Project | null | undefined): Promise<string | null> {
  if (!project || !project.repoPath || !existsSync(project.repoPath)) return null;
  if (await baseBranchExists(project.repoPath, project.defaultBranch)) return null;
  return baseBranchHint(project.repoPath);
}

const router = Router();

async function logLine(taskId: string, line: string): Promise<void> {
  await appendAgentLog(taskId, line);
  broadcastLog(taskId, line);
}

const taskStatus = z.enum(["todo", "doing", "review", "done"]);
const taskPriority = z.enum(["low", "medium", "high", "critical"]);
const agentStatus = z.enum([
  "idle",
  "branching",
  "running",
  "pushing",
  "pr_opening",
  "awaiting_approval",
  "waiting_deps",
  "resolving_conflict",
  "done",
  "error",
]);

const createTaskSchema = z.object({
  projectId: z.string().min(1),
  title: z.string().min(1),
  description: z.string().optional(),
  analysis: z.string().optional(),
  priority: taskPriority.optional(),
  tags: z.array(z.string()).optional(),
  status: taskStatus.optional(),
  parentTaskId: z.string().nullable().optional(),
  teamId: z.string().min(1).nullable().optional(),
  dependsOn: z.array(z.string().min(1)).max(MAX_DEPENDENCIES).optional(),
});

const dependenciesSchema = z.object({
  dependsOn: z.array(z.string().min(1)).max(MAX_DEPENDENCIES),
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  analysis: z.string().optional(),
  priority: taskPriority.nullable().optional(),
  tags: z.array(z.string()).optional(),
  status: taskStatus.optional(),
  branch: z
    .string()
    .regex(/^[a-zA-Z0-9._\/-]+$/, "invalid branch name")
    .nullable()
    .optional(),
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
  budgetUsd: z.number().min(0.1).nullable().optional(),
  parentTaskId: z.string().nullable().optional(),
  teamId: z.string().min(1).nullable().optional(),
  uiLang: uiLangSchema.optional(),
  agent: z
    .object({
      status: agentStatus.optional(),
      currentStep: z.string().optional(),
      log: z.array(z.string()).optional(),
      error: z.string().nullable().optional(),
      startedAt: z.string().nullable().optional(),
      finishedAt: z.string().nullable().optional(),
    })
    .optional(),
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const { projectId } = req.query as { projectId?: string };
    if (!projectId) {
      return res.status(400).json({ error: "project_id_required" });
    }
    const tasks = await listTasks(projectId);
    res.json({ tasks });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    res.json({ task });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/tool-calls", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    const toolCalls = listToolCallsByTask(task.id);
    res.json({ toolCalls });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/node-runs", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    const nodeRuns = listNodeRunsByTask(task.id);
    res.json({ nodeRuns });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/diff", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    const project = await getProject(task.projectId);
    if (!project) return res.status(404).json({ error: "project_not_found" });
    const result = await getTaskDiff(task, project);
    if (!result.ok) {
      return res
        .status(result.code === "no_branch" ? 404 : 500)
        .json({ error: result.code, ...(result.detail ? { detail: result.detail } : {}) });
    }
    res.json(result.diff);
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/agent-texts", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    const agentTexts = getAgentTexts(task.id);
    res.json({ agentTexts });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    if (parsed.data.teamId) assertTeamUsableByProject(parsed.data.teamId, parsed.data.projectId);
    const task = await createTask(parsed.data);
    broadcastTaskCreated(task);
    res.status(201).json({ task });
  } catch (err) {
    if (err instanceof TeamServiceError) return res.status(400).json({ error: err.code });
    if (err instanceof DependencyError) return res.status(err.httpStatus).json(err.toBody());
    const msg = errorMessage(err);
    if (msg.startsWith("Project not found")) return res.status(404).json({ error: "project_not_found" });
    res.status(400).json({ error: msg });
  }
});

// zincir (plan §3/8, §5.2): replace the task's whole dependency set. Only a
// `todo` or waiting task can change its edges; the service checks the rest.
router.put("/:id/dependencies", async (req: Request, res: Response) => {
  const parsed = dependenciesSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const existing = await getTask(req.params.id!);
    if (!existing) return res.status(404).json({ error: "not_found" });
    const updated = setDependencies(existing.id, parsed.data.dependsOn);
    broadcastTaskUpdated(updated);
    // A waiting task whose last unmet dependency was removed starts now (§3/8).
    const started = updated.agent.status === "waiting_deps" ? tryStartWaiting(updated.id) : null;
    res.json({ task: started ?? updated });
  } catch (err) {
    if (err instanceof DependencyError) return res.status(err.httpStatus).json(err.toBody());
    res.status(500).json({ error: errorMessage(err) });
  }
});

// zincir (plan §3/25, E5): the user's "Start" for a waiting task whose
// dependencies are all done (e.g. met while core was down; boot never starts it).
router.post("/:id/start-waiting", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "doing" || task.agent.status !== "waiting_deps") {
      return res.status(409).json({ error: "not_waiting" });
    }
    const unmet = unmetDependencies(task.id);
    if (unmet.length > 0) {
      return res
        .status(409)
        .json({ error: "dependencies_unmet", unmet: unmet.map((t) => t.displayId ?? t.id) });
    }
    const started = tryStartWaiting(task.id);
    // Lost the race to another trigger: it is no longer waiting.
    if (!started) return res.status(409).json({ error: "not_waiting" });
    res.json({ task: started });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const existing = await getTask(req.params.id!);
    if (!existing) return res.status(404).json({ error: "not_found" });
    const { uiLang, ...patch } = parsed.data;
    // zincir F4.6 (§3/42, Z38): while the conflict resolver works on the
    // branch, no status move (Done included: no merge attempt), no agent or
    // branch rewrite. Title / description edits do not touch git and pass.
    if (
      isConflictResolving(existing) &&
      ((patch.status !== undefined && patch.status !== existing.status) ||
        patch.agent !== undefined ||
        (patch.branch !== undefined && patch.branch !== existing.branch))
    ) {
      return res.status(409).json({ error: "conflict_resolving" });
    }
    // D4: a finished task's team is part of its history.
    if (patch.teamId !== undefined && existing.status === "done" && patch.teamId !== existing.teamId) {
      return res.status(409).json({ error: "task_done" });
    }
    if (patch.teamId) assertTeamUsableByProject(patch.teamId, existing.projectId);

    // zincir F0.5: never queue a run whose base branch is not in the repo.
    if (patch.status === "doing" && existing.status !== "doing") {
      const current = await missingBaseBranch(await getProject(existing.projectId));
      if (current !== null) return res.status(422).json({ error: "base_branch_missing", current });
    }

    // zincir (plan §3/5): every entry into Doing passes the gate. With an
    // unmet dependency the task waits (no run, no repo lock); otherwise the
    // agent state is reset so a queued task shows "Sırada", and the run queues.
    if (patch.status === "doing") {
      const { status: _status, agent: _agent, ...rest } = patch;
      if (Object.keys(rest).length > 0) await updateTask(existing.id, rest);
      const gate = gateDoing(existing.id, uiLang);
      broadcastTaskUpdated(gate.task);
      res.json({ task: gate.task });
      if (gate.kind === "start" && !isExecutorRunning(gate.task.id)) {
        const project = await getProject(gate.task.projectId);
        if (project) enqueueExecutor(gate.task, project, { uiLang });
      }
      return;
    }

    let updateData: TaskPatch = patch;

    // D1 / §3/5-6: only review → done merges, and it does so before answering.
    // A failed merge leaves the task where it was and returns 409 <code>.
    if (parsed.data.status === "done" && existing.status === "review") {
      const project = await getProject(existing.projectId);
      if (!project) return res.status(404).json({ error: "project_not_found" });
      const merge = await mergeTaskBranch(existing, project);
      // zincir E6 (§3/28): the stash outlives a failed merge too.
      if (merge.stash) {
        broadcastStashCreated(existing.id, {
          projectId: project.id,
          label: merge.stash,
          reason: "merge",
          displayId: existing.displayId ?? null,
        });
      }
      if (!merge.ok) {
        console.warn(`[merge] task ${existing.displayId ?? existing.id}: ${merge.code}`, merge.detail ?? merge.files ?? "");
        // zincir F4.6 (§3/32, C1): a conflict starts one automatic resolver
        // run (unless the previous one failed); the 409 says which.
        if (merge.code === "merge_conflict") {
          const files = merge.files ?? [];
          await logLine(
            existing.id,
            files.length
              ? `✖ Merge conflict (${files.join(", ")}); merge aborted, task stays in review`
              : `✖ Merge conflict (PR #${existing.prNumber ?? "?"}); task stays in review`,
          );
          const { resolving } = await onMergeConflict(existing, project, files, uiLang);
          return res.status(409).json({
            error: "merge_conflict",
            files,
            resolving,
            ...(merge.detail ? { detail: merge.detail } : {}),
          });
        }
        if (merge.code !== "repo_busy") {
          await logLine(existing.id, `✖ Merge failed (${merge.code})${merge.detail ? `: ${merge.detail}` : ""}`);
          const errTask = await updateTask(existing.id, {
            agent: { status: "error", error: merge.code, finishedAt: new Date().toISOString() },
          });
          broadcastTaskUpdated(errTask);
        }
        return res.status(409).json({
          error: merge.code,
          ...(merge.files ? { files: merge.files } : {}),
          ...(merge.detail ? { detail: merge.detail } : {}),
        });
      }
      if (merge.mode === "local") {
        await logLine(
          existing.id,
          `✓ Merged ${existing.branch} into ${project.defaultBranch} (--no-ff ${merge.mergeCommit?.slice(0, 7) ?? ""})${merge.branchDeleted ? `, branch deleted` : ""}`,
        );
      } else if (merge.mode === "pr") {
        await logLine(existing.id, `✓ PR #${existing.prNumber} merged, branch deleted`);
      }
      if (merge.stash) await logLine(existing.id, `ℹ Dirty working tree stashed as "${merge.stash}"`);
      if (merge.note && merge.mode !== "skipped") await logLine(existing.id, `[warn] ${merge.note}`);
      updateData = {
        ...updateData,
        ...(merge.branchDeleted ? { branch: null } : {}),
        agent: { ...updateData.agent, status: "done", error: null },
      };
    }

    const task = await updateTask(existing.id, updateData);
    broadcastTaskUpdated(task);
    res.json({ task });
  } catch (err) {
    if (err instanceof TeamServiceError) return res.status(400).json({ error: err.code });
    const msg = errorMessage(err);
    if (msg.startsWith("Task not found")) return res.status(404).json({ error: "not_found" });
    res.status(400).json({ error: msg });
  }
});

// zincir F4.6 (§3/46, §5.10): the drawer's "Resolve with AI" (`conflict`) and
// "Update branch" (`update`). Same resolver flow as the automatic trigger.
const resolveSchema = z.object({
  mode: z.enum(["conflict", "update"]).default("conflict"),
  uiLang: uiLangSchema.optional(),
});

router.post("/:id/resolve", async (req: Request, res: Response) => {
  const parsed = resolveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "review") return res.status(409).json({ error: "task_not_in_review" });
    if (isConflictResolving(task)) return res.status(409).json({ error: "conflict_resolving" });
    const project = await getProject(task.projectId);
    if (!project) return res.status(404).json({ error: "project_not_found" });
    if (!task.branch || !(await branchExists(project.repoPath, task.branch))) {
      return res.status(409).json({ error: "no_branch" });
    }
    // §3/39: nothing new on the base → nothing to update; git untouched.
    if (parsed.data.mode === "update" && (await baseDrift(task, project)).behind === 0) {
      return res.status(409).json({ error: "branch_up_to_date" });
    }
    const queued = await requestResolution(task, parsed.data);
    res.status(202).json({ task: queued });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

// zincir F4.6 (§3/46): how far the base moved since the branch left it.
// Read-only, no fetch, no lock.
router.get("/:id/base-drift", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    const project = await getProject(task.projectId);
    if (!project) return res.status(404).json({ error: "project_not_found" });
    res.json(await baseDrift(task, project));
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

const retrySchema = z.object({ uiLang: uiLangSchema.optional() });

router.post("/:id/retry", async (req: Request, res: Response) => {
  const parsed = retrySchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "doing") {
      return res.status(400).json({ error: "task_not_in_doing" });
    }
    {
      const current = await missingBaseBranch(await getProject(task.projectId));
      if (current !== null) return res.status(422).json({ error: "base_branch_missing", current });
    }

    // Kill the live (or queued) run and give it a moment to unwind. If it is
    // slower than that, the new run simply queues behind it on the repo lock;
    // run tokens keep the old run's late finally from touching the new one.
    if (isExecutorRunning(task.id)) {
      abortExecutor(task.id);
      await waitForExecutorIdle(task.id, 5000);
    }

    // zincir (plan §3/5): a retry passes the gate too; a task whose
    // dependencies are not done goes (back) to waiting.
    const gate = gateDoing(task.id, parsed.data.uiLang);
    broadcastTaskUpdated(gate.task);
    res.json({ task: gate.task });

    if (gate.kind === "start") {
      const project = await getProject(task.projectId);
      if (project) enqueueExecutor(gate.task, project, { uiLang: parsed.data.uiLang });
    }
  } catch (err) {
    const msg = errorMessage(err);
    res.status(500).json({ error: msg });
  }
});

router.post("/:id/abort", async (req: Request, res: Response) => {
  try {
    const id = req.params.id!;
    const task = await getTask(id);
    if (!task) return res.status(404).json({ error: "not_found" });

    // zincir F4.6 (§3/42): the conflict resolver first. Queued: the lock wait
    // drops out, git untouched; running: the run restores the branch (§3/40).
    // The run writes `conflict_unresolved:aborted` itself.
    if (resolverPhase(id)) {
      abortResolution(id);
      return res.json({ aborted: true, source: "resolver" });
    }
    // Persisted "resolving" state without a run in this process (lost to a
    // restart before boot recovery): close it the way the run would.
    if (task.status === "review" && task.agent.status === "resolving_conflict") {
      const rolled = await updateTask(id, {
        agent: {
          status: "error",
          currentStep: undefined,
          error: "conflict_unresolved:aborted",
          finishedAt: new Date().toISOString(),
        },
      });
      broadcastTaskUpdated(rolled);
      return res.json({ aborted: true, source: "resolver" });
    }

    const phase = executorRunPhase(id);
    if (phase) {
      abortExecutor(id);
      return res.json({ aborted: true, source: phase === "queued" ? "queued" : "in_memory" });
    }

    // zincir (plan §3/10): a task waiting for its dependencies has no run and
    // no lock; it goes back to todo without touching git or team runs.
    if (task.status === "doing" && task.agent.status === "waiting_deps") {
      const rolled = abortWaiting(id);
      if (rolled) {
        broadcastTaskUpdated(rolled);
        return res.json({ aborted: true, source: "waiting" });
      }
      // It started between the read and the write: abort the fresh run.
      if (executorRunPhase(id)) {
        abortExecutor(id);
        return res.json({ aborted: true, source: "queued" });
      }
    }

    // No live process for this task. A task paused for spec approval, or an
    // orphan "doing" task (crashed/restarted run, stuck-queued), is rolled back
    // to todo+error so the user can retry.
    if (task.status === "doing") {
      const paused = task.agent.status === "awaiting_approval";
      const run = getLatestTeamRun(id);
      if (run && (run.status === "awaiting_approval" || run.status === "running")) {
        broadcastTeamRunUpdated(
          updateTeamRun(run.id, {
            status: "aborted",
            stopReason: "aborted",
            finishedAt: new Date().toISOString(),
          }),
        );
      }
      const rolled = await updateTask(id, {
        status: "todo",
        agent: {
          status: "error",
          currentStep: undefined,
          error: paused ? "aborted_while_awaiting_approval" : "aborted_orphan",
          finishedAt: new Date().toISOString(),
        },
      });
      broadcastTaskUpdated(rolled);
      return res.json({ aborted: true, source: paused ? "awaiting_approval" : "orphan_cleanup" });
    }

    return res.status(409).json({ error: "task_not_running" });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.get("/:id/team", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    res.json({ runs: listTeamRunsByTask(task.id), artifacts: listTeamArtifactsByTask(task.id) });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

const approveSchema = z.object({
  specBody: z.string().trim().min(1).max(100_000).optional(),
  uiLang: uiLangSchema.optional(),
});

router.post("/:id/team/approve", async (req: Request, res: Response) => {
  const parsed = approveSchema.safeParse(req.body ?? {});
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    const run = getLatestTeamRun(task.id);
    if (
      task.status !== "doing" ||
      task.agent.status !== "awaiting_approval" ||
      run?.status !== "awaiting_approval" ||
      isExecutorRunning(task.id)
    ) {
      return res.status(409).json({ error: "not_awaiting_approval" });
    }
    const spec = [...listTeamArtifactsByRun(run.id)].reverse().find((a) => a.kind === "spec");
    if (!spec) return res.status(409).json({ error: "spec_missing" });
    const project = await getProject(task.projectId);
    if (!project) return res.status(404).json({ error: "project_not_found" });

    const approved = updateTeamArtifact(spec.id, {
      approved: true,
      ...(parsed.data.specBody ? { body: parsed.data.specBody } : {}),
    });
    broadcastTeamArtifact(approved);

    const reset = await updateTask(task.id, {
      agent: { status: "idle", currentStep: undefined, error: null, finishedAt: null },
    });
    broadcastTaskUpdated(reset);
    res.json({ task: reset, artifact: approved });
    enqueueExecutor(reset, project, { uiLang: parsed.data.uiLang });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

const breakdownSchema = z.object({
  prompt: z.string().min(1).max(6000),
  maxTasks: z.number().int().min(1).max(20).optional(),
  uiLang: uiLangSchema.optional(),
});

router.post("/:id/breakdown", async (req: Request, res: Response) => {
  const task = await getTask(req.params.id!).catch(() => null);
  if (!task) return res.status(404).json({ error: "task_not_found" });
  // D4: a finished task is history; a running one belongs to the executor.
  if (task.status === "done") return res.status(409).json({ error: "task_done" });
  if (task.status === "doing") return res.status(409).json({ error: "task_running" });
  // zincir E3 (plan §3/23): closing a reviewed parent as done would skip its
  // merge and orphan its branch.
  if (task.status === "review") return res.status(409).json({ error: "task_in_review" });

  const parsed = breakdownSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }

  runTaskBreakdown(task.id, parsed.data.prompt, parsed.data.maxTasks ?? 6, parsed.data.uiLang)
    .catch((err) => console.error("[tasks] breakdown failed:", err));

  res.json({ status: "started" });
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id!;
    // zincir F4.6 (§3/42, Z38): never delete a task whose branch the resolver is working on.
    const existing = await getTask(id);
    if (existing && isConflictResolving(existing)) {
      return res.status(409).json({ error: "conflict_resolving" });
    }
    const dependents = listDependents(id);
    await deleteTask(id);
    broadcastTaskDeleted(id);
    res.status(204).end();
    // zincir (plan §5.3): a dependent waiting only on the deleted task starts.
    // Its edge is gone (CASCADE), so the deps payload changed for all of them.
    for (const depId of dependents) {
      if (!tryStartWaiting(depId)) {
        const fresh = await getTask(depId);
        if (fresh) broadcastTaskUpdated(fresh);
      }
    }
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.startsWith("Task not found")) return res.status(404).json({ error: "not_found" });
    res.status(400).json({ error: msg });
  }
});

export default router;
