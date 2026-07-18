import type { RenamePreview } from './types'

function escapeCsv(value: string): string {
  return `"${value.replaceAll('"', '""')}"`
}

export function createCsv(previews: RenamePreview[]): string {
  const rows = previews
    .filter((item) => item.selected)
    .map((item) => [item.relativePath, item.name, item.nextName, item.issues.join('; ')])
  return ['path,old_name,new_name,issues', ...rows.map((row) => row.map(escapeCsv).join(','))].join('\n')
}

function quotePowerShell(value: string): string {
  return `'${value.replaceAll("'", "''")}'`
}

export function createPowerShell(previews: RenamePreview[]): string {
  const lines = previews
    .filter((item) => item.selected && item.changed && item.issues.length === 0)
    .map((item) => {
      const path = item.parentPath ? `${item.parentPath}\\${item.name}` : item.name
      return `Rename-Item -LiteralPath ${quotePowerShell(path)} -NewName ${quotePowerShell(item.nextName)}`
    })
  return ['# RenameFlow generated script', "$ErrorActionPreference = 'Stop'", ...lines].join('\n')
}

export function downloadText(filename: string, content: string, type = 'text/plain;charset=utf-8'): void {
  const blob = new Blob([content], { type })
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a')
  anchor.href = url
  anchor.download = filename
  anchor.click()
  URL.revokeObjectURL(url)
}
