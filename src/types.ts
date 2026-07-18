export type RuleConfig = {
  prefix: string
  suffix: string
  find: string
  replace: string
  useRegex: boolean
  caseInsensitive: boolean
  trim: boolean
  normalizeSeparators: boolean
  lowercaseExtension: boolean
  sanitizeForWindows: boolean
  numbering: boolean
  numberStart: number
  numberPadding: number
  numberSeparator: string
}

export type FileEntry = {
  id: string
  name: string
  baseName: string
  extension: string
  relativePath: string
  parentPath: string
  size: number
  lastModified: number
  type: string
  selected: boolean
  handle?: FileSystemFileHandle
  parentHandle?: FileSystemDirectoryHandle
  demo?: boolean
}

export type RenamePreview = FileEntry & {
  nextName: string
  changed: boolean
  issues: string[]
}

export type RenameOperation = {
  id: string
  relativePath: string
  oldName: string
  newName: string
  status: 'completed' | 'failed' | 'rolled-back'
  error?: string
  parentHandle?: FileSystemDirectoryHandle
  resultingHandle?: FileSystemFileHandle
}

export type HistoryRecord = {
  id: string
  createdAt: number
  directoryName: string
  executionMode: 'native-move' | 'copy-delete' | 'mixed' | 'demo'
  completed: number
  failed: number
  operations: Array<Omit<RenameOperation, 'parentHandle' | 'resultingHandle'>>
}
