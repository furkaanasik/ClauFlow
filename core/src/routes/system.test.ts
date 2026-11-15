import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { ADVISOR_SUPPORTED, MODEL_ALIASES } from "../services/claudeCapabilities.js";
import { startTestServer, type TestServer } from "../test-utils/httpApp.js";
import systemRouter from "./system.js";

let server: TestServer;

beforeAll(async () => {
  server = await startTestServer([["/api/system", systemRouter]]);
});

afterAll(async () => {
  await server.close();
});

describe("GET /api/system/capabilities", () => {
  it("returns the advisor flag and the model aliases", async () => {
    const res = await fetch(`${server.url}/api/system/capabilities`);
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ advisor: ADVISOR_SUPPORTED, models: [...MODEL_ALIASES] });
  });
});
