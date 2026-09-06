import { getConfig } from "./config.js";
import { createHttpServer } from "./http.js";
import { OpenAICompatibleAdapter } from "./model.js";
import { OrderingOrchestrator } from "./orchestrator.js";
import { McDonaldsMcpProvider } from "./providers/mcd.js";
import { MockFoodOrderProvider } from "./providers/mock.js";
import { JsonStore } from "./store.js";

const config = getConfig();
const store = new JsonStore(config.dataFile);
await store.load();

const provider = config.mode === "mcd" && config.mcdToken
  ? new McDonaldsMcpProvider(config.mcdUrl, config.mcdToken, config.mcdProtocolVersion)
  : new MockFoodOrderProvider();

const model = config.modelBaseUrl && config.modelApiKey && config.modelName
  ? new OpenAICompatibleAdapter(config.modelBaseUrl, config.modelApiKey, config.modelName)
  : undefined;

const orchestrator = new OrderingOrchestrator(provider, store, model);
const server = createHttpServer({
  config,
  store,
  provider,
  orchestrator,
  modelConfigured: Boolean(model),
});

server.listen(config.port, () => {
  console.log(`[AI 麦乐送助手] http://localhost:${config.port}`);
  console.log(`[AI 麦乐送助手] provider=${provider.name}, model=${model ? model.name : "mock-agent"}`);
});
