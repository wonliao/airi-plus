import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  LlmWikiQueryMode,
  LlmWikiQueryPayload,
  LlmWikiQueryResult,
  LlmWikiQueryResultItem,
  LlmWikiWorkspaceValidationPayload,
  LlmWikiWorkspaceValidationResult,
} from '@proj-airi/stage-shared'

import { constants } from 'node:fs'
import { access, readdir, readFile, stat } from 'node:fs/promises'
import { basename, extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { electronQueryLlmWiki, electronValidateLlmWikiWorkspace } from '@proj-airi/stage-shared'

function ensureTrailingSeparator(value: string) {
  return value.endsWith(sep) ? value : `${value}${sep}`
}

function isPathInsideWorkspace(workspacePath: string, targetPath: string) {
  if (targetPath === workspacePath) {
    return true
  }

  return ensureTrailingSeparator(targetPath).startsWith(ensureTrailingSeparator(workspacePath))
}

function resolveWorkspaceFilePath(workspacePath: string, filePath: string) {
  return normalize(isAbsolute(filePath) ? resolve(filePath) : resolve(workspacePath, filePath))
}

async function assertReadableDirectory(path: string, label: string) {
  await access(path, constants.R_OK)
  const target = await stat(path)
  if (!target.isDirectory()) {
    throw new Error(`${label} must point to an existing directory.`)
  }
}

async function assertReadableFile(path: string, label: string) {
  await access(path, constants.R_OK)
  const target = await stat(path)
  if (!target.isFile()) {
    throw new Error(`${label} must point to an existing file.`)
  }
}

interface SearchDocument {
  kind: 'index' | 'overview' | 'page'
  path: string
  relativePath: string
  title: string
  content: string
}

function stripFrontmatter(content: string) {
  return content.replace(/^---\n[\s\S]*?\n---\n?/u, '').trim()
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(/\s+/g, ' ')
    .trim()
}

function extractSearchTerms(query: string) {
  const normalized = normalizeSearchText(query)
  const terms = new Set<string>()

  if (normalized) {
    terms.add(normalized)
  }

  for (const token of normalized.match(/[\p{L}\p{N}][\p{L}\p{N}-]*/gu) ?? []) {
    if (token.length >= 2) {
      terms.add(token)
    }
  }

  for (const chunk of normalized.match(/\p{Script=Han}+/gu) ?? []) {
    if (chunk.length >= 2) {
      terms.add(chunk)
    }

    if (chunk.length > 3) {
      for (let size = 2; size <= Math.min(4, chunk.length); size += 1) {
        for (let index = 0; index <= chunk.length - size; index += 1) {
          terms.add(chunk.slice(index, index + size))
        }
      }
    }
  }

  return Array.from(terms, term => term.trim())
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .slice(0, 16)
}

function getKindWeight(kind: SearchDocument['kind'], queryMode: LlmWikiQueryMode) {
  if (queryMode === 'digest') {
    return kind === 'overview' ? 18 : kind === 'index' ? 14 : 4
  }

  if (queryMode === 'query') {
    return kind === 'page' ? 12 : kind === 'overview' ? 4 : 3
  }

  return kind === 'overview' ? 10 : kind === 'page' ? 9 : 7
}

function scoreDocument(document: SearchDocument, query: string, queryMode: LlmWikiQueryMode, terms: string[]) {
  const haystack = normalizeSearchText(`${document.title}\n${document.relativePath}\n${document.content}`)
  const normalizedQuery = normalizeSearchText(query)

  let score = getKindWeight(document.kind, queryMode)

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    score += 28
  }

  for (const term of terms) {
    if (!term) {
      continue
    }

    if (normalizeSearchText(document.title).includes(term)) {
      score += 16
    }

    if (normalizeSearchText(document.relativePath).includes(term)) {
      score += 10
    }

    if (haystack.includes(term)) {
      score += Math.max(4, Math.min(14, term.length * 2))
    }
  }

  return score
}

function extractExcerpt(content: string, terms: string[]) {
  const cleaned = stripFrontmatter(content)
    .replace(/^# .+$/gmu, '')
    .replace(/\[\[([^\]]+)\]\]/g, '$1')
    .replace(/\s+/g, ' ')
    .trim()

  if (!cleaned) {
    return ''
  }

  const lower = cleaned.toLowerCase()
  const matchIndex = terms
    .map(term => lower.indexOf(term.toLowerCase()))
    .filter(index => index >= 0)
    .sort((left, right) => left - right)[0]

  if (matchIndex === undefined) {
    return cleaned.slice(0, 220)
  }

  const start = Math.max(0, matchIndex - 90)
  const end = Math.min(cleaned.length, matchIndex + 150)
  const prefix = start > 0 ? '…' : ''
  const suffix = end < cleaned.length ? '…' : ''
  return `${prefix}${cleaned.slice(start, end).trim()}${suffix}`
}

async function listMarkdownFiles(rootPath: string): Promise<string[]> {
  const entries = await readdir(rootPath, { withFileTypes: true })
  const files = await Promise.all(entries.map(async (entry) => {
    const nextPath = resolve(rootPath, entry.name)
    if (entry.isDirectory()) {
      return listMarkdownFiles(nextPath)
    }

    return extname(entry.name) === '.md' ? [nextPath] : []
  }))

  return files.flat()
}

function extractDocumentTitle(filePath: string, content: string) {
  const heading = content.match(/^#\s+(.+)$/mu)?.[1]?.trim()
  return heading || basename(filePath, extname(filePath))
}

async function loadSearchDocuments(params: {
  workspacePath: string
  indexPath: string
  overviewPath: string
}) {
  const documents: SearchDocument[] = []
  const seenPaths = new Set<string>()

  const addDocument = async (path: string, kind: SearchDocument['kind']) => {
    if (seenPaths.has(path)) {
      return
    }

    const content = await readFile(path, 'utf-8')
    seenPaths.add(path)
    documents.push({
      kind,
      path,
      relativePath: relative(params.workspacePath, path) || basename(path),
      title: extractDocumentTitle(path, content),
      content,
    })
  }

  await addDocument(params.indexPath, 'index')
  await addDocument(params.overviewPath, 'overview')

  const wikiRootPath = resolve(params.workspacePath, 'wiki')
  try {
    await assertReadableDirectory(wikiRootPath, 'Wiki root')
    const pagePaths = await listMarkdownFiles(wikiRootPath)
    for (const pagePath of pagePaths) {
      await addDocument(pagePath, 'page')
    }
  }
  catch {
    // NOTICE: Some llm-wiki workspaces may only expose index and overview during early setup.
  }

  return documents
}

async function validateWorkspace(payload: LlmWikiWorkspaceValidationPayload): Promise<LlmWikiWorkspaceValidationResult> {
  const resolvedWorkspacePath = normalize(resolve(payload.workspacePath))
  const resolvedIndexPath = resolveWorkspaceFilePath(resolvedWorkspacePath, payload.indexPath)
  const resolvedOverviewPath = resolveWorkspaceFilePath(resolvedWorkspacePath, payload.overviewPath)

  if (!isPathInsideWorkspace(resolvedWorkspacePath, resolvedIndexPath)) {
    return {
      valid: false,
      message: 'Index path must stay inside the configured llm-wiki workspace.',
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }

  if (!isPathInsideWorkspace(resolvedWorkspacePath, resolvedOverviewPath)) {
    return {
      valid: false,
      message: 'Overview path must stay inside the configured llm-wiki workspace.',
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }

  try {
    await assertReadableDirectory(resolvedWorkspacePath, 'Workspace path')
    await assertReadableFile(resolvedIndexPath, 'Index path')
    await assertReadableFile(resolvedOverviewPath, 'Overview path')

    return {
      valid: true,
      message: `llm-wiki workspace check passed for ${resolvedWorkspacePath}.`,
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }
  catch (error) {
    return {
      valid: false,
      message: errorMessageFrom(error) ?? 'Desktop llm-wiki validation failed.',
      resolvedWorkspacePath,
      resolvedIndexPath,
      resolvedOverviewPath,
    }
  }
}

async function queryWorkspace(payload: LlmWikiQueryPayload): Promise<LlmWikiQueryResult> {
  const validation = await validateWorkspace(payload)
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.message,
      items: [],
    }
  }

  const query = payload.query.trim()
  if (!query) {
    return {
      ok: false,
      message: 'llm-wiki query is empty.',
      items: [],
    }
  }

  try {
    const documents = await loadSearchDocuments({
      workspacePath: validation.resolvedWorkspacePath,
      indexPath: validation.resolvedIndexPath,
      overviewPath: validation.resolvedOverviewPath,
    })
    const terms = extractSearchTerms(query)
    const maxResults = Math.max(1, Math.min(payload.maxResults ?? 4, 8))

    const items = documents
      .map<LlmWikiQueryResultItem | null>((document) => {
        const score = scoreDocument(document, query, payload.queryMode, terms)
        if (score <= 0) {
          return null
        }

        return {
          kind: document.kind,
          path: document.relativePath,
          score,
          title: document.title,
          excerpt: extractExcerpt(document.content, terms),
        }
      })
      .filter((item): item is LlmWikiQueryResultItem => !!item)
      .sort((left, right) => right.score - left.score)
      .slice(0, maxResults)

    return {
      ok: true,
      message: items.length
        ? `llm-wiki query matched ${items.length} page(s).`
        : 'llm-wiki query completed but found no matching page.',
      items,
    }
  }
  catch (error) {
    return {
      ok: false,
      message: errorMessageFrom(error) ?? 'Desktop llm-wiki query failed.',
      items: [],
    }
  }
}

export function createMemoryValidationService(params: { context: ReturnType<typeof createContext>['context'] }) {
  defineInvokeHandler(params.context, electronValidateLlmWikiWorkspace, async (payload) => {
    return validateWorkspace(payload)
  })

  defineInvokeHandler(params.context, electronQueryLlmWiki, async (payload) => {
    return queryWorkspace(payload)
  })
}
