import { splitFileName } from './rename-engine'
import type { FileEntry } from './types'

const names = [
  'IMG_20260718_001.JPG',
  'IMG_20260718_002.JPG',
  '会议 记录 最终版.docx',
  'download_copy (1).PDF',
  'Tokyo__Trip__video.MP4',
]

export function createDemoEntries(): FileEntry[] {
  return names.map((name, index) => {
    const { baseName, extension } = splitFileName(name)
    return {
      id: `demo-${index}`,
      name,
      baseName,
      extension,
      relativePath: index < 2 ? `photos/${name}` : name,
      parentPath: index < 2 ? 'photos' : '',
      size: (index + 1) * 1_048_576,
      lastModified: Date.now() - index * 86_400_000,
      type: '',
      selected: true,
      demo: true,
    }
  })
}
