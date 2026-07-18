import { useMemo, useState } from 'react'
import {
  CheckCircle2,
  ChevronDown,
  Download,
  FileCheck2,
  FileWarning,
  FolderOpen,
  History,
  Info,
  Play,
  RefreshCw,
  RotateCcw,
  Search,
  ShieldCheck,
  Trash2,
  WandSparkles,
} from 'lucide-react'
import { createDemoEntries } from './demo'
import { createCsv, createPowerShell, downloadText } from './exporters'
import {
  ensurePermission,
  executeRenameBatch,
  rollbackOperation,
  scanDirectory,
  supportsDirectoryPicker,
} from './file-system'
import { clearHistory, loadHistory, saveHistory } from './history'
import { createPreviews, DEFAULT_RULES } from './rename-engine'
import type { FileEntry, HistoryRecord, RenameOperation, RuleConfig } from './types'
import './styles.css'

function formatBytes(bytes: number): string {
  if (bytes === 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  const index = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1)
  return `${(bytes / 1024 ** index).toFixed(index === 0 ? 0 : 1)} ${units[index]}`
}

function App() {
  const [directory, setDirectory] = useState<FileSystemDirectoryHandle | null>(null)
  const [directoryName, setDirectoryName] = useState('未选择目录')
  const [entries, setEntries] = useState<FileEntry[]>([])
  const [rules, setRules] = useState<RuleConfig>(DEFAULT_RULES)
  const [query, setQuery] = useState('')
  const [onlyChanged, setOnlyChanged] = useState(false)
  const [scanCount, setScanCount] = useState(0)
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('选择一个目录，或先加载示例数据。')
  const [lastOperations, setLastOperations] = useState<RenameOperation[]>([])
  const [history, setHistory] = useState<HistoryRecord[]>(() => loadHistory())

  const previews = useMemo(() => createPreviews(entries, rules), [entries, rules])
  const visible = useMemo(() => {
    const needle = query.trim().toLocaleLowerCase()
    return previews.filter((item) => {
      if (needle && !item.relativePath.toLocaleLowerCase().includes(needle)) return false
      if (onlyChanged && !item.changed) return false
      return true
    })
  }, [previews, query, onlyChanged])

  const selectedCount = previews.filter((item) => item.selected).length
  const changedCount = previews.filter((item) => item.selected && item.changed).length
  const issueCount = previews.filter((item) => item.selected && item.issues.length > 0).length

  function updateRule<K extends keyof RuleConfig>(key: K, value: RuleConfig[K]) {
    setRules((current) => ({ ...current, [key]: value }))
  }

  async function chooseDirectory() {
    if (!supportsDirectoryPicker() || !window.showDirectoryPicker) {
      setMessage('当前浏览器不支持目录写入。建议使用最新版 Chrome 或 Edge，或导出 PowerShell 脚本。')
      return
    }
    try {
      setBusy(true)
      const handle = await window.showDirectoryPicker({ mode: 'read' })
      const granted = await ensurePermission(handle, 'read')
      if (!granted) throw new Error('未获得目录读取权限')
      setDirectory(handle)
      setDirectoryName(handle.name)
      setScanCount(0)
      const files = await scanDirectory(handle, setScanCount)
      setEntries(files)
      setLastOperations([])
      setMessage(`已扫描 ${files.length} 个文件。所有分析均在本地完成。`)
    } catch (error) {
      if ((error as DOMException).name !== 'AbortError') {
        setMessage(error instanceof Error ? error.message : '读取目录失败')
      }
    } finally {
      setBusy(false)
    }
  }

  async function refreshDirectory() {
    if (!directory) return
    setBusy(true)
    try {
      const files = await scanDirectory(directory, setScanCount)
      setEntries(files)
      setLastOperations([])
      setMessage(`目录已刷新，共 ${files.length} 个文件。`)
    } catch (error) {
      setMessage(error instanceof Error ? error.message : '刷新失败')
    } finally {
      setBusy(false)
    }
  }

  function loadDemo() {
    setDirectory(null)
    setDirectoryName('示例工作区')
    setEntries(createDemoEntries())
    setLastOperations([])
    setRules({
      ...DEFAULT_RULES,
      find: 'IMG_',
      replace: '旅行-',
      normalizeSeparators: true,
      numbering: true,
    })
    setMessage('已加载示例数据。示例模式只预览，不会修改文件。')
  }

  function toggleAll(selected: boolean) {
    setEntries((current) => current.map((item) => ({ ...item, selected })))
  }

  function toggleOne(id: string) {
    setEntries((current) => current.map((item) => (item.id === id ? { ...item, selected: !item.selected } : item)))
  }

  async function runRename() {
    const targets = previews.filter((item) => item.selected && item.changed)
    if (targets.length === 0) {
      setMessage('没有需要执行的名称变化。')
      return
    }
    if (issueCount > 0) {
      setMessage('请先解决所有冲突和非法名称。')
      return
    }
    if (!directory || targets.some((item) => item.demo)) {
      setMessage('示例模式不会修改文件。你可以导出 CSV 或 PowerShell 脚本。')
      return
    }

    setBusy(true)
    const granted = await ensurePermission(directory, 'readwrite')
    if (!granted) {
      setMessage('未获得目录写入权限。')
      setBusy(false)
      return
    }

    const batch = await executeRenameBatch(targets, (completed, total, name) => {
      setMessage(`正在处理 ${completed}/${total}：${name}`)
    })
    const operations = batch.operations
    const modes = batch.modes
    const successful = operations.filter((item) => item.status === 'completed')
    const failed = operations.filter((item) => item.status === 'failed')
    const mode = modes.size > 1 ? 'mixed' : (Array.from(modes)[0] ?? 'copy-delete')
    const record: HistoryRecord = {
      id: crypto.randomUUID(),
      createdAt: Date.now(),
      directoryName,
      executionMode: mode as HistoryRecord['executionMode'],
      completed: successful.length,
      failed: failed.length,
      operations: operations.map(({ parentHandle: _parent, resultingHandle: _result, ...item }) => item),
    }
    setHistory(saveHistory(record))
    setLastOperations(successful)
    const files = await scanDirectory(directory, setScanCount)
    setEntries(files)
    setMessage(`执行完成：成功 ${successful.length}，失败 ${failed.length}。`)
    setBusy(false)
  }

  async function undoLast() {
    if (lastOperations.length === 0) {
      setMessage('当前会话没有可撤销操作。')
      return
    }
    setBusy(true)
    let restored = 0
    for (const operation of [...lastOperations].reverse()) {
      try {
        await rollbackOperation(operation)
        restored += 1
      } catch (error) {
        setMessage(`已恢复 ${restored} 个文件；${operation.newName} 恢复失败：${error instanceof Error ? error.message : '未知错误'}`)
        setBusy(false)
        return
      }
    }
    setLastOperations([])
    if (directory) setEntries(await scanDirectory(directory, setScanCount))
    setMessage(`已尝试撤销并恢复 ${restored} 个文件。`)
    setBusy(false)
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <div className="brand">
          <div className="brand-mark"><WandSparkles size={20} /></div>
          <div>
            <strong>RenameFlow</strong>
            <span>本地文件批量重命名工作台</span>
          </div>
        </div>
        <div className="top-actions">
          <span className="privacy-pill"><ShieldCheck size={15} /> 文件不上传</span>
          <button className="button secondary" onClick={loadDemo}>示例数据</button>
          <button className="button primary" onClick={chooseDirectory} disabled={busy}>
            <FolderOpen size={17} /> 选择文件夹
          </button>
        </div>
      </header>

      <main className="workspace">
        <aside className="sidebar left-panel">
          <div className="panel-heading">
            <div><span className="eyebrow">WORKSPACE</span><h2>文件工作区</h2></div>
            <button className="icon-button" onClick={refreshDirectory} disabled={!directory || busy} title="刷新目录"><RefreshCw size={17} /></button>
          </div>
          <div className="directory-card">
            <div className="folder-icon"><FolderOpen size={21} /></div>
            <div><strong>{directoryName}</strong><span>{entries.length ? `${entries.length} 个文件` : '等待选择目录'}</span></div>
          </div>
          <div className="stats-grid">
            <div><span>已选择</span><strong>{selectedCount}</strong></div>
            <div><span>将变更</span><strong>{changedCount}</strong></div>
            <div><span>需处理</span><strong className={issueCount ? 'danger-text' : ''}>{issueCount}</strong></div>
            <div><span>扫描进度</span><strong>{scanCount}</strong></div>
          </div>
          <div className="section-title"><History size={16} /> 最近操作</div>
          <div className="history-list">
            {history.length === 0 && <p className="empty-note">暂无操作记录</p>}
            {history.slice(0, 5).map((record) => (
              <div className="history-item" key={record.id}>
                <div><strong>{record.directoryName}</strong><span>{new Date(record.createdAt).toLocaleString()}</span></div>
                <span>{record.completed} 成功</span>
              </div>
            ))}
          </div>
          {history.length > 0 && (
            <button className="text-button" onClick={() => { clearHistory(); setHistory([]) }}><Trash2 size={14} /> 清除历史</button>
          )}
        </aside>

        <section className="content-panel">
          <div className="content-toolbar">
            <div className="search-box"><Search size={17} /><input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索文件名或路径" /></div>
            <label className="switch-row compact"><input type="checkbox" checked={onlyChanged} onChange={(event) => setOnlyChanged(event.target.checked)} /><span>仅看变化</span></label>
            <div className="export-menu">
              <button className="button secondary"><Download size={16} /> 导出 <ChevronDown size={14} /></button>
              <div className="export-popover">
                <button onClick={() => downloadText('renameflow-plan.csv', createCsv(previews), 'text/csv;charset=utf-8')}>导出 CSV 方案</button>
                <button onClick={() => downloadText('renameflow.ps1', createPowerShell(previews))}>导出 PowerShell</button>
                <button onClick={() => downloadText('renameflow-plan.json', JSON.stringify(previews.filter((item) => item.selected), null, 2), 'application/json')}>导出 JSON</button>
              </div>
            </div>
          </div>

          <div className="table-wrap">
            <table>
              <thead><tr>
                <th className="check-cell"><input type="checkbox" checked={entries.length > 0 && selectedCount === entries.length} onChange={(event) => toggleAll(event.target.checked)} /></th>
                <th>原文件名</th><th>新文件名</th><th>位置</th><th>大小</th><th>状态</th>
              </tr></thead>
              <tbody>
                {visible.map((item) => (
                  <tr key={item.id} className={item.issues.length ? 'row-error' : item.changed ? 'row-changed' : ''}>
                    <td className="check-cell"><input type="checkbox" checked={item.selected} onChange={() => toggleOne(item.id)} /></td>
                    <td><div className="file-name"><FileCheck2 size={16} /><span>{item.name}</span></div></td>
                    <td><span className={item.changed ? 'next-name' : 'muted'}>{item.nextName}</span></td>
                    <td className="muted">{item.parentPath || '根目录'}</td>
                    <td className="muted">{formatBytes(item.size)}</td>
                    <td>
                      {item.issues.length > 0 ? <span className="status error"><FileWarning size={14} /> {item.issues[0]}</span>
                        : item.changed ? <span className="status ready"><CheckCircle2 size={14} /> 待执行</span>
                          : <span className="status unchanged">无变化</span>}
                    </td>
                  </tr>
                ))}
                {visible.length === 0 && <tr><td colSpan={6}><div className="empty-state"><FolderOpen size={30} /><strong>没有可显示的文件</strong><span>选择一个文件夹或加载示例数据</span></div></td></tr>}
              </tbody>
            </table>
          </div>

          <div className="execution-bar">
            <div><Info size={17} /><span>{message}</span></div>
            <div className="execution-actions">
              <button className="button secondary" onClick={undoLast} disabled={busy || lastOperations.length === 0}><RotateCcw size={16} /> 尝试撤销</button>
              <button className="button execute" onClick={runRename} disabled={busy || changedCount === 0 || issueCount > 0}><Play size={16} /> {busy ? '处理中…' : `执行 ${changedCount} 项`}</button>
            </div>
          </div>
        </section>

        <aside className="sidebar rule-panel">
          <div className="panel-heading"><div><span className="eyebrow">RULE PIPELINE</span><h2>重命名规则</h2></div></div>
          <div className="rule-stack">
            <label><span>添加前缀</span><input value={rules.prefix} onChange={(event) => updateRule('prefix', event.target.value)} placeholder="例如：旅行-" /></label>
            <label><span>添加后缀</span><input value={rules.suffix} onChange={(event) => updateRule('suffix', event.target.value)} placeholder="例如：-已整理" /></label>
            <div className="rule-card">
              <div className="rule-card-title">查找与替换</div>
              <label><span>查找</span><input value={rules.find} onChange={(event) => updateRule('find', event.target.value)} placeholder="IMG_" /></label>
              <label><span>替换为</span><input value={rules.replace} onChange={(event) => updateRule('replace', event.target.value)} placeholder="PHOTO_" /></label>
              <div className="inline-options">
                <label><input type="checkbox" checked={rules.useRegex} onChange={(event) => updateRule('useRegex', event.target.checked)} />正则</label>
                <label><input type="checkbox" checked={rules.caseInsensitive} onChange={(event) => updateRule('caseInsensitive', event.target.checked)} />忽略大小写</label>
              </div>
            </div>
            <div className="rule-card">
              <label className="switch-row"><span><strong>自动编号</strong><small>按当前排序追加序号</small></span><input type="checkbox" checked={rules.numbering} onChange={(event) => updateRule('numbering', event.target.checked)} /></label>
              {rules.numbering && <div className="number-grid">
                <label><span>起始</span><input type="number" min="0" value={rules.numberStart} onChange={(event) => updateRule('numberStart', Number(event.target.value))} /></label>
                <label><span>位数</span><input type="number" min="1" max="8" value={rules.numberPadding} onChange={(event) => updateRule('numberPadding', Number(event.target.value))} /></label>
              </div>}
            </div>
            <label className="switch-row"><span><strong>清理空格与下划线</strong><small>统一转换为连字符</small></span><input type="checkbox" checked={rules.normalizeSeparators} onChange={(event) => updateRule('normalizeSeparators', event.target.checked)} /></label>
            <label className="switch-row"><span><strong>扩展名小写</strong><small>JPG → jpg</small></span><input type="checkbox" checked={rules.lowercaseExtension} onChange={(event) => updateRule('lowercaseExtension', event.target.checked)} /></label>
            <label className="switch-row"><span><strong>Windows 安全名称</strong><small>替换非法字符</small></span><input type="checkbox" checked={rules.sanitizeForWindows} onChange={(event) => updateRule('sanitizeForWindows', event.target.checked)} /></label>
          </div>
          <button className="reset-button" onClick={() => setRules(DEFAULT_RULES)}>重置全部规则</button>
        </aside>
      </main>
    </div>
  )
}

export default App
