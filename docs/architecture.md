# 架构设计

## 模块

- `rename-engine.ts`：纯函数规则引擎、文件名验证、冲突检测。
- `file-system.ts`：目录扫描、权限检查、两阶段重命名执行与回滚。
- `exporters.ts`：CSV、JSON、PowerShell 方案导出。
- `history.ts`：浏览器本地操作历史。
- `App.tsx`：工作台状态编排与用户界面。

## 数据流

```text
DirectoryHandle
  -> scanDirectory
  -> FileEntry[]
  -> createPreviews(rules)
  -> RenamePreview[]
  -> conflict validation
  -> executeRenameBatch
  -> HistoryRecord
```

规则引擎不访问文件系统，因此可以独立测试。文件系统适配器只接受已经验证的重命名任务。

## 执行策略

1. 检查目标名称是否合法。
2. 检查同一目录内的目标名称冲突。
3. 执行前请求 `readwrite` 权限。
4. 把全部源文件先改为唯一临时名称，释放最终目标名称。
5. 再从临时名称改为最终名称，以支持交换、大小写变更和连续重命名链。
6. 优先调用 `FileSystemFileHandle.move()`。
7. 若不可用或失败，使用复制、大小校验、删除原文件的兼容流程。
8. 记录成功与失败结果，重新扫描目录。

当前 MVP 不支持文件夹重命名、跨目录移动、后台监听与跨会话可靠撤销。
