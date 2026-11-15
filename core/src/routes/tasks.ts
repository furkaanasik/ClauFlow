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
import { getTaskDiff } from "../services/taskDiff.js";
import { uiLangSchema } from "../agents/uiText.js";
import { baseBranchExists, baseBranchHint } from "../services/baseBranch.js";
import { DependencyError, MAX_DEPENDENCIES, setDependencies } from "../services/dependencyService.js";
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
    const task = setDependencies(existing.id, parsed.data.dependsOn);
    broadcastTaskUpdated(task);
    res.json({ task });
  } catch (err) {
    if (err instanceof DependencyError) return res.status(err.httpStatus).json(err.toBody());
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

    // Reset agent state immediately so queued tasks show "Sırada" instead of stale error
    let updateData: TaskPatch =
      patch.status === "doing"
        ? {
            ...patch,
            agent: { status: "idle" as const, currentStep: undefined, log: [], error: null, startedAt: null, finishedAt: null },
          }
        : patch;

    // D1 / §3/5-6: only review → done merges, and it does so before answering.
    // A failed merge leaves the task where it was and returns 409 <code>.
    if (parsed.data.status === "done" && existing.status === "review") {
      const project = await getProject(existing.projectId);
      if (!project) return res.status(404).json({ error: "project_not_found" });
      const merge = await mergeTaskBranch(existing, project);
      if (!merge.ok) {
        console.warn(`[merge] task ${existing.displayId ?? existing.id}: ${merge.code}`, merge.detail ?? merge.files ?? "");
        if (merge.code !== "repo_busy") {
          await logLine(
            existing.id,
            merge.files?.length
              ? `✖ Merge conflict (${merge.files.join(", ")}); merge aborted, task stays in review`
              : `✖ Merge failed (${merge.code})${merge.detail ? `: ${merge.detail}` : ""}`,
          );
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

    // Fire-and-forget: trigger executor when task moves to "doing"
    if (parsed.data.status === "doing" && !isExecutorRunning(task.id)) {
      const project = await getProject(task.projectId);
      if (project) {
        enqueueExecutor(task, project, { uiLang });
      }
    }
  } catch (err) {
    if (err instanceof TeamServiceError) return res.status(400).json({ error: err.code });
    const msg = errorMessage(err);
    if (msg.startsWith("Task not found")) return res.status(404).json({ error: "not_found" });
    res.status(400).json({ error: msg });
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

    const reset = await updateTask(task.id, {
      status: "doing",
      agent: {
        status: "idle",
        currentStep: undefined,
        log: [],
        error: null,
        startedAt: null,
        finishedAt: null,
      },
    });
    broadcastTaskUpdated(reset);
    res.json({ task: reset });

    const project = await getProject(task.projectId);
    if (project) enqueueExecutor(reset, project, { uiLang: parsed.data.uiLang });
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

    const phase = executorRunPhase(id);
    if (phase) {
      abortExecutor(id);
      return res.json({ aborted: true, source: phase === "queued" ? "queued" : "in_memory" });
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
    await deleteTask(id);
    broadcastTaskDeleted(id);
    res.status(204).end();
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.startsWith("Task not found")) return res.status(404).json({ error: "not_found" });
    res.status(400).json({ error: msg });
  }
});

export default router;
