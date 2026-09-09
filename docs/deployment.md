# 本地启动、部署与课堂联调

本文是 Issue #4 的可复现运行说明。课程演示默认使用 Mock；真实 MCP 只在测试账号、配送地址、服务条款、网络和人工复核条件均具备时进行。

## 1. 环境与安装

- Node.js 20 或更高版本。
- pnpm 9 或更高版本；没有全局 pnpm 时优先使用 Corepack。
- Windows PowerShell、macOS/Linux shell 均可执行同名 pnpm 命令。

在仓库根目录执行：

```powershell
corepack enable
corepack prepare pnpm@9 --activate
pnpm install --frozen-lockfile
```

如果 pnpm 报告依赖构建脚本被忽略，只批准锁文件中明确需要的 `esbuild`，不要一次性放开全部依赖脚本：

```powershell
pnpm approve-builds
pnpm install --frozen-lockfile
```

安装后可用以下命令确认生产构建和测试入口：

```powershell
pnpm test
pnpm test:mock
pnpm build
```

`pnpm test` 的通过数必须以本次终端输出为准；命令退出码为 0 但测试数为 0 时，不得写成已有测试覆盖。

## 2. 默认 Mock 启动

复制配置示例并保持 `APP_MODE=mock`：

```powershell
Copy-Item .env.example .env
pnpm dev
```

开发服务地址：

- Web：<http://localhost:5173>
- Node API：<http://localhost:8787>
- 健康检查：<http://localhost:8787/api/health>

健康检查应看到 `mode=mock`、`provider=mock`、`mcpConfigured=false`。页面和订单状态必须明确显示 Mock/模拟，不把示例订单说成真实订单。

也可以分开启动：

```powershell
pnpm dev:server
pnpm dev:web
```

课堂演示前先执行 `pnpm test:mock`，再清理浏览器旧会话；Mock 流程不需要 MCP Token、模型 Key、真实地址、手机号或支付信息。

## 3. 环境变量边界

| 变量 | Mock 默认值/用途 | 真实联调规则 |
| --- | --- | --- |
| `APP_MODE` | `mock` | 只有受控只读预检时才设为 `mcd` |
| `PORT` | `8787` | 改端口后同步检查前端代理或反向代理 |
| `APP_ORIGIN` | `http://localhost:5173` | 设置为实际 Web 来源，不填凭据 |
| `DATA_FILE` | `./data/app-state.json` | 指向可写的本地/持久目录，不提交运行数据 |
| `MCD_MCP_URL` | 官方 MCP 地址示例 | 只在服务端使用，按远端实际协议核对 |
| `MCD_MCP_TOKEN` | 留空 | 只写服务端 `.env`，不进前端、URL、日志或截图 |
| `MCD_MCP_PROTOCOL_VERSION` | `2025-06-18` | 以实际服务端协议为准 |
| `MCD_MONEY_UNIT` | `yuan` | 只有远端明确返回分单位时才设为 `fen` |
| `MODEL_BASE_URL` | DeepSeek 兼容地址示例 | 只写服务端环境 |
| `MODEL_API_KEY` | 留空 | 不提交、不打印、不放入浏览器请求 |
| `MODEL_NAME` | `deepseek-v4-flash` 示例 | 仅在在线模型验收时配置 |
| `MODEL_MAX_TURNS` | `8` | 服务端限制在 1–20 回合 |

`.env.example` 只能保存占位值；`.env`、`.env.local`、`data/app-state.json` 和构建缓存不得提交。

## 4. 真实模式检查与安全回退

启动配置会把 `APP_MODE=mcd` 且缺少 `MCD_MCP_TOKEN` 的情况明确解析为 Mock。以 `/api/health` 的 `mode` 和 `provider` 为准，不根据环境变量文字猜测当前模式。

如果已经配置 Token 但真实 MCP 返回 401、429、超时、网络错误或未知写入结果：

1. 停止真实写操作，不自动重试 `create-order`，不把失败响应改写成 Mock 成功。
2. 记录脱敏错误码、发生步骤和“是否产生外部订单”；不得记录 Token、Authorization、完整地址或支付信息。
3. 清除或关闭真实凭据环境。
4. 重新以 `APP_MODE=mock` 启动，执行 Mock 主流程。
5. 在测试记录中把真实路径标为“阻塞/部分完成”，Mock 证据单独归档。

真实运行中的网络错误不会静默切换 Provider，因为自动切换可能掩盖真实 `create-order` 的外部副作用。

## 5. 单机生产构建（课堂演示部署）

本项目是课程演示，不是生产支付系统。需要用一个 Node 进程同时提供构建后的 Web 和 API 时：

```powershell
pnpm build
pnpm start
```

然后访问 <http://localhost:8787>。Node 服务会优先查找 `apps/web/dist` 并提供静态页面，`/api/*` 继续由同一进程处理。部署前必须检查：

- `GET /api/health` 返回期望的 `mode`、`provider` 和模型配置状态；
- `DATA_FILE` 所在目录可写且不在公开静态目录；
- `.env` 由进程管理器或主机环境注入，不复制到 Web 目录；
- 反向代理只转发必要的 HTTP/SSE 路由，并保留 SSE 长连接；
- 多进程/多副本部署前替换本地 JsonStore，提供外部持久化和幂等锁；当前单进程 approval 占用不等于生产级分布式锁。

## 6. 课堂联调最小流程

### Mock 路径

1. `pnpm install --frozen-lockfile`、`pnpm build`、`pnpm test:mock`。
2. 访问 `/api/health`，确认 `mode=mock`、`provider=mock`。
3. 查询地址、门店和菜单，加入一份餐品。
4. 请求核价，核对商品价、配送费、优惠、总价和报价有效期。
5. 先展示未点击确认时没有订单，再点击一次确认按钮。
6. 展示 `MOCK-ORDER-*`、`待支付（模拟）` 和状态查询；不打开模拟支付链接。
7. 保存脱敏终端/SSE 摘要和页面截图。

### 真实 MCP 路径

真实路径必须由一名操作成员和一名复核成员共同执行。依次完成地址、门店、菜单、优惠券和核价的只读检查，复核地址、商品、金额和报价有效期后最多点击一次确认。不自动支付；失败或未知状态停止并升级人工判断。详细演示台词和证据表见[课堂演示脚本](demo-script.md)与[测试计划](test-plan.md)。

## 7. 运行数据清理

演示结束后检查本地 `DATA_FILE`，确认只保留脱敏会话/审计摘要；不要把真实地址、手机号、支付链接、Token 或模型 Key复制到报告。真实联调产生的原始响应应留在仓库外的受控位置，并按小组规则清理或保护。
