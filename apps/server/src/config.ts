import fs from "node:fs";
import path from "node:path";

function findWorkspaceRoot(startDirectory: string): string | undefined {
  let current = path.resolve(startDirectory);
  while (true) {
    if (fs.existsSync(path.join(current, "pnpm-workspace.yaml"))) return current;
    const parent = path.dirname(current);
    if (parent === current) return undefined;
    current = parent;
  }
}

function loadDotEnv(): void {
  const workspaceRoot = findWorkspaceRoot(process.cwd());
  if (!workspaceRoot) return;
  const file = path.join(workspaceRoot, ".env");
  if (!fs.existsSync(file)) return;
  const text = fs.readFileSync(file, "utf8");
  for (const line of text.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index < 0) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim().replace(/^['"]|['"]$/g, "");
    if (!(key in process.env)) process.env[key] = value;
  }
}

loadDotEnv();

export interface AppConfig {
  port: number;
  origin: string;
  mode: "mock" | "mcd";
  dataFile: string;
  mcdUrl: string;
  mcdToken?: string;
  mcdProtocolVersion: string;
  mcdMoneyUnit: "yuan" | "fen";
  modelBaseUrl?: string;
  modelApiKey?: string;
  modelName?: string;
  modelMaxTurns: number;
}

export function getConfig(): AppConfig {
  const requestedMode = process.env.APP_MODE === "mcd" ? "mcd" : "mock";
  const token = process.env.MCD_MCP_TOKEN?.trim() || undefined;
  const mode = requestedMode === "mcd" && token ? "mcd" : "mock";
  const configuredMoneyUnit = process.env.MCD_MONEY_UNIT === "fen" ? "fen" : "yuan";
  const configuredMaxTurns = Number(process.env.MODEL_MAX_TURNS || 8);
  const modelMaxTurns = Number.isInteger(configuredMaxTurns) && configuredMaxTurns > 0
    ? Math.min(configuredMaxTurns, 20)
    : 8;
  return {
    port: Number(process.env.PORT || 8787),
    origin: process.env.APP_ORIGIN || "http://localhost:5173",
    mode,
    dataFile: path.resolve(process.env.DATA_FILE || "data/app-state.json"),
    mcdUrl: process.env.MCD_MCP_URL || "https://mcp.mcd.cn",
    mcdToken: token,
    mcdProtocolVersion: process.env.MCD_MCP_PROTOCOL_VERSION || "2025-06-18",
    mcdMoneyUnit: configuredMoneyUnit,
    modelBaseUrl: process.env.MODEL_BASE_URL?.trim() || "https://api.deepseek.com",
    modelApiKey: process.env.MODEL_API_KEY?.trim() || undefined,
    modelName: process.env.MODEL_NAME?.trim() || undefined,
    modelMaxTurns,
  };
}
