import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { McpHttpClient } from "./client.js";

test("MCP 客户端完成初始化、会话头和 SSE tools/call", async () => {
  const methods: string[] = [];
  let sawSessionHeader = false;
  const server = http.createServer(async (request, response) => {
    const chunks: Buffer[] = [];
    for await (const chunk of request) chunks.push(Buffer.from(chunk));
    const body = chunks.length ? JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown> : {};
    methods.push(String(body.method || ""));
    assert.equal(request.headers.authorization, "Bearer mcp-test-token");
    assert.equal(request.headers["mcp-protocol-version"], "2025-06-18");
    if (methods.length > 2) sawSessionHeader = Boolean(request.headers["mcp-session-id"]);
    if (body.method === "initialize") {
      response.setHeader("Content-Type", "application/json");
      response.setHeader("Mcp-Session-Id", "session-1");
      response.end(JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { protocolVersion: "2025-06-18" } }));
      return;
    }
    if (body.method === "notifications/initialized") {
      response.statusCode = 202;
      response.end();
      return;
    }
    if (body.method === "tools/list") {
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        jsonrpc: "2.0",
        id: body.id,
        result: { tools: [{ name: "query-meals", inputSchema: { type: "object" } }] },
      }));
      return;
    }
    response.setHeader("Content-Type", "text/event-stream");
    response.end(`event: message\ndata: ${JSON.stringify({ jsonrpc: "2.0", id: body.id, result: { structuredContent: { ok: true } } })}\n\n`);
  });
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    const client = new McpHttpClient(`http://127.0.0.1:${address.port}`, "mcp-test-token");
    const tools = await client.listTools();
    assert.equal(tools[0].name, "query-meals");
    const result = await client.callTool("query-meals", {});
    assert.deepEqual(result, { structuredContent: { ok: true } });
    assert.deepEqual(methods, ["initialize", "notifications/initialized", "tools/list", "tools/call"]);
    assert.equal(sawSessionHeader, true);
  } finally {
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
});

test("MCP HTTP 401/429 映射为稳定错误码", async () => {
  for (const [status, code] of [[401, "MCP_UNAUTHORIZED"], [429, "MCP_RATE_LIMIT"]] as const) {
    const server = http.createServer((request, response) => {
      request.resume();
      response.statusCode = status;
      response.end("upstream secret must not be exposed");
    });
    await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
    const address = server.address();
    if (!address || typeof address === "string") throw new Error("server address unavailable");
    try {
      const client = new McpHttpClient(`http://127.0.0.1:${address.port}`, "secret-token");
      await assert.rejects(
        () => client.listTools(),
        (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === code
          && !error.message.includes("secret"),
      );
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  }
});
