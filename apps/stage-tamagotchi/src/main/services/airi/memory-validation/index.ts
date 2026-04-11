import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  LlmWikiDefaultWorkspaceResult,
  LlmWikiQueryMode,
  LlmWikiQueryPayload,
  LlmWikiQueryResult,
  LlmWikiQueryResultItem,
  LlmWikiWorkspaceValidationPayload,
  LlmWikiWorkspaceValidationResult,
  ShortTermMemoryCapturePayload,
  ShortTermMemoryCaptureResult,
  ShortTermMemoryCaptureResultItem,
  ShortTermMemoryClearPayload,
  ShortTermMemoryClearResult,
  ShortTermMemoryListPayload,
  ShortTermMemoryListResult,
  ShortTermMemoryResultItem,
  ShortTermMemorySearchPayload,
  ShortTermMemorySearchResult,
  ShortTermMemoryValidationPayload,
  ShortTermMemoryValidationResult,
} from '@proj-airi/stage-shared'
import type { BrowserWindow } from 'electron'

import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import {
  electronCaptureShortTermMemory,
  electronClearShortTermMemory,
  electronEnsureDefaultLlmWikiWorkspace,
  electronListShortTermMemory,
  electronQueryLlmWiki,
  electronSearchShortTermMemory,
  electronValidateLlmWikiWorkspace,
  electronValidateShortTermMemory,
  isAbsoluteFilesystemPath,
  isElectronManagedMemoryAlias,
  isElectronManagedRelativePath,
} from '@proj-airi/stage-shared'
import { app } from 'electron'

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

function getDefaultWorkspacePath() {
  return joinUserDataPath('llm-wiki')
}

function getSeedWorkspacePath() {
  return resolve(import.meta.dirname, '../../../../../resources/llm-wiki-seed')
}

function joinUserDataPath(...paths: string[]) {
  return resolve(app.getPath('userData'), ...paths)
}

function resolveAppDataPath(inputPath: string) {
  if (typeof app?.getPath === 'function') {
    return app.getPath('userData')
  }

  const trimmed = inputPath.trim()
  if (isAbsoluteFilesystemPath(trimmed)) {
    return dirname(resolve(trimmed))
  }

  return resolve(process.cwd())
}

function resolveManagedWorkspacePathInput(inputPath: string, defaultWorkspacePath: string, appDataPath: string) {
  const trimmed = inputPath.trim()

  if (isElectronManagedMemoryAlias(trimmed, 'llm-wiki')) {
    return normalize(resolve(defaultWorkspacePath))
  }

  if (isElectronManagedRelativePath(trimmed) && !isAbsoluteFilesystemPath(trimmed)) {
    return normalize(resolve(appDataPath, trimmed))
  }

  return normalize(resolve(trimmed))
}
const whitespacePattern = /\s+/g
const stripFrontmatterPattern = /^---\n[\s\S]*?\n---\n?/u
const searchTermTokenPattern = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu
const searchTermHanPattern = /\p{Script=Han}+/gu
const headingLinePattern = /^# .+$/gmu
const wikiLinkPattern = /\[\[([^\]]+)\]\]/g
const titleHeadingPattern = /^# ([^\n]+)$/mu
const queryIntentEntityPattern = /誰是|是谁|who is|是誰/u
const queryIntentRelationshipPattern = /關係|关系|relationship|互動|互动/u
const queryIntentTopicPattern = /是什麼|是什么|what is|如何理解|怎麼看|怎么看|世界觀|世界观|考試|考试|旅程|結構|结构|系統|系统|主題|主题/u

const aliasEntries: Array<{ when: RegExp, values: string[] }> = [
  {
    when: /一級魔法使考試|一级魔法使考试|第一級魔法使考試|第一级魔法使考试/u,
    values: ['第一級魔法使考試', '第一级魔法使考试', 'first-class-mage-exam'],
  },
  {
    when: /勇者一行人|hero party/u,
    values: ['hero-party', 'hero party', 'hero-party-members'],
  },
  {
    when: /芙莉蓮.*關係|芙莉莲.*关系|frieren.*relationship/u,
    values: ['frieren-relationship-map', 'relationship map'],
  },
  {
    when: /誰是\s*himmel|who is himmel|himmel/u,
    values: ['himmel'],
  },
] as const

interface RemoteMem0ResultItem {
  categories?: unknown
  category?: unknown
  content?: unknown
  created_at?: unknown
  createdAt?: unknown
  id?: unknown
  memory?: unknown
  metadata?: unknown
  score?: unknown
  updated_at?: unknown
  updatedAt?: unknown
  user_id?: unknown
  userId?: unknown
}

interface RemoteMem0CaptureItem {
  event?: unknown
  event_id?: unknown
  id?: unknown
  memory?: unknown
  previous_memory?: unknown
  previousMemory?: unknown
}

const mem0DefaultBaseUrl = 'http://127.0.0.1:8000'
function normalizeRemoteMem0BaseUrl(value: string) {
  const trimmed = value.trim().replace(/\/+$/u, '')
  return trimmed || mem0DefaultBaseUrl
}

function createRemoteMem0Headers(apiKey: string, contentType?: string) {
  return {
    Accept: 'application/json',
    ...(contentType ? { 'Content-Type': contentType } : {}),
    ...(apiKey.trim() ? { 'X-API-Key': apiKey.trim() } : {}),
  }
}

function buildRemoteMem0Scope(options: {
  userId: string
  agentId?: string
  runId?: string
  appId?: string
}) {
  return {
    user_id: options.userId.trim(),
    ...(options.agentId?.trim() ? { agent_id: options.agentId.trim() } : {}),
    ...(options.runId?.trim() ? { run_id: options.runId.trim() } : {}),
    ...(options.appId?.trim() ? { app_id: options.appId.trim() } : {}),
  }
}

function buildRemoteMem0ListQuery(payload: {
  userId: string
  agentId?: string
  runId?: string
  limit?: number
}) {
  const query = new URLSearchParams()
  query.set('user_id', payload.userId.trim())

  if (payload.agentId?.trim()) {
    query.set('agent_id', payload.agentId.trim())
  }

  if (payload.runId?.trim()) {
    query.set('run_id', payload.runId.trim())
  }

  if (typeof payload.limit === 'number') {
    query.set('limit', String(Math.max(1, Math.min(payload.limit, 100))))
  }

  return query
}

async function parseRemoteMem0Json(response: Response) {
  const text = await response.text()
  if (!text.trim()) {
    return undefined
  }

  try {
    return JSON.parse(text) as unknown
  }
  catch {
    throw new Error(`Remote Mem0 returned non-JSON response (${response.status}).`)
  }
}

function readRemoteMem0Items(payload: unknown) {
  if (Array.isArray(payload)) {
    return payload
  }

  if (!payload || typeof payload !== 'object') {
    return []
  }

  const data = payload as Record<string, unknown>
  if (Array.isArray(data.results)) {
    return data.results
  }
  if (Array.isArray(data.items)) {
    return data.items
  }
  if (Array.isArray(data.memories)) {
    return data.memories
  }

  return []
}

function toShortTermResultItem(memory: RemoteMem0ResultItem, userId: string): ShortTermMemoryResultItem {
  const metadata = memory.metadata && typeof memory.metadata === 'object'
    ? memory.metadata as Record<string, unknown>
    : undefined

  return {
    category: typeof memory.category === 'string'
      ? memory.category
      : typeof metadata?.category === 'string'
        ? metadata.category
        : undefined,
    conflictKey: typeof metadata?.conflictKey === 'string' ? metadata.conflictKey : undefined,
    createdAt: typeof memory.created_at === 'string'
      ? memory.created_at
      : typeof memory.createdAt === 'string'
        ? memory.createdAt
        : new Date(0).toISOString(),
    id: typeof memory.id === 'string' ? memory.id : '',
    memory: typeof memory.memory === 'string'
      ? memory.memory
      : typeof memory.content === 'string'
        ? memory.content
        : '',
    matchedBy: Array.isArray(metadata?.matchedBy)
      ? metadata.matchedBy.filter((value): value is string => typeof value === 'string')
      : undefined,
    score: typeof memory.score === 'number' ? memory.score : undefined,
    sourceText: typeof metadata?.sourceText === 'string' ? metadata.sourceText : undefined,
    updatedAt: typeof memory.updated_at === 'string'
      ? memory.updated_at
      : typeof memory.updatedAt === 'string'
        ? memory.updatedAt
        : undefined,
    userId: typeof memory.user_id === 'string'
      ? memory.user_id
      : typeof memory.userId === 'string'
        ? memory.userId
        : userId,
  }
}

function mapRemoteMem0CaptureEvent(value: unknown): ShortTermMemoryCaptureResultItem['event'] {
  const normalized = typeof value === 'string' ? value.trim().toLowerCase() : ''

  if (normalized === 'delete') {
    return 'delete'
  }

  if (normalized === 'update') {
    return 'update'
  }

  return 'add'
}

function toShortTermCaptureResultItem(item: RemoteMem0CaptureItem): ShortTermMemoryCaptureResultItem {
  return {
    event: mapRemoteMem0CaptureEvent(item.event),
    id: typeof item.id === 'string' ? item.id : typeof item.event_id === 'string' ? item.event_id : '',
    memory: typeof item.memory === 'string' ? item.memory : '',
    previousMemory: typeof item.previousMemory === 'string'
      ? item.previousMemory
      : typeof item.previous_memory === 'string'
        ? item.previous_memory
        : undefined,
  }
}

function readRemoteMem0Message(payload: unknown, fallback: string) {
  if (!payload || typeof payload !== 'object') {
    return fallback
  }

  const message = (payload as Record<string, unknown>).message
  if (typeof message === 'string' && message.trim()) {
    return message
  }

  const detail = (payload as Record<string, unknown>).detail
  if (typeof detail === 'string' && detail.trim()) {
    return detail
  }

  return fallback
}

function assertRemoteMem0ResponseOk(response: Response, payload: unknown, fallback: string) {
  if (response.ok) {
    return
  }

  throw new Error(readRemoteMem0Message(payload, `${fallback} (${response.status})`))
}

async function listRemoteMem0Memories(payload: ShortTermMemoryListPayload) {
  const url = new URL('/memories', `${normalizeRemoteMem0BaseUrl(payload.baseUrl)}/`)
  url.search = buildRemoteMem0ListQuery(payload).toString()

  const response = await fetch(url, {
    headers: createRemoteMem0Headers(payload.apiKey),
    method: 'GET',
  })
  const responsePayload = await parseRemoteMem0Json(response)

  assertRemoteMem0ResponseOk(response, responsePayload, 'Remote Mem0 list request failed.')

  return readRemoteMem0Items(responsePayload)
    .map(item => toShortTermResultItem(item as RemoteMem0ResultItem, payload.userId.trim()))
    .filter(item => !!item.id && !!item.memory)
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

async function copyDirectoryContents(sourcePath: string, targetPath: string) {
  await mkdir(targetPath, { recursive: true })
  const entries = await readdir(sourcePath, { withFileTypes: true })

  await Promise.all(entries.map(async (entry) => {
    const sourceEntryPath = resolve(sourcePath, entry.name)
    const targetEntryPath = resolve(targetPath, entry.name)

    if (entry.isDirectory()) {
      await copyDirectoryContents(sourceEntryPath, targetEntryPath)
      return
    }

    await mkdir(dirname(targetEntryPath), { recursive: true })
    await copyFile(sourceEntryPath, targetEntryPath)
  }))
}

async function ensureDefaultWorkspaceFromPaths(params: {
  workspacePath: string
  seedWorkspacePath: string
}): Promise<LlmWikiDefaultWorkspaceResult> {
  const workspacePath = params.workspacePath
  const indexPath = resolve(workspacePath, 'index.md')
  const overviewPath = resolve(workspacePath, 'wiki/overview.md')

  let initialized = false

  try {
    await assertReadableDirectory(workspacePath, 'Default llm-wiki workspace')
    await assertReadableFile(indexPath, 'Default llm-wiki index path')
    await assertReadableFile(overviewPath, 'Default llm-wiki overview path')
  }
  catch {
    await assertReadableDirectory(params.seedWorkspacePath, 'Seed llm-wiki workspace')
    await copyDirectoryContents(params.seedWorkspacePath, workspacePath)
    initialized = true
  }

  return {
    initialized,
    indexPath,
    overviewPath,
    workspacePath,
  }
}

interface SearchDocument {
  kind: 'index' | 'overview' | 'page'
  path: string
  relativePath: string
  title: string
  content: string
}

type SearchDocumentCategory = 'comparison' | 'entity' | 'overview' | 'persona' | 'source' | 'synthesis' | 'topic' | 'unknown'
type QueryIntent = 'entity' | 'fact' | 'overview' | 'topic'

function stripFrontmatter(content: string) {
  return content.replace(stripFrontmatterPattern, '').trim()
}

function normalizeSearchText(value: string) {
  return value
    .toLowerCase()
    .replace(whitespacePattern, ' ')
    .trim()
}

function extractSearchTerms(query: string) {
  const normalized = normalizeSearchText(query)
  const terms = new Set<string>()

  if (normalized) {
    terms.add(normalized)
  }

  for (const token of normalized.match(searchTermTokenPattern) ?? []) {
    if (token.length >= 2) {
      terms.add(token)
    }
  }

  for (const chunk of normalized.match(searchTermHanPattern) ?? []) {
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

function expandQueryAliases(query: string, terms: string[]) {
  const normalizedQuery = normalizeSearchText(query)
  const aliases = new Set(terms)

  for (const entry of aliasEntries) {
    if (entry.when.test(normalizedQuery)) {
      for (const value of entry.values) {
        aliases.add(normalizeSearchText(value))
      }
    }
  }

  return [...aliases]
    .filter(Boolean)
    .sort((left, right) => right.length - left.length)
    .slice(0, 24)
}

function inferDocumentCategory(document: SearchDocument): SearchDocumentCategory {
  if (document.kind === 'overview') {
    return 'overview'
  }

  const normalizedPath = normalizeSearchText(document.relativePath)
  if (normalizedPath.includes('/topics/')) {
    return 'topic'
  }
  if (normalizedPath.includes('/entities/')) {
    return 'entity'
  }
  if (normalizedPath.includes('/sources/')) {
    return 'source'
  }
  if (normalizedPath.includes('/persona/')) {
    return 'persona'
  }
  if (normalizedPath.includes('/comparisons/')) {
    return 'comparison'
  }
  if (normalizedPath.includes('/synthesis/')) {
    return 'synthesis'
  }

  return 'unknown'
}

function inferQueryIntent(query: string): QueryIntent {
  const normalizedQuery = normalizeSearchText(query)

  if (queryIntentEntityPattern.test(normalizedQuery)) {
    return 'entity'
  }

  if (queryIntentRelationshipPattern.test(normalizedQuery)) {
    return 'topic'
  }

  if (queryIntentTopicPattern.test(normalizedQuery)) {
    return 'topic'
  }

  return 'fact'
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

function getCategoryIntentWeight(category: SearchDocumentCategory, intent: QueryIntent) {
  if (intent === 'entity') {
    return category === 'entity' ? 20 : category === 'topic' ? 8 : category === 'source' ? -8 : 0
  }

  if (intent === 'topic') {
    return category === 'topic' ? 26 : category === 'overview' ? 14 : category === 'entity' ? -8 : category === 'source' ? -12 : 0
  }

  if (intent === 'overview') {
    return category === 'overview' ? 18 : category === 'topic' ? 8 : 0
  }

  return category === 'entity' ? 6 : category === 'topic' ? 6 : category === 'source' ? -4 : 0
}

function scoreDocument(document: SearchDocument, query: string, queryMode: LlmWikiQueryMode, terms: string[]) {
  const haystack = normalizeSearchText(`${document.title}\n${document.relativePath}\n${document.content}`)
  const normalizedQuery = normalizeSearchText(query)
  const normalizedTitle = normalizeSearchText(document.title)
  const normalizedPath = normalizeSearchText(document.relativePath)
  const category = inferDocumentCategory(document)
  const intent = inferQueryIntent(query)

  let score = getKindWeight(document.kind, queryMode)
  score += getCategoryIntentWeight(category, intent)

  if (normalizedQuery && haystack.includes(normalizedQuery)) {
    score += 28
  }

  for (const term of terms) {
    if (!term) {
      continue
    }

    if (normalizedTitle === term) {
      score += 26
    }

    if (normalizedPath.includes(`/${term}.md`) || normalizedPath.endsWith(`/${term}`)) {
      score += 36
    }

    if (normalizedTitle.includes(term)) {
      score += 16
    }

    if (normalizedPath.includes(term)) {
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
    .replace(headingLinePattern, '')
    .replace(wikiLinkPattern, '$1')
    .replace(whitespacePattern, ' ')
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
  const heading = content.match(titleHeadingPattern)?.[1]?.trim()
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
  return validateWorkspaceFromPaths({
    workspacePath: payload.workspacePath,
    indexPath: payload.indexPath,
    overviewPath: payload.overviewPath,
    appDataPath: resolveAppDataPath(payload.workspacePath),
    defaultWorkspacePath: isElectronManagedMemoryAlias(payload.workspacePath, 'llm-wiki')
      ? (await ensureDefaultWorkspace()).workspacePath
      : payload.workspacePath,
  })
}

async function validateWorkspaceFromPaths(params: {
  workspacePath: string
  indexPath: string
  overviewPath: string
  appDataPath: string
  defaultWorkspacePath: string
}): Promise<LlmWikiWorkspaceValidationResult> {
  const resolvedWorkspacePath = resolveManagedWorkspacePathInput(
    params.workspacePath,
    params.defaultWorkspacePath,
    params.appDataPath,
  )
  const resolvedIndexPath = resolveWorkspaceFilePath(resolvedWorkspacePath, params.indexPath)
  const resolvedOverviewPath = resolveWorkspaceFilePath(resolvedWorkspacePath, params.overviewPath)

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

async function ensureDefaultWorkspace(): Promise<LlmWikiDefaultWorkspaceResult> {
  return ensureDefaultWorkspaceFromPaths({
    workspacePath: getDefaultWorkspacePath(),
    seedWorkspacePath: getSeedWorkspacePath(),
  })
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
    const terms = expandQueryAliases(query, extractSearchTerms(query))
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

async function validateShortTermMemory(
  payload: ShortTermMemoryValidationPayload,
): Promise<ShortTermMemoryValidationResult> {
  if (!payload.userId.trim()) {
    return {
      valid: false,
      message: 'User ID is required before short-term memory can be used.',
      validatedBaseUrl: '',
    }
  }

  if (!payload.baseUrl.trim()) {
    return {
      valid: false,
      message: 'Base URL is required before remote Mem0 can be used.',
      validatedBaseUrl: '',
    }
  }

  if (payload.topK < 1) {
    return {
      valid: false,
      message: 'Top K must be at least 1.',
      validatedBaseUrl: '',
    }
  }

  if (payload.searchThreshold < 0 || payload.searchThreshold > 1) {
    return {
      valid: false,
      message: 'Search threshold must stay between 0 and 1.',
      validatedBaseUrl: '',
    }
  }

  try {
    const validatedBaseUrl = normalizeRemoteMem0BaseUrl(payload.baseUrl)
    const url = new URL('/memories', `${validatedBaseUrl}/`)
    url.search = buildRemoteMem0ListQuery({
      userId: payload.userId,
      agentId: payload.agentId,
      runId: payload.runId,
      limit: 1,
    }).toString()
    const response = await fetch(url, {
      headers: createRemoteMem0Headers(payload.apiKey),
      method: 'GET',
    })
    const responsePayload = await parseRemoteMem0Json(response)

    assertRemoteMem0ResponseOk(response, responsePayload, 'Remote Mem0 validation failed.')

    return {
      valid: true,
      message: `Remote Mem0 API is reachable at ${validatedBaseUrl}.`,
      validatedBaseUrl,
    }
  }
  catch (error) {
    return {
      valid: false,
      message: errorMessageFrom(error) ?? 'Remote Mem0 validation failed.',
      validatedBaseUrl: '',
    }
  }
}

async function listShortTermMemory(payload: ShortTermMemoryListPayload): Promise<ShortTermMemoryListResult> {
  try {
    const items = await listRemoteMem0Memories(payload)

    return {
      ok: true,
      message: items.length > 0
        ? `Loaded ${items.length} short-term memory item(s).`
        : 'Short-term memory is empty.',
      items,
    }
  }
  catch (error) {
    return {
      ok: false,
      message: errorMessageFrom(error) ?? 'Remote Mem0 list failed.',
      items: [],
    }
  }
}

async function clearShortTermMemory(payload: ShortTermMemoryClearPayload): Promise<ShortTermMemoryClearResult> {
  try {
    const latestMemoryItems = await listRemoteMem0Memories({
      ...payload,
      appId: undefined,
      limit: 100,
    })
    const deletedCount = latestMemoryItems.length

    if (deletedCount === 0) {
      return {
        ok: true,
        message: 'Short-term memory is already empty.',
        deletedCount: 0,
        latestMemoryItems: [],
        latestMemories: [],
      }
    }

    const url = new URL('/memories', `${normalizeRemoteMem0BaseUrl(payload.baseUrl)}/`)
    url.search = buildRemoteMem0ListQuery({
      userId: payload.userId,
      agentId: payload.agentId,
      runId: payload.runId,
    }).toString()

    const response = await fetch(url, {
      headers: createRemoteMem0Headers(payload.apiKey),
      method: 'DELETE',
    })
    const responsePayload = await parseRemoteMem0Json(response)

    assertRemoteMem0ResponseOk(response, responsePayload, 'Remote Mem0 clear request failed.')

    return {
      ok: true,
      message: `Cleared ${deletedCount} short-term memory item(s).`,
      deletedCount,
      latestMemoryItems: [],
      latestMemories: [],
    }
  }
  catch (error) {
    return {
      ok: false,
      message: errorMessageFrom(error) ?? 'Remote Mem0 clear failed.',
      deletedCount: 0,
      latestMemoryItems: [],
      latestMemories: [],
    }
  }
}

async function searchShortTermMemory(payload: ShortTermMemorySearchPayload): Promise<ShortTermMemorySearchResult> {
  const trimmedQuery = payload.query.trim()
  if (!trimmedQuery) {
    return {
      ok: false,
      message: 'Short-term recall query is empty.',
      items: [],
      latestMemories: [],
    }
  }

  try {
    const latestMemoryItems = await listRemoteMem0Memories({
      apiKey: payload.apiKey,
      appId: payload.appId,
      baseUrl: payload.baseUrl,
      userId: payload.userId.trim(),
      agentId: payload.agentId,
      limit: 8,
      runId: payload.runId,
    })
    const latestMemories = latestMemoryItems.map(item => item.memory)
    const response = await fetch(new URL('/search', `${normalizeRemoteMem0BaseUrl(payload.baseUrl)}/`), {
      body: JSON.stringify({
        query: trimmedQuery,
        top_k: Math.max(1, Math.min(payload.topK, 20)),
        ...buildRemoteMem0Scope({
          userId: payload.userId,
          agentId: payload.agentId,
          runId: payload.runId,
          appId: payload.appId,
        }),
      }),
      headers: createRemoteMem0Headers(payload.apiKey, 'application/json'),
      method: 'POST',
    })
    const responsePayload = await parseRemoteMem0Json(response)

    assertRemoteMem0ResponseOk(response, responsePayload, 'Remote Mem0 search failed.')

    const items = readRemoteMem0Items(responsePayload)
      .filter(item => typeof item.score !== 'number' || item.score >= payload.searchThreshold)
      .map(item => toShortTermResultItem(item as RemoteMem0ResultItem, payload.userId.trim()))

    return {
      ok: true,
      message: items.length > 0
        ? `Short-term recall matched ${items.length} memory item(s).`
        : 'Short-term recall completed but found no matching memory.',
      items,
      latestMemoryItems,
      latestMemories,
    }
  }
  catch (error) {
    return {
      ok: false,
      message: errorMessageFrom(error) ?? 'Remote Mem0 search failed.',
      items: [],
      latestMemories: [],
    }
  }
}

async function captureShortTermMemory(payload: ShortTermMemoryCapturePayload): Promise<ShortTermMemoryCaptureResult> {
  if (payload.messages.length === 0) {
    return {
      ok: true,
      message: 'Short-term capture found no stable memory candidate in this turn.',
      items: [],
      latestMemories: [],
    }
  }

  try {
    const response = await fetch(new URL('/memories', `${normalizeRemoteMem0BaseUrl(payload.baseUrl)}/`), {
      body: JSON.stringify({
        async_mode: false,
        infer: true,
        messages: payload.messages.map(message => ({
          content: message.content,
          role: message.role,
        })),
        ...buildRemoteMem0Scope({
          userId: payload.userId,
          agentId: payload.agentId,
          runId: payload.runId,
          appId: payload.appId,
        }),
      }),
      headers: createRemoteMem0Headers(payload.apiKey, 'application/json'),
      method: 'POST',
    })
    const responsePayload = await parseRemoteMem0Json(response)

    assertRemoteMem0ResponseOk(response, responsePayload, 'Remote Mem0 capture failed.')

    const captureItems = readRemoteMem0Items(responsePayload)
      .map(item => toShortTermCaptureResultItem(item as RemoteMem0CaptureItem))
      .filter(item => !!item.id || !!item.memory)
    const latestMemoryItems = await listRemoteMem0Memories({
      apiKey: payload.apiKey,
      appId: payload.appId,
      baseUrl: payload.baseUrl,
      userId: payload.userId.trim(),
      agentId: payload.agentId,
      limit: 8,
      runId: payload.runId,
    })

    return {
      ok: true,
      message: captureItems.length > 0
        ? `Short-term capture stored ${captureItems.length} memory item(s).`
        : 'Short-term capture found no stable memory candidate in this turn.',
      items: captureItems,
      latestMemoryItems,
      latestMemories: latestMemoryItems.map(item => item.memory),
    }
  }
  catch (error) {
    return {
      ok: false,
      message: errorMessageFrom(error) ?? 'Remote Mem0 capture failed.',
      items: [],
      latestMemories: [],
    }
  }
}

export function createMemoryValidationService(params: { context: ReturnType<typeof createContext>['context'], window: BrowserWindow }) {
  const defaultWorkspaceReady = ensureDefaultWorkspace().catch((error) => {
    // NOTICE: AIRI Electron should own a default llm-wiki workspace even before the renderer
    // explicitly requests validation. Initializing it eagerly here keeps the settings page from
    // depending on a first successful IPC roundtrip before it can show a usable workspace path.
    console.warn('[llm-wiki] Failed to initialize default workspace during service startup:', errorMessageFrom(error) ?? error)
    return undefined
  })

  defineInvokeHandler(params.context, electronValidateLlmWikiWorkspace, async (payload) => {
    return validateWorkspace(payload)
  })

  defineInvokeHandler(params.context, electronEnsureDefaultLlmWikiWorkspace, async () => {
    return await defaultWorkspaceReady ?? ensureDefaultWorkspace()
  })

  defineInvokeHandler(params.context, electronQueryLlmWiki, async (payload) => {
    return queryWorkspace(payload)
  })

  defineInvokeHandler(params.context, electronValidateShortTermMemory, async (payload) => {
    return validateShortTermMemory(payload)
  })

  defineInvokeHandler(params.context, electronSearchShortTermMemory, async (payload) => {
    return searchShortTermMemory(payload)
  })

  defineInvokeHandler(params.context, electronCaptureShortTermMemory, async (payload) => {
    return captureShortTermMemory(payload)
  })

  defineInvokeHandler(params.context, electronListShortTermMemory, async (payload) => {
    return listShortTermMemory(payload)
  })

  defineInvokeHandler(params.context, electronClearShortTermMemory, async (payload) => {
    return clearShortTermMemory(payload)
  })
}

export const __memoryValidationTestUtils = {
  captureShortTermMemory,
  clearShortTermMemory,
  ensureDefaultWorkspace,
  ensureDefaultWorkspaceFromPaths,
  validateWorkspaceFromPaths,
  expandQueryAliases,
  extractSearchTerms,
  inferDocumentCategory,
  inferQueryIntent,
  listShortTermMemory,
  queryWorkspace,
  searchShortTermMemory,
  scoreDocument,
  validateShortTermMemory,
}
