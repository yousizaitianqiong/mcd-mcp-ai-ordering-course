# 系统架构与接口说明

> 本文是实现和联调的接口基线。字段语义以当前 TypeScript 源码为准；本 Issue 只补充说明，不新增 API、SSE 事件、Provider 接口或数据格式。

## 1. 分层结构

~~~text
React/Vite Web
  ├─ POST /api/chat       ← SSE：助手文本、工具进度、菜单、购物车、报价、订单
  ├─ POST /api/context    ← 选择地址和门店
  ├─ POST /api/cart       ← 加入或清空购物车
  └─ POST/GET /api/orders ← 人工确认、订单查询
          ↓
Node HTTP API + OrderingOrchestrator
  ├─ ModelAdapter（可选 OpenAI 兼容 Chat Completions）
  ├─ 查询、购物车、核价工具白名单
  ├─ 会话、购物车、报价和订单状态
  └─ create-order 人工确认闸门
          ↓
FoodOrderProvider
  ├─ McDonaldsMcpProvider → McpHttpClient → 远程 Streamable HTTP MCP
  └─ MockFoodOrderProvider → 本地可重复演示数据
          ↓
JsonStore
  └─ 会话、购物车、报价、订单号和脱敏审计摘要
~~~

浏览器只接触 HTTP API 返回的结构化数据，不直接连接 MCP，也不持有 MCP Token 或模型 API Key。

## 2. 业务时序

~~~mermaid
sequenceDiagram
    participant U as 用户
    participant W as Web 前端
    participant H as HTTP API
    participant O as 编排器
    participant P as Provider
    participant S as JsonStore
    participant M as 在线模型

    U->>W: 输入自然语言点餐需求
    W->>H: POST /api/chat
    H->>O: 创建或恢复会话
    O->>M: chat(messages, 查询工具白名单)
    M-->>O: 查询工具调用
    O->>P: 地址、门店、菜单、优惠券查询
    P-->>O: 统一领域数据
    O-->>W: SSE tool / addresses / stores / menu
    U->>W: 加入购物车并请求核价
    W->>H: POST /api/chat 或 POST /api/cart
    O->>P: calculatePrice
    P-->>O: PriceQuote
    O->>S: 保存报价、quoteHash 和 approvalId
    O-->>W: SSE quote + confirmation_required
    U->>W: 点击确认并创建待支付订单
    W->>H: POST /api/orders/confirm
    H->>O: 校验会话、报价状态和有效期
    O->>P: 唯一写操作入口 createOrder
    P-->>O: PendingOrder
    O->>S: 标记确认、保存订单、清空购物车
    O-->>W: order
    U->>W: 刷新订单状态
    W->>H: GET /api/orders/{orderId}
    H->>P: 未保存时查询 Provider
    P-->>H: 订单状态
    H-->>W: order
~~~

无在线模型时，Mock Agent 使用同一套 Provider 和事件结构完成可重复演示；这不是将 Mock 结果包装成真实服务结果。

## 3. 领域接口

以下是保持字段语义不变的语言无关接口摘要：

~~~text
FoodOrderProvider
  listAddresses() -> Address[]
  listDeliverableStores({ addressId, beType: 2 }) -> Store[]
  listMeals({ storeCode, beCode, orderType: 2, beType: 2 }) -> MenuItem[]
    可选调用 list-nutrition-foods，将精确匹配的每份热量带入 MenuItem
  getMealDetail({ storeCode, beCode, code, orderType: 2, beType: 2 }) -> JsonObject
  listStoreCoupons({ storeCode, beCode, orderType: 2, beType: 2 }) -> Coupon[]
  calculatePrice({ context, items }) -> PriceQuote
  createOrder({ context, items }) -> PendingOrder
  getOrderStatus(orderId) -> PendingOrder

ModelAdapter
  chat(messages, tools) -> { message, finishReason? }
~~~

核心领域数据：

| 类型 | 必要字段 | 用途 |
| --- | --- | --- |
| Address | addressId、contactName、phone、fullAddress | 配送地址选择和核对 |
| Store | storeCode、beCode、storeName、businessStatus | 门店上下文 |
| MenuItem | productCode、name、price、tags；可选 caloriesKcal | 菜单展示和加购；热量单位为千卡/份 |
| CartItem | 商品编码、名称、数量、单价、门店编码；可选 caloriesKcal | 服务端购物车和核价输入；热量只来自服务端菜单匹配 |
| PriceQuote | quoteId、context、items、金额字段、expiresAt、quoteHash | 人工确认依据和完整性校验 |
| PendingOrder | orderId、orderStatus、totalAmount、可选支付链接 | 待支付订单展示 |

`list-nutrition-foods` 不是模型工具，也不是下单前提。MCD Provider 只接受其固定表头中的 `energyKcal`，按规范化后的完整餐品名称精确匹配菜单；没有匹配或远端格式变化时省略 `caloriesKcal`，前端显示“热量数据暂无”，不做模糊估算。购物车中的热量按数量展示，只有所有商品都有数据时才汇总预计总热量。

## 4. Web API 契约

### 4.1 健康检查

GET /api/health

响应字段：

~~~json
{
  "ok": true,
  "mode": "mock",
  "provider": "mock",
  "modelConfigured": false,
  "mcpConfigured": false,
  "protocolVersion": "2025-06-18",
  "now": "ISO-8601 时间"
}
~~~

真实联调必须看到 mode=mcd，并单独确认 modelConfigured=true。响应不得包含 Token 或模型 Key。

### 4.2 对话与 SSE

POST /api/chat

请求：

~~~json
{
  "sessionId": "可选，会话 ID",
  "message": "我想吃麦香鸡套餐"
}
~~~

成功响应为 text/event-stream。每个事件包含：

~~~text
event: 事件名
data: JSON 数据
~~~

| 事件 | 数据摘要 | 前端用途 |
| --- | --- | --- |
| session | sessionId、provider | 保存会话和模式 |
| tool | name、status，可选 arguments/error | 展示调用进度 |
| addresses | Address[] | 地址卡片 |
| stores | Store[] | 门店选择 |
| menu | MenuItem[] | 菜单卡片 |
| cart | CartItem[] | 购物车 |
| quote | PriceQuote 加 approvalId、quoteHash | 核价卡片 |
| confirmation_required | 与报价相同的确认数据 | 显示确认闸门 |
| order | PendingOrder | 订单卡片 |
| assistant | { text } | 聊天回复 |
| error | { code, message } | 错误提示；不返回下游原始详情 |
| done | { sessionId } | 结束本轮处理 |

空消息或无效 JSON 在 SSE 建立前返回 JSON 错误；处理过程中的异常通过 error 事件返回并以 done 结束。

### 4.3 上下文

POST /api/context

请求：

~~~json
{
  "sessionId": "会话 ID",
  "addressId": "地址 ID",
  "storeCode": "门店编码",
  "beCode": "业务编码"
}
~~~

成功响应为包含 OrderContext 对象的 JSON：

~~~json
{
  "context": {
    "addressId": "地址 ID",
    "address": {
      "addressId": "地址 ID",
      "contactName": "联系人",
      "phone": "脱敏手机号",
      "fullAddress": "配送地址"
    },
    "storeCode": "门店编码",
    "beCode": "业务编码",
    "storeName": "门店名称"
  }
}
~~~

服务端重新查询地址和可配送门店，只有匹配成功才保存上下文。

### 4.4 购物车

加入餐品：POST /api/cart

~~~json
{
  "sessionId": "会话 ID",
  "item": {
    "productCode": "商品编码",
    "productName": "商品名称",
    "unitPrice": 24,
    "quantity": 1
  }
}
~~~

清空购物车：

~~~json
{
  "sessionId": "会话 ID",
  "action": "clear"
}
~~~

成功响应示例：

~~~json
{
  "sessionId": "会话 ID",
  "cart": [
    {
      "productCode": "商品编码",
      "productName": "商品名称",
      "quantity": 1,
      "unitPrice": 24,
      "storeCode": "门店编码",
      "beCode": "业务编码"
    }
  ]
}
~~~

服务端要求已有配送上下文；同一商品再次加入时数量合并，数量限制为 1–20。

### 4.5 人工确认与订单

POST /api/orders/confirm

~~~json
{
  "sessionId": "会话 ID",
  "approvalId": "报价确认 ID",
  "quoteHash": "服务端报价哈希"
}
~~~

成功响应为包含 PendingOrder 对象的 JSON。服务端按以下顺序处理：

1. 检查 approvalId 存在且属于 sessionId。
2. 重新计算报价快照并比对 quoteHash，检查 expiresAt 未到期。
3. 将 approval 原子标记为 submitting；并发请求只能有一个继续。
4. 调用 Provider 的 createOrder；该调用不自动重试。
5. 成功标记 confirmed；明确失败标记 failed；超时或网络未知标记 unknown。
6. 成功后保存脱敏订单摘要、记录审计事件并清空购物车。

GET /api/orders/{orderId} 返回包含 PendingOrder 对象的 JSON。如果 JsonStore 已保存订单，优先返回保存内容；否则调用 Provider 查询状态。

## 5. 模型工具权限

模型允许自动调用：

- list_delivery_addresses
- list_deliverable_stores
- list_menu
- get_meal_detail
- list_store_coupons
- add_to_cart
- view_cart
- calculate_price
- get_order_status

create-order 不出现在模型工具列表中。模型只能产生查询、购物车和核价结果；真正的写操作必须由用户在页面点击确认后进入 /api/orders/confirm。

## 6. MCP 适配边界

McpHttpClient 负责：

- initialize、notifications/initialized、tools/list 和 tools/call JSON-RPC；
- Accept: application/json, text/event-stream、MCP-Protocol-Version 和 Bearer Token；
- JSON 响应与 SSE data: 响应解析；
- 401、429、HTTP 错误、超时、RPC 错误、无效响应和网络错误转换；错误响应不携带原始详情。

McDonaldsMcpProvider 负责把远程工具名称和响应字段转换成统一领域类型。前端不得依赖 MCP 原始字段。

真实联调必须核对适配后的地址、门店、菜单、优惠券、报价和订单字段；编译成功不能替代真实响应验证。

## 7. 错误与安全

| 类别 | 当前错误码示例 | 处理原则 |
| --- | --- | --- |
| 请求输入 | INVALID_JSON、MESSAGE_REQUIRED、INVALID_CART_ITEM | 返回 400 和中文提示 |
| 业务前置条件 | CONTEXT_REQUIRED、EMPTY_CART、ITEM_NOT_IN_CART、ORDER_ID_REQUIRED | 不调用下游写操作 |
| 确认状态 | APPROVAL_NOT_FOUND、APPROVAL_ALREADY_USED、APPROVAL_NOT_RETRYABLE、QUOTE_EXPIRED、QUOTE_HASH_MISMATCH | 不创建订单 |
| 报价完整性 | QUOTE_INTEGRITY_ERROR | 停止写操作并重新核价 |
| MCP | MCP_UNAUTHORIZED、MCP_RATE_LIMIT、MCP_TIMEOUT、MCP_NETWORK_ERROR、MCP_RPC_ERROR、MCP_SCHEMA_ERROR | 展示可识别错误，不自动重试写操作 |
| 模型 | MODEL_UNAUTHORIZED、MODEL_RATE_LIMIT、MODEL_TIMEOUT、MODEL_NETWORK_ERROR、MODEL_HTTP_ERROR、MODEL_INVALID_RESPONSE | 保留会话，不暴露下游详情 |

安全边界：

- Token 和模型 Key 只从服务端环境变量读取。
- 浏览器响应、源码、日志和截图不包含 Authorization Header、模型请求体或 MCP 原始响应；JSONStore 对地址、手机号、消息中的常见凭据和支付链接做脱敏处理。
- 真实下单前必须重新核对地址、商品、金额和报价有效期。
- 当前课程版本没有登录鉴权和分布式数据库锁；sessionId 不是身份认证凭据，不适用于生产环境。单进程 JsonStore 提供 approval 占用，跨进程部署仍需外部幂等存储。
- 支付、退款和履约不属于本 Issue 的代码改造范围；真实联调采用两人复核和单次点击控制。
