import test from "node:test";
import assert from "node:assert/strict";
import http from "node:http";
import { OpenAICompatibleAdapter } from "./model.js";

async function withServer(
  handler: (request: http.IncomingMessage, response: http.ServerResponse) => void,
  run: (baseUrl: string) => Promise<void>,
): Promise<void> {
  const server = http.createServer(handler);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("server address unavailable");
  try {
    await run(`http://127.0.0.1:${address.port}`);
  } finally {
    server.closeAllConnections();
    await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test("OpenAI-compatible 适配器发送 DeepSeek 普通工具调用请求", async () => {
  let requestBody: Record<string, unknown> | undefined;
  let authorization = "";
  await withServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
    request.on("end", () => {
      requestBody = JSON.parse(Buffer.concat(chunks).toString("utf8")) as Record<string, unknown>;
      authorization = String(request.headers.authorization || "");
      response.setHeader("Content-Type", "application/json");
      response.end(JSON.stringify({
        choices: [{
          finish_reason: "tool_calls",
          message: {
            role: "assistant",
            content: null,
            tool_calls: [{ id: "call-1", type: "function", function: { name: "list_menu", arguments: "{}" } }],
          },
        }],
      }));
    });
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter(baseUrl, "test-secret", "deepseek-v4-flash");
    const result = await adapter.chat([{ role: "user", content: "查询菜单" }], [{
      type: "function",
      function: { name: "list_menu", description: "查询菜单", parameters: { type: "object" } },
    }]);
    assert.equal(result.message.tool_calls?.[0]?.function.name, "list_menu");
  });
  assert.equal(requestBody?.model, "deepseek-v4-flash");
  assert.equal(requestBody?.tool_choice, "auto");
  assert.equal(requestBody?.stream, false);
  assert.equal("thinking" in (requestBody || {}), false);
  assert.equal(authorization, "Bearer test-secret");
});

test("模型适配器拒绝空 choices 和鉴权错误且不带下游详情", async () => {
  await withServer((_request, response) => {
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ choices: [] }));
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter(baseUrl, "secret", "deepseek-v4-flash");
    await assert.rejects(
      () => adapter.chat([{ role: "user", content: "你好" }], []),
      (error: unknown) => error instanceof Error && error.message.includes("有效消息"),
    );
  });

  await withServer((_request, response) => {
    response.statusCode = 401;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: { message: "secret should not escape" } }));
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter(baseUrl, "secret", "deepseek-v4-flash");
    await assert.rejects(
      () => adapter.chat([{ role: "user", content: "你好" }], []),
      (error: unknown) => error instanceof Error && "code" in error && (error as { code: string }).code === "MODEL_UNAUTHORIZED",
    );
  });
});

test("模型适配器映射 429 和超时且不暴露 API Key", async () => {
  await withServer((_request, response) => {
    response.statusCode = 429;
    response.setHeader("Content-Type", "application/json");
    response.end(JSON.stringify({ error: { message: "api key must not escape" } }));
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter(baseUrl, "rate-limit-key-placeholder", "deepseek-v4-flash");
    await assert.rejects(
      () => adapter.chat([{ role: "user", content: "你好" }], []),
      (error: unknown) => error instanceof Error && "code" in error
        && (error as { code: string }).code === "MODEL_RATE_LIMIT"
        && !error.message.includes("rate-limit-key-placeholder"),
    );
  });

  await withServer((request) => {
    request.resume();
    // 故意不返回响应，让客户端的 AbortController 触发超时。
  }, async (baseUrl) => {
    const adapter = new OpenAICompatibleAdapter(baseUrl, "timeout-key-placeholder", "deepseek-v4-flash", 25);
    await assert.rejects(
      () => adapter.chat([{ role: "user", content: "你好" }], []),
      (error: unknown) => error instanceof Error && "code" in error
        && (error as { code: string }).code === "MODEL_TIMEOUT"
        && !error.message.includes("timeout-key-placeholder"),
    );
  });
});
