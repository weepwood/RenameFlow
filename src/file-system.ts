import { splitFileName } from './rename-engine'
import type { FileEntry, RenameOperation, RenamePreview } from './types'

export function supportsDirectoryPicker(): boolean {
  return typeof window !== 'undefined' && typeof window.showDirectoryPicker === 'function'
}

export async function ensurePermission(
  handle: FileSystemHandle,
  mode: 'read' | 'readwrite',
): Promise<boolean> {
  const descriptor = { mode }
  if (handle.queryPermission && (await handle.queryPermission(descriptor)) === 'granted') return true
  if (handle.requestPermission && (await handle.requestPermission(descriptor)) === 'granted') return true
  return false
}

export async function scanDirectory(
  root: FileSystemDirectoryHandle,
  onProgress?: (count: number) => void,
): Promise<FileEntry[]> {
  const result: FileEntry[] = []
  let count = 0

  async function walk(directory: FileSystemDirectoryHandle, parentPath: string): Promise<void> {
    for await (const [name, handle] of directory.entries()) {
      if (handle.kind === 'directory') {
        const nextPath = parentPath ? `${parentPath}/${name}` : name
        await walk(handle, nextPath)
        continue
      }

      const fileHandle = handle as FileSystemFileHandle
      const file = await fileHandle.getFile()
      const { baseName, extension } = splitFileName(file.name)
      result.push({
        id: crypto.randomUUID(),
        name: file.name,
        baseName,
        extension,
        relativePath: parentPath ? `${parentPath}/${file.name}` : file.name,
        parentPath,
        size: file.size,
        lastModified: file.lastModified,
        type: file.type,
        selected: true,
        handle: fileHandle,
        parentHandle: directory,
      })
      count += 1
      if (count % 25 === 0) onProgress?.(count)
    }
  }

  await walk(root, '')
  onProgress?.(count)
  return result.sort((a, b) => a.relativePath.localeCompare(b.relativePath, 'zh-CN'))
}

async function copyThenDelete(
  item: RenamePreview,
): Promise<{ handle: FileSystemFileHandle; mode: 'copy-delete' }> {
  if (!item.parentHandle || !item.handle) throw new Error('文件句柄不可用')
  const source = await item.handle.getFile()
  const target = await item.parentHandle.getFileHandle(item.nextName, { create: true })
  const writable = await target.createWritable()
  try {
    await writable.write(source)
    await writable.close()
  } catch (error) {
    await writable.abort().catch(() => undefined)
    await item.parentHandle.removeEntry(item.nextName).catch(() => undefined)
    throw error
  }

  const copied = await target.getFile()
  if (copied.size !== source.size) {
    await item.parentHandle.removeEntry(item.nextName).catch(() => undefined)
    throw new Error('复制后文件大小校验失败')
  }

  await item.parentHandle.removeEntry(item.name)
  return { handle: target, mode: 'copy-delete' }
}

export async function executeRename(item: RenamePreview): Promise<{
  operation: RenameOperation
  mode: 'native-move' | 'copy-delete'
}> {
  if (!item.handle || !item.parentHandle) throw new Error('文件句柄不可用')
  if (!item.changed) throw new Error('文件名没有变化')

  try {
    if (typeof item.handle.move === 'function') {
      await item.handle.move(item.nextName)
      const resultingHandle = await item.parentHandle.getFileHandle(item.nextName)
      return {
        mode: 'native-move',
        operation: {
          id: crypto.randomUUID(),
          relativePath: item.relativePath,
          oldName: item.name,
          newName: item.nextName,
          status: 'completed',
          parentHandle: item.parentHandle,
          resultingHandle,
        },
      }
    }
  } catch {
    // Some Chromium builds expose move() but reject local filesystem moves.
  }

  const fallback = await copyThenDelete(item)
  return {
    mode: fallback.mode,
    operation: {
      id: crypto.randomUUID(),
      relativePath: item.relativePath,
      oldName: item.name,
      newName: item.nextName,
      status: 'completed',
      parentHandle: item.parentHandle,
      resultingHandle: fallback.handle,
    },
  }
}

export async function executeRenameBatch(
  items: RenamePreview[],
  onProgress?: (completed: number, total: number, name: string) => void,
): Promise<{ operations: RenameOperation[]; modes: Set<'native-move' | 'copy-delete'> }> {
  const staged: Array<{
    original: RenamePreview
    temporaryName: string
    handle: FileSystemFileHandle
    mode: 'native-move' | 'copy-delete'
  }> = []
  const operations: RenameOperation[] = []
  const modes = new Set<'native-move' | 'copy-delete'>()

  for (let index = 0; index < items.length; index += 1) {
    const item = items[index]
    const temporaryName = `.renameflow-${crypto.randomUUID()}.tmp`
    onProgress?.(index, items.length * 2, item.name)
    try {
      const result = await executeRename({ ...item, nextName: temporaryName, changed: true })
      modes.add(result.mode)
      if (!result.operation.resultingHandle) throw new Error('未能获得临时文件句柄')
      staged.push({
        original: item,
        temporaryName,
        handle: result.operation.resultingHandle,
        mode: result.mode,
      })
    } catch (error) {
      for (const stagedItem of [...staged].reverse()) {
        try {
          await rollbackOperation({
            id: crypto.randomUUID(),
            relativePath: stagedItem.original.relativePath,
            oldName: stagedItem.original.name,
            newName: stagedItem.temporaryName,
            status: 'completed',
            parentHandle: stagedItem.original.parentHandle,
            resultingHandle: stagedItem.handle,
          })
        } catch {
          // Recovery failure is surfaced by the returned operation records.
        }
      }
      return {
        operations: items.map((candidate) => ({
          id: crypto.randomUUID(),
          relativePath: candidate.relativePath,
          oldName: candidate.name,
          newName: candidate.nextName,
          status: 'failed',
          error: candidate.id === item.id
            ? error instanceof Error ? error.message : '临时重命名失败'
            : '批次已中止，未执行最终名称',
          parentHandle: candidate.parentHandle,
        })),
        modes,
      }
    }
  }

  for (let index = 0; index < staged.length; index += 1) {
    const item = staged[index]
    onProgress?.(staged.length + index, items.length * 2, item.original.nextName)
    try {
      const { baseName, extension } = splitFileName(item.temporaryName)
      const result = await executeRename({
        ...item.original,
        name: item.temporaryName,
        baseName,
        extension,
        handle: item.handle,
        nextName: item.original.nextName,
        changed: true,
      })
      modes.add(result.mode)
      operations.push({
        ...result.operation,
        relativePath: item.original.relativePath,
        oldName: item.original.name,
        newName: item.original.nextName,
      })
    } catch (error) {
      let recoveryError = ''
      try {
        await rollbackOperation({
          id: crypto.randomUUID(),
          relativePath: item.original.relativePath,
          oldName: item.original.name,
          newName: item.temporaryName,
          status: 'completed',
          parentHandle: item.original.parentHandle,
          resultingHandle: item.handle,
        })
      } catch (rollbackError) {
        recoveryError = `；恢复原名称也失败：${rollbackError instanceof Error ? rollbackError.message : '未知错误'}`
      }
      operations.push({
        id: crypto.randomUUID(),
        relativePath: item.original.relativePath,
        oldName: item.original.name,
        newName: item.original.nextName,
        status: 'failed',
        error: `${error instanceof Error ? error.message : '最终重命名失败'}${recoveryError}`,
        parentHandle: item.original.parentHandle,
      })
    }
  }

  onProgress?.(items.length * 2, items.length * 2, '完成')
  return { operations, modes }
}

export async function rollbackOperation(operation: RenameOperation): Promise<RenameOperation> {
  const { parentHandle, resultingHandle } = operation
  if (!parentHandle || !resultingHandle) throw new Error('当前会话不再持有文件句柄')

  const currentFile = await resultingHandle.getFile()
  if (typeof resultingHandle.move === 'function') {
    try {
      await resultingHandle.move(operation.oldName)
      return { ...operation, status: 'rolled-back' }
    } catch {
      // Use verified copy-delete fallback below.
    }
  }

  const restored = await parentHandle.getFileHandle(operation.oldName, { create: true })
  const writable = await restored.createWritable()
  await writable.write(currentFile)
  await writable.close()
  const restoredFile = await restored.getFile()
  if (restoredFile.size !== currentFile.size) throw new Error('恢复后的文件大小校验失败')
  await parentHandle.removeEntry(operation.newName)
  return { ...operation, status: 'rolled-back', resultingHandle: restored }
}
