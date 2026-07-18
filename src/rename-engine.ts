import type { FileEntry, RenamePreview, RuleConfig } from './types'

export const DEFAULT_RULES: RuleConfig = {
  prefix: '',
  suffix: '',
  find: '',
  replace: '',
  useRegex: false,
  caseInsensitive: true,
  trim: true,
  normalizeSeparators: false,
  lowercaseExtension: true,
  sanitizeForWindows: true,
  numbering: false,
  numberStart: 1,
  numberPadding: 3,
  numberSeparator: '-',
}

export function splitFileName(name: string): { baseName: string; extension: string } {
  const lastDot = name.lastIndexOf('.')
  if (lastDot <= 0) return { baseName: name, extension: '' }
  return { baseName: name.slice(0, lastDot), extension: name.slice(lastDot + 1) }
}

function applyFindReplace(value: string, rules: RuleConfig): string {
  if (!rules.find) return value

  if (rules.useRegex) {
    try {
      const flags = rules.caseInsensitive ? 'gi' : 'g'
      return value.replace(new RegExp(rules.find, flags), rules.replace)
    } catch {
      return value
    }
  }

  if (rules.caseInsensitive) {
    const escaped = rules.find.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    return value.replace(new RegExp(escaped, 'gi'), rules.replace)
  }

  return value.split(rules.find).join(rules.replace)
}

export function sanitizeName(value: string): string {
  return value
    .replace(/[\\/:*?"<>|\u0000-\u001F]/g, '-')
    .replace(/[ .]+$/g, '')
    .replace(/-{2,}/g, '-')
}

export function buildName(entry: FileEntry, rules: RuleConfig, selectedIndex: number): string {
  let base = applyFindReplace(entry.baseName, rules)
  if (rules.trim) base = base.trim()
  if (rules.normalizeSeparators) base = base.replace(/[\s_]+/g, '-').replace(/-{2,}/g, '-')
  if (rules.sanitizeForWindows) base = sanitizeName(base)

  const sequence = rules.numbering
    ? `${rules.numberSeparator}${String(rules.numberStart + selectedIndex).padStart(rules.numberPadding, '0')}`
    : ''

  let extension = entry.extension
  if (rules.lowercaseExtension) extension = extension.toLowerCase()

  const finalBase = `${rules.prefix}${base}${rules.suffix}${sequence}` || 'untitled'
  return extension ? `${finalBase}.${extension}` : finalBase
}

const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i

export function validateName(name: string): string[] {
  const issues: string[] = []
  if (!name.trim()) issues.push('文件名不能为空')
  if (/[\\/:*?"<>|\u0000-\u001F]/.test(name)) issues.push('包含 Windows 非法字符')
  if (/[ .]$/.test(name)) issues.push('不能以空格或句点结尾')
  if (WINDOWS_RESERVED.test(name)) issues.push('使用了 Windows 保留名称')
  if (new TextEncoder().encode(name).length > 255) issues.push('文件名超过 255 字节')
  return issues
}

export function createPreviews(entries: FileEntry[], rules: RuleConfig): RenamePreview[] {
  let selectedIndex = 0
  const previews = entries.map((entry) => {
    const nextName = entry.selected ? buildName(entry, rules, selectedIndex++) : entry.name
    return {
      ...entry,
      nextName,
      changed: entry.selected && nextName !== entry.name,
      issues: entry.selected ? validateName(nextName) : [],
    }
  })

  const selected = previews.filter((item) => item.selected)
  const counts = new Map<string, number>()
  for (const item of selected) {
    const key = `${item.parentPath}/${item.nextName}`.toLocaleLowerCase()
    counts.set(key, (counts.get(key) ?? 0) + 1)
  }

  const untouched = new Set(
    previews
      .filter((item) => !item.selected || !item.changed)
      .map((item) => `${item.parentPath}/${item.name}`.toLocaleLowerCase()),
  )

  return previews.map((item) => {
    if (!item.selected) return item
    const issues = [...item.issues]
    const targetKey = `${item.parentPath}/${item.nextName}`.toLocaleLowerCase()
    if ((counts.get(targetKey) ?? 0) > 1) issues.push('批次内目标名称重复')
    if (item.changed && untouched.has(targetKey)) issues.push('目标名称已被现有文件占用')
    return { ...item, issues }
  })
}
