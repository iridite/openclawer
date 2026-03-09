#set document(
  title: "OC-Deploy v1.0.0 内测版本说明",
  author: "iridite@github",
  date: datetime(year: 2026, month: 3, day: 9),
)

#set page(
  paper: "a4",
  margin: (x: 2.5cm, y: 2.5cm),
)

#set text(
  font: ("Noto Serif CJK SC", "Source Han Serif SC", "SimSun"),
  size: 11pt,
  lang: "zh",
)

#set heading(numbering: "1.1")

#show heading.where(level: 1): it => [
  #set text(size: 24pt, weight: "bold")
  #block(above: 1.5em, below: 1em)[#it]
]

#show heading.where(level: 2): it => [
  #set text(size: 18pt, weight: "bold")
  #block(above: 1.2em, below: 0.8em)[#it]
]

#show heading.where(level: 3): it => [
  #set text(size: 14pt, weight: "bold")
  #block(above: 1em, below: 0.6em)[#it]
]

#align(center)[
  #text(size: 28pt, weight: "bold")[
    OC-Deploy v1.0.0 内测版本说明
  ]

  #v(1em)

  #text(size: 12pt)[
    版本: 1.0.0 | 发布日期: 2026-03-09 | 维护者: iridite\@github
  ]
]

#v(2em)

= 这是什么？

OC-Deploy 是一个为飞牛 NAS（fnOS）设计的 OpenClaw AI Gateway 管理工具。它将强大的 OpenClaw Gateway 打包成 FPK 格式，并提供了一个友好的 Web 管理界面，让你可以在飞牛 NAS 上轻松部署和管理 AI 智能体网关。

= 当前版本可以做什么

== 一键安装部署

- 在飞牛应用中心直接上传 FPK 安装包
- 自动安装 OpenClaw Gateway 和所有依赖
- 自动配置运行环境和端口

== Web 管理界面

- 直观的仪表板，实时查看 Gateway 运行状态
- 显示进程 PID、CPU 使用率、内存占用
- 一键启动/停止/重启 Gateway

== 模型管理

- 快速添加 AI 模型（支持 OpenAI、Anthropic、Google 等）
- 卡片式展示已配置的模型
- 支持编辑和删除模型
- 支持自定义 API 服务器地址（第三方代理、自建服务器）

== 消息渠道配置

- 支持 Telegram 机器人
- 支持 Discord 机器人
- 支持飞书机器人
- 可配置私信和群组策略
- 支持用户白名单

== 实时监控

- Gateway 运行状态监控
- 系统资源使用情况
- 配置摘要信息
- 版本信息查看

== 配置编辑器

- 可视化编辑 `openclaw.json` 配置文件
- JSON 格式实时验证
- 自动配置备份（保存前自动备份）

== 内嵌控制台

- 直接在管理界面中使用 OpenClaw 原生控制台
- 无需跳转，一站式管理

== 版本管理

- 查看当前 OpenClaw 版本
- 检查最新可用版本
- 一键更新到最新版本

#pagebreak()

= 当前版本不能做什么

== 配置实时同步

- 修改配置后需要手动重启 Gateway 才能生效
- 不支持配置热重载（虽然配置了 hybrid 模式，但需要手动触发）

== 界面主题切换

- 目前只有浅色主题
- 暂不支持深色模式

== 配置导入导出

- 不支持一键导出配置文件
- 不支持从文件导入配置

== 多架构支持

- 目前只支持 x86_64 架构
- 不支持 ARM 架构（如树莓派）

== UI 优化

- 标签页设计还比较基础
- 部分交互体验有待优化

== 消息渠道限制

- 不支持 WhatsApp
- 不支持微信
- 不支持 Slack
- 只支持 Telegram、Discord、飞书三种渠道

= 已知问题

== 安装时间较长

- 首次安装需要 2-3 分钟
- 进度条在 40% 时会停留较久（正在安装 npm 依赖）
- 请耐心等待，不要中断安装

== 端口冲突

- 如果 18789 或 18790 端口被占用，应用将无法启动
- 需要手动释放端口或修改配置

== 配置验证不完整

- JSON 格式验证只检查语法
- 不检查配置项的语义正确性（如 API Key 是否有效）

#pagebreak()

= 内测重点测试项

我们希望你重点测试以下功能，并反馈遇到的问题：

== 安装流程

- 安装是否顺利完成？
- 安装时间是否可接受？
- 是否遇到安装失败的情况？

== 模型配置

- 快速添加模型是否方便？
- 是否支持你使用的 AI 服务提供商？
- 自定义 Base URL 是否正常工作？

== 消息渠道

- Telegram/Discord/飞书机器人是否能正常连接？
- 私信和群组策略是否按预期工作？
- 白名单功能是否有效？

== 稳定性

- Gateway 是否稳定运行？
- 是否出现崩溃或自动退出？
- 内存和 CPU 占用是否正常？

== 用户体验

- 界面是否易用？
- 提示信息是否清晰？
- 是否有让你困惑的地方？

= 快速开始

== 第一步：安装

+ 下载 `oc-deploy_1.0.0_x86_64.fpk`
+ 在飞牛应用中心上传并安装
+ 等待安装完成（约 2-3 分钟）
+ 点击"启动"按钮

== 第二步：配置模型

+ 点击"打开"按钮进入管理界面
+ 切换到"🔧 配置管理"标签
+ 点击"➕ 快速添加模型"
+ 选择协议类型（OpenAI 或 Anthropic）
+ 填写模型信息和 API Key
+ 点击"添加模型"

== 第三步：启动 Gateway

+ 返回"📊 仪表板"标签
+ 点击"▶️ 启动 Gateway"
+ 等待状态变为"运行中"

== 第四步：配置消息渠道（可选）

+ 切换到"🔧 配置管理"标签
+ 点击"➕ 快速添加渠道"
+ 选择渠道类型（Telegram/Discord/Feishu）
+ 填写机器人配置信息
+ 点击"添加渠道"
+ 重启 Gateway 使配置生效

== 第五步：开始使用

+ 切换到"🎮 控制台"标签
+ 在内嵌控制台中使用 AI 功能
+ 或通过配置的消息渠道（Telegram/Discord/飞书）与机器人对话

= 反馈方式

如果你在使用过程中遇到问题或有改进建议，请通过以下方式反馈：

#block(
  fill: rgb("#f0f0f0"),
  inset: 1em,
  radius: 4pt,
)[
  *GitHub Issues*: #link("https://github.com/iridite/oc-deploy/issues")
]

请详细描述问题，包括：

- 操作步骤
- 预期结果
- 实际结果
- 错误信息（如有）
- 日志文件内容（位于 `/var/apps/oc-deploy/var/info.log`）

#v(2em)

#align(center)[
  #block(
    fill: rgb("#e8f4f8"),
    inset: 1.5em,
    radius: 6pt,
    width: 80%,
  )[
    #text(size: 14pt, weight: "bold")[
      感谢你参与 OC-Deploy 的内测！
    ]

    #v(0.5em)

    你的反馈将帮助我们改进产品，为更多用户提供更好的体验。
  ]
]
