import http from "node:http";
import cors from "cors";
import express from "express";
import tasksRouter from "./routes/tasks.js";
import graphsRouter from "./routes/graphs.js";
import projectsRouter from "./routes/projects.js";
import projectsClaudeRouter from "./routes/projectsClaude.js";
import projectsGithubRouter from "./routes/projectsGithub.js";
import authRouter from "./routes/auth.js";
import githubRouter from "./routes/github.js";
import commentsRouter from "./routes/comments.js";
import pricingRouter from "./routes/pricing.js";
import systemRouter from "./routes/system.js";
import insightsRouter from "./routes/insights.js";
import { attachWebSocket, closeWebSocket } from "./services/wsService.js";
import { recoverOrphanedTasks } from "./services/taskService.js";

const PORT = Number(process.env.PORT ?? 3001);
const HOST = process.env.HOST ?? "127.0.0.1";

const ALLOWED_ORIGINS = (
  process.env.ALLOWED_ORIGINS ?? "http://localhost:3000,http://127.0.0.1:3000"
)
  .split(",")
  .map((s) => s.trim());

const app = express();
app.use(cors({ origin: ALLOWED_ORIGINS, credentials: true }));
app.use(express.json({ limit: "1mb" }));

app.get("/health", (_req, res) => {
  res.json({ ok: true, service: "kanban-core", version: "0.1.0" });
});

app.use("/api/tasks", tasksRouter);
app.use("/api/tasks/:id/comments", commentsRouter);
app.use("/api/projects/:id/graphs", graphsRouter);
app.use("/api/projects", projectsClaudeRouter);
app.use("/api/projects", projectsGithubRouter);
app.use("/api/projects", projectsRouter);
app.use("/api/auth", authRouter);
app.use("/github", githubRouter);
app.use("/api/pricing", pricingRouter);
app.use("/api/system", systemRouter);
app.use("/api/insights", insightsRouter);

app.use((req, res) => {
  res.status(404).json({ error: "not_found", path: req.path });
});

const server = http.createServer(app);
attachWebSocket(server);

server.listen(PORT, HOST, async () => {
  console.log(`[core] listening on http://${HOST}:${PORT}`);
  console.log(`[core] websocket on ws://localhost:${PORT}/ws`);
  try {
    const recovered = await recoverOrphanedTasks();
    if (recovered > 0) {
      console.log(`[core] recovered ${recovered} orphaned task(s) left in active state`);
    }
  } catch (err) {
    console.error("[core] orphan recovery failed:", err);
  }
});

async function shutdown(signal: string): Promise<void> {
  console.log(`[core] received ${signal}, shutting down`);
  await closeWebSocket();
  server.close(() => process.exit(0));
  setTimeout(() => process.exit(1), 5000).unref();
}

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));
