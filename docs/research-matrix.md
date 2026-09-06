# GitHub 调研与融合矩阵

目标不是拼接多个仓库，而是提取适合课程项目的边界：MCP 协议适配、点餐状态机、人工确认和本地 Mock。所有实现以本项目已经冻结的语言无关接口为准。

| 项目 | 观察重点 | 本项目融合方式 | 明确不采用的内容 |
| --- | --- | --- | --- |
| [M-China/mcd-mcp-server](https://github.com/M-China/mcd-mcp-server) | 麦当劳中国 MCP 的地址、门店、菜单、核价、下单和查单工具链 | `McDonaldsMcpProvider` 与 `McpHttpClient` 作为远程适配层 | 不复制 Token、官方品牌内容或仓库私有实现；遵守其许可证和非商业边界 |
| [599yongyang/mcd-mcp-app](https://github.com/599yongyang/mcd-mcp-app) | React/TypeScript 的工具结果可视化和 MCP UI 资源思路 | 菜单卡片、工具调用轨迹、结构化报价卡片 | 不把 Token 放进 URL 查询参数 |
| [Kingwl/mcd-mcp-cli](https://github.com/Kingwl/mcd-mcp-cli) | Streamable HTTP、环境变量、工具白名单和版本兼容 | 后端集中配置 `MCP-Protocol-Version`、Bearer Token 和允许工具 | 不把 CLI 凭据或交互流程直接搬到浏览器 |
| [Azure-Samples/pizza-mcp-agents](https://github.com/Azure-Samples/pizza-mcp-agents) | 业务 API、MCP 服务、Web 订单面板的分层结构 | Provider / 编排器 / Web API / 前端分层，并保留本地 Mock | 不把示例云资源和账号依赖带入课堂项目 |
| [Doriandarko/webmcp-starter](https://github.com/Doriandarko/webmcp-starter) | 搜索、菜单、购物车、优惠、结算、订单状态的交互链路 | 前端围绕菜单→购物车→核价→确认→查单组织信息架构 | 不依赖实验性的 Chrome WebMCP |
| [CydVilla/peckish](https://github.com/CydVilla/peckish) | 人工确认闸门、严格工具参数、审计日志、写操作不自动重试 | `confirmation_required`、报价过期校验、写操作单点入口和脱敏审计 | 不接入其 DoorDash 私有实现 |
| [sushil930/canteen-flow](https://github.com/sushil930/canteen-flow) | Mock 点餐、访客模式、订单状态和管理界面 | Mock Provider、课堂演示回退、可重复订单状态 | 不做完整商家后台和生产级支付系统 |

## 借鉴后的架构结论

1. MCP 只是 Provider，不直接暴露给浏览器；模型也只能看到经过白名单整理的查询/核价工具。
2. `create-order` 被设计成服务端显式确认 API，而不是模型可自动调用的工具。
3. Mock 数据与官方模式使用同一个 `FoodOrderProvider` 接口，网络异常时可以明确显示 Mock，不伪装成真实订单。
4. 前端只接收结构化事件和展示数据；Token、原始 Authorization Header 和模型 Key 不进入前端响应。
5. 课程验收优先关注可解释的业务闭环和异常分支，不把支付、商家后台和外卖聚合作为首版范围。

## 许可证与发布检查

- 发布前逐一查看参考仓库当前许可证和 README 限制，保留链接与借鉴说明。
- 不提交 `.env`、Token、个人地址、真实手机号、支付信息或官方接口响应中的敏感字段。
- UI 使用自绘的课程演示元素；不暗示本项目得到麦当劳官方授权或背书。
