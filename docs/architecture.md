# 系统架构与接口说明

## 分层结构

```text
React/Vite Web
  ├─ SSE /api/chat  ← 文本、工具进度、菜单、购物车、报价、订单事件
  ├─ /api/context /api/cart
  └─ /api/orders/confirm、/api/orders/{id}
          ↓
Node HTTP API + OrderingOrchestrator
  ├─ ModelAdapter（可选 OpenAI 兼容 Chat Completions）
  ├─ 查询/核价工具白名单
  ├─ 报价有效期与会话归属校验
  └─ create-order 人工确认闸门
          ↓
FoodOrderProvider
  ├─ McDonaldsMcpProvider → McpHttpClient → 远程 Streamable HTTP MCP
  └─ MockFoodOrderProvider → 本地演示数据
```

## 冻结的语言无关接口

```text
FoodOrderProvider
  listAddresses()
  listDeliverableStores({ addressId, beType })
  listMeals({ storeCode, beCode, orderType, beType })
  getMealDetail({ storeCode, beCode, code, orderType, beType })
  listStoreCoupons({ storeCode, beCode, orderType, beType })
  calculatePrice({ context, items })
  createOrder({ context, items })
  getOrderStatus(orderId)

ModelAdapter
  chat(messages, tools) -> assistant text / tool_calls
```

具体 TypeScript 定义位于 `apps/server/src/types.ts`，后续替换语言或框架时保持字段语义不变。

## 工具权限

模型允许自动调用：

- `list_delivery_addresses`
- `list_deliverable_stores`
- `list_menu`
- `get_meal_detail`
- `list_store_coupons`
- `add_to_cart`
- `view_cart`
- `calculate_price`
- `get_order_status`

`create-order` 不出现在模型工具列表中。服务端的 `POST /api/orders/confirm` 会检查：

1. `approvalId` 存在且属于当前会话；
2. 报价仍为 `pending` 且未过期；
3. Provider 调用成功后才标记为 `confirmed` 并保存订单；
4. Provider 抛错时不自动重试，避免未知状态下重复提交。

## MCP 适配

`McpHttpClient` 负责：

- `initialize`、`notifications/initialized`、`tools/list` 和 `tools/call` JSON-RPC；
- `Accept: application/json, text/event-stream`、`MCP-Protocol-Version` 和 Bearer Token；
- JSON 响应与 SSE `data:` 响应解析；
- 401、429、HTTP 错误、超时和网络错误转换为可展示错误。

`McDonaldsMcpProvider` 负责把远程工具名称和响应结构转换成统一领域类型；前端不感知 MCP 原始字段。

## Web API 事件

`POST /api/chat` 返回 SSE：

| 事件 | 数据 | 用途 |
| --- | --- | --- |
| `session` | `sessionId`, `provider` | 前端保存会话和模式 |
| `tool` | 工具名、状态、参数（不含密钥） | 展示调用进度 |
| `addresses` / `stores` / `menu` | 结构化数组 | 渲染选择器和菜单卡片 |
| `cart` | 购物车 | 更新订单侧栏 |
| `quote` / `confirmation_required` | 报价和 `approvalId` | 展示确认闸门 |
| `order` | 脱敏订单信息 | 展示订单状态 |
| `assistant` | 文本 | 更新聊天消息 |
| `error` / `done` | 错误或结束标志 | 恢复前端交互状态 |

## 数据和隐私

课程演示使用 JSON 文件保存会话、购物车、报价状态、订单号和审计摘要；文件路径可由 `DATA_FILE` 配置且默认被 `.gitignore` 忽略。MCP Token、模型 Key、Authorization Header 和支付信息不写入该文件。生产部署应替换为加密数据库、密钥管理和更严格的访问控制。
