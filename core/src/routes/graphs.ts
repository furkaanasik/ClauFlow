import { Router, type Request, type Response } from "express";
import { z } from "zod";
import {
  listGraphs,
  getGraph,
  createGraph,
  updateGraph,
  deleteGraph,
  getProject,
} from "../services/taskService.js";
import { errorMessage } from "../utils/error.js";

const router = Router({ mergeParams: true });

const agentGraphNodeSchema = z.object({
  id: z.string(),
  type: z.literal("agent"),
  position: z.object({ x: z.number(), y: z.number() }),
  data: z.object({ slug: z.string() }),
});

const agentGraphEdgeSchema = z.object({
  id: z.string(),
  source: z.string(),
  target: z.string(),
});

const agentGraphSchema = z.object({
  nodes: z.array(agentGraphNodeSchema),
  edges: z.array(agentGraphEdgeSchema),
});

const createGraphSchema = z.object({
  name: z.string().min(1),
  data: agentGraphSchema.optional(),
});

const updateGraphSchema = z.object({
  name: z.string().min(1).optional(),
  data: agentGraphSchema.optional(),
});

router.get("/", async (req: Request, res: Response) => {
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "project_not_found" });
    const graphs = listGraphs(project.id);
    res.json({ graphs });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.post("/", async (req: Request, res: Response) => {
  const parsed = createGraphSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const project = await getProject(req.params.id!);
    if (!project) return res.status(404).json({ error: "project_not_found" });
    const graph = createGraph({ projectId: project.id, name: parsed.data.name, data: parsed.data.data });
    res.status(201).json({ graph });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.put("/:graphId", async (req: Request, res: Response) => {
  const parsed = updateGraphSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    const existing = getGraph(req.params.graphId!);
    if (!existing || existing.projectId !== req.params.id!) {
      return res.status(404).json({ error: "not_found" });
    }
    const graph = updateGraph(req.params.graphId!, parsed.data);
    res.json({ graph });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

router.delete("/:graphId", async (req: Request, res: Response) => {
  try {
    const existing = getGraph(req.params.graphId!);
    if (!existing || existing.projectId !== req.params.id!) {
      return res.status(404).json({ error: "not_found" });
    }
    deleteGraph(req.params.graphId!);
    res.status(204).send();
  } catch (err) {
    const msg = errorMessage(err);
    if (msg.includes("Cannot delete the default graph")) {
      return res.status(400).json({ error: msg });
    }
    res.status(500).json({ error: msg });
  }
});

export default router;
