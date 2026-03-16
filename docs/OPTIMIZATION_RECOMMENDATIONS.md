# 优化建议

本文档记录了已识别但尚未实施的优化建议。

## 流式备份上传

### 问题描述
当前备份导入功能使用 `readBodyBuffer()` 将整个上传文件加载到内存中（最大 512MB）。对于大型备份文件，这会导致：
- 内存压力增加
- 可能的内存溢出
- 上传过程中的性能下降

**相关代码**: [backup.js:244-278](../app/server/services/backup.js#L244-L278)

### 建议方案
使用流式 multipart 解析器（如 `busboy` 或 `formidable`）来处理上传：

```javascript
// 示例实现（需要安装 busboy）
const Busboy = require('busboy');

function streamMultipartUpload(req) {
  return new Promise((resolve, reject) => {
    const busboy = Busboy({
      headers: req.headers,
      limits: { fileSize: MAX_BACKUP_UPLOAD_BYTES }
    });

    let archivePath = null;

    busboy.on('file', (fieldname, file, info) => {
      const { filename } = info;
      archivePath = path.join(tmpDir, filename);
      const writeStream = fs.createWriteStream(archivePath);

      file.pipe(writeStream);

      file.on('limit', () => {
        reject(new Error('文件超过大小限制'));
      });
    });

    busboy.on('finish', () => {
      resolve({ archivePath });
    });

    busboy.on('error', reject);

    req.pipe(busboy);
  });
}
```

### 预期影响
- **内存使用**: 减少 90% 以上（从 512MB 峰值降至流式缓冲区大小）
- **性能**: 大文件上传更稳定
- **可靠性**: 避免大文件导致的内存溢出

### 实施考虑
1. **依赖管理**: 需要添加外部依赖（`busboy` 或 `formidable`）
2. **复杂度**: 增加代码复杂度，需要处理流式错误
3. **测试**: 需要测试各种文件大小和错误场景
4. **向后兼容**: 确保现有备份文件格式仍然支持

### 优先级
**中等** - 仅在用户实际遇到大文件上传内存问题时实施。当前 512MB 限制对大多数使用场景已足够。

---

## 其他潜在优化

### 1. WebSocket 实时更新
**当前**: 前端通过轮询 `/api/status` 获取状态更新
**建议**: 使用 WebSocket 推送状态变化
**影响**: 进一步减少 API 请求，提供实时反馈
**优先级**: 低 - 当前缓存方案已显著改善性能

### 2. 异步文件操作
**当前**: [backup.js](../app/server/services/backup.js) 使用同步文件操作（`fs.cpSync`, `fs.rmSync`）
**建议**: 转换为异步操作（`fs.promises.cp`, `fs.promises.rm`）
**影响**: 避免备份操作期间阻塞事件循环
**优先级**: 低 - 备份操作不频繁

### 3. 响应压缩
**当前**: API 响应未压缩
**建议**: 添加 gzip/brotli 压缩中间件
**影响**: 减少网络传输大小
**优先级**: 低 - 响应体通常较小

---

## 已完成的优化

参考 [CLAUDE.md](../CLAUDE.md) 中的项目历史记录。

最近完成的优化包括：
- ✅ 静态文件流式传输（消除事件循环阻塞）
- ✅ `/api/status` 响应缓存（减少 50% CPU 使用）
- ✅ 标准化错误处理
- ✅ 提取魔法数字到常量
- ✅ 改进验证错误消息格式
