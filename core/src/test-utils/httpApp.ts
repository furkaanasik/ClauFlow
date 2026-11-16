import http from "node:http";
import type { AddressInfo } from "node:net";
import express, { type Router } from "express";
import { JSON_BODY_LIMIT } from "../utils/http.js";

export interface TestServer {
  url: string;
  close: () => Promise<void>;
}

export async function startTestServer(mounts: Array<[string, Router]>): Promise<TestServer> {
  const app = express();
  app.use(express.json({ limit: JSON_BODY_LIMIT }));
  for (const [path, router] of mounts) app.use(path, router);
  const server = http.createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as AddressInfo;
  return {
    url: `http://127.0.0.1:${port}`,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
