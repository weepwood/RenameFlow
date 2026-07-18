import { describe, expect, it } from 'vitest'
import { buildName, createPreviews, DEFAULT_RULES, sanitizeName, splitFileName } from '../rename-engine'
import type { FileEntry } from '../types'

function entry(name: string, parentPath = ''): FileEntry {
  const { baseName, extension } = splitFileName(name)
  return {
    id: name,
    name,
    baseName,
    extension,
    relativePath: parentPath ? `${parentPath}/${name}` : name,
    parentPath,
    size: 1,
    lastModified: 0,
    type: '',
    selected: true,
  }
}

describe('rename engine', () => {
  it('splits compound-looking names at the last dot', () => {
    expect(splitFileName('archive.tar.gz')).toEqual({ baseName: 'archive.tar', extension: 'gz' })
    expect(splitFileName('.gitignore')).toEqual({ baseName: '.gitignore', extension: '' })
  })

  it('applies replacement, normalization, numbering and extension casing', () => {
    const result = buildName(entry('IMG_My  Photo.JPG'), {
      ...DEFAULT_RULES,
      find: 'IMG_',
      replace: '',
      normalizeSeparators: true,
      numbering: true,
      numberStart: 7,
      numberPadding: 3,
    }, 0)
    expect(result).toBe('My-Photo-007.jpg')
  })

  it('sanitizes Windows-invalid characters', () => {
    expect(sanitizeName('report:*?  ')).toBe('report-')
  })

  it('detects duplicate targets case-insensitively', () => {
    const previews = createPreviews([entry('A.txt'), entry('a.TXT')], {
      ...DEFAULT_RULES,
      find: 'A',
      replace: 'same',
      caseInsensitive: true,
    })
    expect(previews.every((item) => item.issues.includes('批次内目标名称重复'))).toBe(true)
  })
})
