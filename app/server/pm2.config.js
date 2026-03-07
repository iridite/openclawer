module.exports = {
  apps: [
    {
      name: "openclaw-gateway",

      // 1. 核心执行逻辑
      // 工作目录：定位到 openclaw 命令所在的 .bin 目录
      cwd: "/var/apps/oc-deploy/var/node_modules/.bin",
      // 执行脚本：当前目录下的 openclaw 文件
      script: "./openclaw",
      // 运行参数：直接传给 openclaw
      args: "gateway ", // --allow-unconfigured" 这个还是不保留了，那么就需要第一次尽快生成 token 并写入 openclaw.json
      // 解释器：强制指定你 NAS 上的 Node.js 绝对路径 (极其关键！)
      interpreter: "/var/apps/nodejs_v22/target/bin/node",

      // 2. 环境变量 (把沙盒路径死死锁在这里)
      env: {
        // 目前我们把 OC 相关的文件都放置在 /root 下面，没有权限问题，但是要注意 fnos 升级是否会影响
        // OPENCLAW_CONFIG_PATH: "/var/apps/oc-deploy/target/data/openclaw.json",
        // OPENCLAW_DATA_DIR: "/var/apps/oc-deploy/target/data/data",
      },

      // 3. 守护与资源管控
      autorestart: true, // 崩溃自动拉起
      max_restarts: 3, // 连续重启10次失败则放弃（防死循环）
      max_memory_restart: "4G", // 内存泄漏保护：超过1G自动重启

      // 4. 日志重定向
      // 注意：请务必提前使用 mkdir -p 创建好 logs 这个文件夹，否则 PM2 会报错！
      error_file: "/var/apps/oc-deploy/var/openclaw-error.log",
      out_file: "/var/apps/oc-deploy/var/openclaw-out.log",
      merge_logs: true, // 合并日志输出
      time: true, // 在日志前自动加上标准时间戳
    },
  ],
};
