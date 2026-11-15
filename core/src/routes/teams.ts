import { Router, type Request, type Response } from "express";
import { z, ZodError } from "zod";
import {
  createTeam,
  deleteTeam,
  getTeam,
  listTeams,
  teamDescriptionSchema,
  teamNameSchema,
  teamRolesSchema,
  TeamServiceError,
  updateTeam,
} from "../services/teamService.js";
import { errorMessage } from "../utils/error.js";

const router = Router();

const createTeamSchema = z
  .object({
    name: teamNameSchema,
    description: teamDescriptionSchema.optional(),
    projectId: z.string().min(1).nullable(),
    roles: teamRolesSchema.optional(),
    fromTeamId: z.string().min(1).optional(),
  })
  .refine((v) => v.roles !== undefined || v.fromTeamId !== undefined, {
    message: "roles_or_fromTeamId_required",
    path: ["roles"],
  });

const updateTeamSchema = z.object({
  name: teamNameSchema.optional(),
  description: teamDescriptionSchema.optional(),
  roles: teamRolesSchema.optional(),
});

const TEAM_ERROR_STATUS: Record<TeamServiceError["code"], number> = {
  not_found: 404,
  builtin_readonly: 403,
  team_in_use: 409,
  invalid_team: 400,
  project_not_found: 404,
};

function sendError(res: Response, err: unknown) {
  if (err instanceof TeamServiceError) {
    return res.status(TEAM_ERROR_STATUS[err.code]).json({ error: err.code });
  }
  if (err instanceof ZodError) {
    return res.status(400).json({ error: "invalid_body", issues: err.issues });
  }
  return res.status(500).json({ error: errorMessage(err) });
}

router.get("/", (req: Request, res: Response) => {
  try {
    const projectId = typeof req.query.projectId === "string" ? req.query.projectId : null;
    res.json({ teams: listTeams(projectId) });
  } catch (err) {
    sendError(res, err);
  }
});

router.get("/:id", (req: Request, res: Response) => {
  try {
    const team = getTeam(req.params.id!);
    if (!team) return res.status(404).json({ error: "not_found" });
    res.json({ team });
  } catch (err) {
    sendError(res, err);
  }
});

router.post("/", (req: Request, res: Response) => {
  const parsed = createTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    res.status(201).json({ team: createTeam(parsed.data) });
  } catch (err) {
    sendError(res, err);
  }
});

router.put("/:id", (req: Request, res: Response) => {
  const parsed = updateTeamSchema.safeParse(req.body);
  if (!parsed.success) {
    return res.status(400).json({ error: "invalid_body", issues: parsed.error.issues });
  }
  try {
    res.json({ team: updateTeam(req.params.id!, parsed.data) });
  } catch (err) {
    sendError(res, err);
  }
});

router.delete("/:id", (req: Request, res: Response) => {
  try {
    deleteTeam(req.params.id!);
    res.status(204).end();
  } catch (err) {
    sendError(res, err);
  }
});

export default router;
