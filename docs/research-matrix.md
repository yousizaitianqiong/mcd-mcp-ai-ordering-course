# GitHub 调研与融合矩阵

## 1. 调研目标与使用规则

本次调研只为课程项目确定可解释的架构和交互边界，不是把多个仓库拼接在一起。统一结论是：

1. MCP 作为服务端 Provider 的适配层，不直接暴露给浏览器。
2. 模型只看到经过白名单整理的查询、购物车和核价工具。
3. create-order 由服务端人工确认接口触发，不作为模型工具。
4. Mock 与官方模式实现同一个 FoodOrderProvider 接口，确保课堂可复现。
5. 第三方仓库只提供公开思路和证据入口，不复制代码、密钥、品牌素材、私有接口或未经许可的响应数据。

“许可证/条款状态”是发布前检查项。下表的“待复核”不能被解释为已经取得第三方授权；完成发布前检查后，应把实际核查日期、许可证名称和限制写入对应行。

## 2. 调研矩阵

| 项目 | 参考证据 | 观察重点 | 本项目融合方式 | 明确不采用的内容 | 许可证/条款核查状态 | 核查日期 |
| --- | --- | --- | --- | --- | --- | --- |
| M-China/mcd-mcp-server | [仓库](https://github.com/M-China/mcd-mcp-server)；README、工具目录 | 麦当劳中国 MCP 的地址、门店、菜单、核价、下单和查单工具链 | McDonaldsMcpProvider 与 McpHttpClient 作为远程适配层 | 不复制 Token、官方品牌内容或仓库私有实现 | 发布前逐项复核许可证、README 和服务条款 | 待发布前填写 |
| 599yongyang/mcd-mcp-app | [仓库](https://github.com/599yongyang/mcd-mcp-app)；React/TypeScript 页面和工具结果展示 | 工具结果可视化、MCP UI 资源思路 | 菜单卡片、工具调用轨迹和结构化报价卡片 | 不把 Token 放进 URL 查询参数 | 发布前逐项复核许可证、README 和资源限制 | 待发布前填写 |
| Kingwl/mcd-mcp-cli | [仓库](https://github.com/Kingwl/mcd-mcp-cli)；CLI 配置和 MCP 调用入口 | Streamable HTTP、环境变量、工具白名单和版本兼容 | 后端集中配置协议版本、Bearer Token 和允许工具 | 不把 CLI 凭据或交互流程搬到浏览器 | 发布前逐项复核许可证、README 和账号要求 | 待发布前填写 |
| Azure-Samples/pizza-mcp-agents | [仓库](https://github.com/Azure-Samples/pizza-mcp-agents)；服务、Agent 和 Web 目录 | 业务 API、MCP 服务、Web 订单面板的分层结构 | Provider、编排器、Web API、前端分层，并保留本地 Mock | 不把云资源、账号和平台依赖带入课堂项目 | 发布前逐项复核许可证、示例限制和云服务条款 | 待发布前填写 |
| Doriandarko/webmcp-starter | [仓库](https://github.com/Doriandarko/webmcp-starter)；菜单、购物车和结算界面 | 搜索、菜单、购物车、优惠、结算和订单状态交互链路 | 前端围绕菜单 → 购物车 → 核价 → 确认 → 查单组织信息架构 | 不依赖实验性的 Chrome WebMCP | 发布前逐项复核许可证、浏览器兼容和项目状态 | 待发布前填写 |
| CydVilla/peckish | [仓库](https://github.com/CydVilla/peckish)；工具和确认流程说明 | 人工确认闸门、严格工具参数、审计日志、写操作不自动重试 | confirmation_required、报价过期校验、写操作单点入口和脱敏审计 | 不接入其 DoorDash 私有实现 | 发布前逐项复核许可证、第三方服务和非商业限制 | 待发布前填写 |
| sushil930/canteen-flow | [仓库](https://github.com/sushil930/canteen-flow)；Mock 点餐和订单界面 | Mock 点餐、访客模式、订单状态和管理界面 | Mock Provider、课堂回退和可重复订单状态 | 不做完整商家后台和生产级支付系统 | 发布前逐项复核许可证、README 和演示数据来源 | 待发布前填写 |

## 3. 发布前核查清单

- 逐一打开表内仓库主页和许可证文件，记录许可证名称、版本和核查日期。
- 阅读 README 中的商业用途、署名、服务条款、第三方 API 和品牌限制。
- 仅保留链接、概念性总结和本项目自己的实现；不复制第三方代码或原始数据。
- 检查公开提交、截图、日志和报告没有 Token、Authorization Header、个人地址、手机号或真实支付信息。
- 在最终报告中把“已完成许可证核查”和“仍待复核”分开记录。

## 4. 借鉴后的架构结论

| 决策 | 结论 | 对本项目的约束 |
| --- | --- | --- |
| 服务边界 | MCP 只在服务端 Provider 层出现 | 前端只消费统一 API 和 SSE |
| 工具权限 | 查询、购物车、核价可以由模型调用 | create-order 永不进入模型工具列表 |
| 订单安全 | 写操作需要人类确认 | 只允许 /api/orders/confirm 触发 |
| 演示稳定性 | Mock 与真实 Provider 共享接口 | 没有凭据时明确显示 Mock |
| 课程范围 | 关注点餐闭环和异常分支 | 不扩展支付、退款、商家后台 |
