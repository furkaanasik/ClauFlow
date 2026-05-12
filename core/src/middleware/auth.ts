import type { Request, Response, NextFunction } from "express";

const API_KEY = process.env.API_KEY?.trim() || null;

export function apiKeyAuth(req: Request, res: Response, next: NextFunction): void {
  if (!API_KEY) return next();
  if (req.path === "/health") return next();
  const provided = req.headers["x-api-key"];
  if (provided === API_KEY) return next();
  res.status(401).json({ error: "unauthorized" });
}
