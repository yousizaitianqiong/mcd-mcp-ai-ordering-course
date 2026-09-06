# AI 麦乐送助手

问题求解实战课程四人小组项目：把自然语言点餐、菜单查询、核价和订单状态查询串成一个可交互的 Web 演示。项目默认使用显式标注的 Mock 数据，配置麦当劳中国 MCP Token 后可以切换为官方 MCP 适配器；创建订单永远需要用户在页面点击确认。

## 项目范围

- 独立 Web 应用：React + TypeScript + Vite 前端，Node.js + TypeScript 后端。
- 统一业务接口：地址、门店、菜单、优惠券、核价、创建订单、查询订单。
- 两种 Provider：`MockFoodOrderProvider` 和 `McDonaldsMcpProvider`。
- 两种对话路径：配置 OpenAI 兼容模型时走 JSON Schema 工具调用；没有模型配置时走可重复演示的规则代理。
- 安全边界：MCP Token 只在服务端环境变量中使用；模型没有 `create-order` 工具；写操作不自动重试；日志只记录脱敏审计信息。

教师给出的参考文件是编号化用户需求列表的格式样例，不是本项目的功能约束；原始教师文件不提交到本公开仓库。

## 快速启动

环境建议：Node.js 20+、pnpm 9+。

```powershell
pnpm install
Copy-Item .env.example .env
pnpm build
pnpm dev
```

打开 <http://localhost:5173>。默认 `APP_MODE=mock`，不需要 Token 或外部模型即可完成菜单、购物车、核价、人工确认、生成模拟待支付订单和状态刷新。

如果本机没有全局 pnpm，可以使用 Node.js Corepack 或安装 pnpm：

```powershell
corepack enable
corepack prepare pnpm@9 --activate
pnpm install
```

## 切换在线模型和官方 MCP

复制 `.env.example` 为 `.env` 后，仅在服务端环境变量中填写真实值：

```dotenv
APP_MODE=mcd
MCD_MCP_URL=https://mcp.mcd.cn
MCD_MCP_TOKEN=
MCD_MCP_PROTOCOL_VERSION=2025-06-18
MODEL_BASE_URL=https://你的OpenAI兼容服务/v1
MODEL_API_KEY=
MODEL_NAME=你的模型名称
```

不要把 `.env` 提交到 Git，不要把 Token 写入前端代码、URL、数据库或日志。官方 MCP 的具体工具参数以其服务端实际返回的 `tools/list` 为准；本项目在 `apps/server/src/providers/mcd.ts` 中集中做参数和结构化结果适配。

## 目录结构

```text
apps/
  server/
    src/mcp/client.ts              Streamable HTTP JSON-RPC 客户端
    src/providers/mcd.ts           官方 MCP Provider
    src/providers/mock.ts          本地可演示 Provider
    src/model.ts                   OpenAI 兼容模型适配器
    src/orchestrator.ts            工具白名单、对话循环、确认闸门
    src/http.ts                    Web API、SSE、静态文件服务
  web/
    src/App.tsx                    聊天、菜单、购物车、确认和订单页面
    src/styles.css                 课程演示 UI
docs/
  research-matrix.md              GitHub 调研与融合边界
  requirements.md                 编号化需求与验收标准
  architecture.md                 架构、接口和安全流程
  team-roles.md                   四人分工与两周到四周计划
  demo-script.md                  课堂演示脚本
  test-plan.md                    测试计划和证据记录
```

## API 概览

- `GET /api/health`：返回当前 `mock` / `mcd` 模式、Provider 名称和协议版本，不返回密钥。
- `POST /api/chat`：请求 `{ sessionId?, message }`，响应为 Server-Sent Events，传递助手文本、工具进度、菜单、购物车、报价和确认请求。
- `POST /api/context`：在用户选择地址/门店后更新当前会话上下文。
- `POST /api/cart`：加入或清空购物车。
- `POST /api/orders/confirm`：校验未过期报价和会话归属后，唯一允许调用 `create-order`。
- `GET /api/orders/{orderId}`：优先读取已保存订单，否则调用 Provider 查询状态。

## 真实服务联调边界

课堂实机联调建议依次验证地址、门店、菜单、优惠券和核价；最后再在页面明确点击确认，验证一次 `create-order`。真实下单可能产生外部服务订单，必须由小组成员确认测试账号、地址、支付和服务条款后进行。没有 Token 时不要伪造官方结果，直接使用页面标注的 Mock 模式。

## 课程交付材料

- [GitHub 调研矩阵](docs/research-matrix.md)
- [编号化用户需求](docs/requirements.md)
- [系统架构与接口说明](docs/architecture.md)
- [四人分工](docs/team-roles.md)
- [课堂演示脚本](docs/demo-script.md)
- [测试计划与验收记录](docs/test-plan.md)

## 开源项目借鉴说明

本项目只借鉴公开项目的架构思路和交互方式，没有把第三方项目的密钥、品牌素材、私有接口或未经许可的实现复制进来。提交前请再次核对每个参考仓库的许可证、非商业用途限制和商标/服务条款。
