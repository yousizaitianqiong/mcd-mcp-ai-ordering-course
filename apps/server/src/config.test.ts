import test from "node:test";
import assert from "node:assert/strict";
import { getConfig } from "./config.js";

function withEnvironment(values: Record<string, string | undefined>, run: () => void): void {
  const previous = new Map<string, string | undefined>();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  try {
    run();
  } finally {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  }
}

test("请求真实模式但缺少 MCP Token 时明确回退为 Mock", () => {
  withEnvironment({ APP_MODE: "mcd", MCD_MCP_TOKEN: undefined }, () => {
    const config = getConfig();
    assert.equal(config.mode, "mock");
    assert.equal(config.mcdToken, undefined);
  });
});

test("具备 MCP Token 时仅选择真实 Provider 配置，不在配置读取阶段发起网络请求", () => {
  withEnvironment({ APP_MODE: "mcd", MCD_MCP_TOKEN: "test-token-placeholder" }, () => {
    const config = getConfig();
    assert.equal(config.mode, "mcd");
    assert.equal(config.mcdToken, "test-token-placeholder");
  });
});
