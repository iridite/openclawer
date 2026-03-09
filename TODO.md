- [x] 需要向 openclaw.json 中写入 `gateway.model= local`
- [x]（无用户允许的情况下，自主启动 gateway）并需要能从 openclaw.json 中主动读取 token `gateway.auth.token`
- [] （不做这个）要求在 dashboard 里面实现一个终端？可以根据 onboard 来进行直接的配置？
- [x] 检查 “配置摘要” 的真实性和实时更新能力
- [x] 快速操作部分，添加一个启动网关和停止网关的按钮
- [x] 在 “控制台” 页面添加一个板块，用于展示各类 log 输出的实际位置，方便用户自主查错。只是以等宽字体展示 log 的具体路径，用户可以直接复制路径去查看日志文件，没有功能作用。
- [x] 在配置编辑部分添加一个快速输入 provider 和 model 的功能，用户可以直接输入 provider 和 model 来快速配置一个模型（一个基于 openai / anthropic 协议的纯（完整）模型名称以及url和 api key 来配置的界面
- [x] 修复模型配置中的 api 参数问题，添加 API 类型下拉框，支持所有 OpenClaw 支持的 API 类型（openai-completions, anthropic-messages 等）
- [ ] 除了自动刷新之外能不能实现哪种实时更新，即有更改，我们这边就能更新？（针对用户配置的模型以及消息渠道等？）
- [ ] 明暗 UI 切换
- [x] 使用内存，CPU 情况在仪表盘需要展示出来，方便用户监控网关的运行状态
- [x] 初始 openclaw json 配置的时候加上 reload hybrid 配置，减少用户修改配置文件的步骤
---

- 安装过程卡在 40% 应该是在安装 npm 软件包，在 install wizard 中提醒一下

---
