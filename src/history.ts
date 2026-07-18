import type { HistoryRecord } from './types'

const KEY = 'renameflow.history.v1'

export function loadHistory(): HistoryRecord[] {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw) as HistoryRecord[]
    return Array.isArray(parsed) ? parsed.slice(0, 20) : []
  } catch {
    return []
  }
}

export function saveHistory(record: HistoryRecord): HistoryRecord[] {
  const next = [record, ...loadHistory()].slice(0, 20)
  localStorage.setItem(KEY, JSON.stringify(next))
  return next
}

export function clearHistory(): void {
  localStorage.removeItem(KEY)
}
