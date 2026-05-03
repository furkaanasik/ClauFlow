import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
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
import {
  broadcastTaskCreated,
  broadcastTaskDeleted,
  broadcastTaskUpdated,
} from "../services/wsService.js";
import {
  enqueue as enqueueExecutor,
  enqueueResume as enqueueExecutorResume,
  abort as abortExecutor,
  isRunning as isExecutorRunning,
  waitForIdle as waitForExecutorIdle,
} from "../agents/executor.js";
import { loadGraph } from "../services/graphService.js";
import { planGraph } from "../agents/graphRunner.js";
import { mergePr } from "../services/gitService.js";
import { stopCiWatch } from "../services/ciWatcher.js";

const router = Router();

const taskStatus = z.enum(["todo", "doing", "ci", "review", "done"]);
const taskPriority = z.enum(["low", "medium", "high", "critical"]);
const agentStatus = z.enum([
  "idle",
  "branching",
  "running",
  "pushing",
  "pr_opening",
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
});

const updateTaskSchema = z.object({
  title: z.string().min(1).optional(),
  description: z.string().optional(),
  analysis: z.string().optional(),
  priority: taskPriority.nullable().optional(),
  tags: z.array(z.string()).optional(),
  status: taskStatus.optional(),
  branch: z.string().nullable().optional(),
  prUrl: z.string().nullable().optional(),
  prNumber: z.number().nullable().optional(),
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
    const task = await createTask(parsed.data);
    broadcastTaskCreated(task);
    res.status(201).json({ task });
  } catch (err) {
    res.status(400).json({ error: errorMessage(err) });
  }
});

router.patch("/:id", async (req: Request, res: Response) => {
  const parsed = updateTaskSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    // Reset agent state immediately so queued tasks show "Sırada" instead of stale error
    const updateData =
      parsed.data.status === "doing"
        ? {
            ...parsed.data,
            agent: { status: "idle" as const, currentStep: undefined, log: [], error: null, startedAt: null, finishedAt: null },
          }
        : parsed.data;

    const task = await updateTask(req.params.id!, updateData);
    broadcastTaskUpdated(task);
    res.json({ task });

    // Stop CI watcher if task is being manually moved away from "ci"
    if (parsed.data.status && parsed.data.status !== "ci") {
      stopCiWatch(req.params.id!);
    }

    // Fire-and-forget: trigger executor when task moves to "doing"
    if (parsed.data.status === "doing") {
      const project = await getProject(task.projectId);
      if (project) {
        enqueueExecutor(task, project);
      }
    }

    if (parsed.data.status === "done") {
      const project = await getProject(task.projectId);
      if (project && task.prNumber) {
        mergePr(project.repoPath, task.prNumber)
          .then(async (result) => {
            if (result.code !== 0) {
              const errMsg = result.stderr || result.stdout || "unknown error";
              console.error(
                `[merger] pr merge failed for task ${task.id}:`,
                errMsg,
              );
              const rolled = await updateTask(task.id, {
                status: "review",
                agent: {
                  status: "error",
                  error: `PR merge hatası: ${errMsg}`,
                  finishedAt: new Date().toISOString(),
                },
              });
              broadcastTaskUpdated(rolled);
            } else {
              console.log(
                `[merger] merged PR #${task.prNumber} for task ${task.id}`,
              );
            }
          })
          .catch(async (err: unknown) => {
            const msg = err instanceof Error ? err.message : String(err);
            console.error("[merge] failed for task", task.id, msg);
            // task'ı review'a geri al, agent.status = error
            const rolled = await updateTask(task.id, {
              status: "review",
              agent: {
                status: "error",
                error: `PR merge hatası: ${msg}`,
                finishedAt: new Date().toISOString(),
              },
            });
            broadcastTaskUpdated(rolled);
          });
      }
    }
  } catch (err) {
    const msg = errorMessage(err);
    const code = msg.startsWith("Task not found") ? 404 : 400;
    res.status(code).json({ error: msg });
  }
});

router.post("/:id/retry", async (req: Request, res: Response) => {
  try {
    const task = await getTask(req.params.id!);
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "doing") {
      return res.status(400).json({ error: "task_not_in_doing" });
    }

    // If a claude run is currently in flight, kill it first and wait for the
    // run() catch+finally to unwind so we can re-enqueue cleanly. Without this,
    // the new enqueueExecutor call would block on acquireSlot waiting for the
    // old run to finish, leaving the user staring at "Sırada".
    if (isExecutorRunning(task.id)) {
      abortExecutor(task.id);
      await waitForExecutorIdle(task.id, 5000);
    }

    const reset = await updateTask(task.id, {
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
    if (project) enqueueExecutor(reset, project);
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

    if (isExecutorRunning(id)) {
      abortExecutor(id);
      return res.json({ aborted: true, source: "in_memory" });
    }

    // No live process for this task. If task is in "doing" state with no live
    // executor (orphan from a crashed/restarted run, or stuck-queued task),
    // force-rollback to todo+error so user can retry.
    if (task.status === "doing") {
      const rolled = await updateTask(id, {
        status: "todo",
        agent: {
          status: "error",
          currentStep: undefined,
          error: "Kullanıcı tarafından durduruldu (orphan task)",
          finishedAt: new Date().toISOString(),
        },
      });
      broadcastTaskUpdated(rolled);
      return res.json({ aborted: true, source: "orphan_cleanup" });
    }

    return res.status(409).json({ error: "task_not_running" });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/:id/nodes/:nodeId/abort", async (req: Request, res: Response) => {
  try {
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    const task = await getTask(id);
    if (!task) return res.status(404).json({ error: "not_found" });
    if (!isExecutorRunning(id)) {
      return res.status(409).json({ error: "task_not_running" });
    }
    const runs = listNodeRunsByTask(id);
    const live = runs.find((r) => r.nodeId === nodeId && r.status === "running");
    if (!live) return res.status(409).json({ error: "node_not_running" });
    abortExecutor(id);
    return res.json({ aborted: true, nodeId });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/:id/nodes/:nodeId/retry", async (req: Request, res: Response) => {
  try {
    const { id, nodeId } = req.params as { id: string; nodeId: string };
    const task = await getTask(id);
    if (!task) return res.status(404).json({ error: "not_found" });
    if (task.status !== "doing") {
      return res.status(400).json({ error: "task_not_in_doing" });
    }
    const project = await getProject(task.projectId);
    if (!project) return res.status(404).json({ error: "project_not_found" });

    const graph = loadGraph(project.repoPath);
    if (!graph || graph.nodes.length < 2) {
      return res.status(400).json({ error: "no_graph_use_task_retry" });
    }
    const plan = planGraph(graph);
    if (!plan.order.includes(nodeId)) {
      return res.status(400).json({ error: "node_not_in_graph" });
    }

    if (isExecutorRunning(id)) {
      abortExecutor(id);
      await waitForExecutorIdle(id, 5000);
    }

    const reset = await updateTask(id, {
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
    res.json({ task: reset, resumeFromNodeId: nodeId });
    enqueueExecutorResume(reset, project, { resumeFromNodeId: nodeId });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete("/:id", async (req: Request, res: Response) => {
  try {
    const id = req.params.id!;
    await deleteTask(id);
    broadcastTaskDeleted(id);
    res.status(204).end();
  } catch (err) {
    const msg = errorMessage(err);
    const code = msg.startsWith("Task not found") ? 404 : 400;
    res.status(code).json({ error: msg });
  }
});

export default router;
