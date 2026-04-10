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
  ShortTermMemoryListPayload,
  ShortTermMemoryListResult,
  ShortTermMemoryMessageInput,
  ShortTermMemoryResultItem,
  ShortTermMemorySearchPayload,
  ShortTermMemorySearchResult,
  ShortTermMemoryValidationPayload,
  ShortTermMemoryValidationResult,
} from '@proj-airi/stage-shared'

import process from 'node:process'

import { randomUUID } from 'node:crypto'
import { constants } from 'node:fs'
import { access, copyFile, mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, normalize, relative, resolve, sep } from 'node:path'

import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import {
  electronCaptureShortTermMemory,
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

function getDefaultShortTermMemoryPath() {
  return joinUserDataPath('mem0')
}

function resolveDefaultShortTermMemoryPath(inputPath: string) {
  if (typeof app?.getPath === 'function') {
    return getDefaultShortTermMemoryPath()
  }

  return resolve(resolveAppDataPath(inputPath), 'mem0')
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

function resolveShortTermStorePathInput(inputPath: string, appDataPath: string, defaultStorePath: string) {
  const trimmed = inputPath.trim()

  if (!trimmed || isElectronManagedMemoryAlias(trimmed, 'mem0')) {
    return normalize(resolve(defaultStorePath))
  }

  if (isElectronManagedRelativePath(trimmed) && !isAbsoluteFilesystemPath(trimmed)) {
    return normalize(resolve(appDataPath, trimmed))
  }

  return normalize(resolve(trimmed))
}

interface StoredShortTermMemory {
  createdAt: string
  id: string
  keywords: string[]
  memory: string
  sourceText: string
  updatedAt: string
  userId: string
}

interface StoredShortTermMemoryState {
  memories: StoredShortTermMemory[]
}

interface ParsedShortTermMemoryIdentity {
  category: string
  conflictKey: string
  normalizedMemory: string
}

const shortTermMemoryStateVersion = 1
const actTokenPattern = /<\|ACT:[\s\S]*?\|>/g
const whitespacePattern = /\s+/g
const trimMemoryPunctuationPattern = /^[，,。\s]+|[，,。\s]+$/g
const nonSearchCharactersPattern = /[^\p{L}\p{N}\p{Script=Han}\s]/gu
const latinSearchTokenPattern = /[a-z0-9]{2,}/g
const hanSearchRunPattern = /\p{Script=Han}{2,}/gu
const rememberPrefixZhPattern = /^(請)?記住[，,:：\s]*/u
const rememberPrefixEnPattern = /^please remember(?: that)?[,:：\s]*/iu
const rememberKeywordPattern = /記住|remember/iu
const stripFrontmatterPattern = /^---\n[\s\S]*?\n---\n?/u
const searchTermTokenPattern = /[\p{L}\p{N}][\p{L}\p{N}-]*/gu
const searchTermHanPattern = /\p{Script=Han}+/gu
const headingLinePattern = /^# .+$/gmu
const wikiLinkPattern = /\[\[([^\]]+)\]\]/g
const titleHeadingPattern = /^# ([^\n]+)$/mu
const queryIntentEntityPattern = /誰是|是谁|who is|是誰/u
const queryIntentRelationshipPattern = /關係|关系|relationship|互動|互动/u
const queryIntentTopicPattern = /是什麼|是什么|what is|如何理解|怎麼看|怎么看|世界觀|世界观|考試|考试|旅程|結構|结构|系統|系统|主題|主题/u

const memoryExtractionRules = [
  {
    kind: 'name-zh',
    pattern: /(?:我叫做?|我的名字是)([^，。！？!?]+)$/u,
  },
  {
    kind: 'lives-zh',
    pattern: /我住在([^，。！？!?]+)$/u,
  },
  {
    kind: 'favorite-zh',
    pattern: /我最喜歡的?(.+)$/u,
  },
  {
    kind: 'dislike-zh',
    pattern: /我不喜歡([^，。！？!?]+)$/u,
  },
  {
    kind: 'like-zh',
    pattern: /我喜歡([^，。！？!?]+)$/u,
  },
  {
    kind: 'prefer-zh',
    pattern: /我偏好([^，。！？!?]+)$/u,
  },
  {
    kind: 'name-en',
    pattern: /my name is (.+)$/iu,
  },
  {
    kind: 'lives-en',
    pattern: /i live in (.+)$/iu,
  },
  {
    kind: 'favorite-en',
    pattern: /my favorite (.+)$/iu,
  },
  {
    kind: 'dislike-en',
    pattern: /i do not like (.+)$/iu,
  },
  {
    kind: 'like-en',
    pattern: /i like (.+)$/iu,
  },
  {
    kind: 'prefer-en',
    pattern: /i prefer (.+)$/iu,
  },
] as const

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

function shortTermMemoryStatePath(storePath: string) {
  return resolve(storePath, 'memories.v1.json')
}

async function ensureShortTermStoreDirectory(storePath: string) {
  await mkdir(storePath, { recursive: true })
}

async function readShortTermMemoryState(storePath: string): Promise<StoredShortTermMemoryState> {
  await ensureShortTermStoreDirectory(storePath)
  const path = shortTermMemoryStatePath(storePath)

  try {
    const raw = await readFile(path, 'utf-8')
    const parsed = JSON.parse(raw) as unknown
    if (!parsed || typeof parsed !== 'object') {
      return { memories: [] }
    }

    const record = parsed as {
      memories?: unknown
      version?: unknown
    }
    const memories = Array.isArray(record.memories)
      ? record.memories.filter(entry => !!entry && typeof entry === 'object') as StoredShortTermMemory[]
      : []

    return {
      memories,
    }
  }
  catch {
    return { memories: [] }
  }
}

async function writeShortTermMemoryState(storePath: string, state: StoredShortTermMemoryState) {
  await ensureShortTermStoreDirectory(storePath)
  const path = shortTermMemoryStatePath(storePath)
  await writeFile(path, `${JSON.stringify({
    memories: state.memories,
    version: shortTermMemoryStateVersion,
  }, null, 2)}\n`)
}

function cleanMemoryText(value: string) {
  return value
    .replace(actTokenPattern, ' ')
    .replace(whitespacePattern, ' ')
    .replace(trimMemoryPunctuationPattern, '')
    .trim()
}

function normalizeForSearch(value: string) {
  return cleanMemoryText(value)
    .toLowerCase()
    .replace(nonSearchCharactersPattern, ' ')
    .replace(whitespacePattern, ' ')
    .trim()
}

function extractSearchTokens(value: string) {
  const normalized = normalizeForSearch(value)
  const latinTokens = normalized.match(latinSearchTokenPattern) ?? []
  const chineseRuns = normalized.match(hanSearchRunPattern) ?? []
  const chineseTokens = chineseRuns.flatMap((run) => {
    if (run.length <= 2) {
      return [run]
    }

    const tokens = new Set<string>([run])
    for (let index = 0; index < run.length - 1; index += 1) {
      tokens.add(run.slice(index, index + 2))
    }
    return [...tokens]
  })

  return [...new Set([...latinTokens, ...chineseTokens])]
}

function createStoredMemory(memory: string, sourceText: string, userId: string): StoredShortTermMemory {
  const now = new Date().toISOString()
  return {
    createdAt: now,
    id: randomUUID(),
    keywords: extractSearchTokens(`${memory} ${sourceText}`),
    memory,
    sourceText,
    updatedAt: now,
    userId,
  }
}

function sanitizeRememberPrefix(value: string) {
  return value
    .replace(rememberPrefixZhPattern, '')
    .replace(rememberPrefixEnPattern, '')
    .trim()
}

function extractMemoryCandidates(messages: ShortTermMemoryMessageInput[]) {
  const candidates = new Set<string>()

  for (const message of messages) {
    if (message.role !== 'user') {
      continue
    }

    const sourceText = cleanMemoryText(message.content)
    if (!sourceText) {
      continue
    }

    const normalizedSource = sanitizeRememberPrefix(sourceText)

    for (const rule of memoryExtractionRules) {
      const matched = normalizedSource.match(rule.pattern)
      if (!matched) {
        continue
      }

      if (rule.kind === 'favorite-zh') {
        const favoriteParts = matched[1].split('是').map(part => part.trim()).filter(Boolean)
        if (favoriteParts.length >= 2) {
          candidates.add(`最喜歡的${favoriteParts[0]}是${favoriteParts.slice(1).join('是')}`)
        }
      }
      else if (rule.kind === 'favorite-en') {
        const divider = ' is '
        const favoriteIndex = matched[1].toLowerCase().indexOf(divider)
        if (favoriteIndex >= 0) {
          const subject = matched[1].slice(0, favoriteIndex).trim()
          const value = matched[1].slice(favoriteIndex + divider.length).trim()
          if (subject && value) {
            candidates.add(`favorite ${subject} is ${value}`)
          }
        }
      }
      else if (rule.kind === 'dislike-zh') {
        candidates.add(`不喜歡${matched[1].trim()}`)
      }
      else if (rule.kind === 'dislike-en') {
        candidates.add(`does not like ${matched[1].trim()}`)
      }
      else if (rule.kind === 'prefer-zh') {
        candidates.add(`偏好${matched[1].trim()}`)
      }
      else if (rule.kind === 'prefer-en') {
        candidates.add(`prefers ${matched[1].trim()}`)
      }
      else if (rule.kind === 'lives-zh') {
        candidates.add(`住在${matched[1].trim()}`)
      }
      else if (rule.kind === 'lives-en') {
        candidates.add(`lives in ${matched[1].trim()}`)
      }
      else if (rule.kind === 'name-zh') {
        candidates.add(`名字是${matched[1].trim()}`)
      }
      else if (rule.kind === 'name-en') {
        candidates.add(`name is ${matched[1].trim()}`)
      }
      else if (rule.kind === 'like-zh') {
        candidates.add(`喜歡${matched[1].trim()}`)
      }
      else if (rule.kind === 'like-en') {
        candidates.add(`likes ${matched[1].trim()}`)
      }
    }

    if (candidates.size === 0 && rememberKeywordPattern.test(sourceText)) {
      candidates.add(normalizedSource)
    }
  }

  return Array.from(candidates, candidate => cleanMemoryText(candidate)).filter(Boolean)
}

function parseShortTermMemoryIdentity(memory: string): ParsedShortTermMemoryIdentity {
  const cleaned = cleanMemoryText(memory)
  const normalizedMemory = normalizeForSearch(cleaned)

  if (cleaned.startsWith('名字是') || /^name is /iu.test(cleaned)) {
    return {
      category: 'identity.name',
      conflictKey: 'identity.name',
      normalizedMemory,
    }
  }

  if (cleaned.startsWith('住在') || /^lives in /iu.test(cleaned)) {
    return {
      category: 'profile.location',
      conflictKey: 'profile.location',
      normalizedMemory,
    }
  }

  const favoriteZh = cleaned.match(/^最喜歡的(.+?)是(.+)$/u)
  if (favoriteZh) {
    return {
      category: 'preference.favorite',
      conflictKey: `preference.favorite:${normalizeForSearch(favoriteZh[1])}`,
      normalizedMemory,
    }
  }

  const favoriteEn = cleaned.match(/^favorite (.+?) is (.+)$/iu)
  if (favoriteEn) {
    return {
      category: 'preference.favorite',
      conflictKey: `preference.favorite:${normalizeForSearch(favoriteEn[1])}`,
      normalizedMemory,
    }
  }

  return {
    category: 'memory.generic',
    conflictKey: normalizedMemory,
    normalizedMemory,
  }
}

function scoreShortTermMemory(memory: StoredShortTermMemory, query: string) {
  const normalizedQuery = normalizeForSearch(query)
  const normalizedMemory = normalizeForSearch(memory.memory)
  const normalizedSource = normalizeForSearch(memory.sourceText)

  if (!normalizedQuery || !normalizedMemory) {
    return 0
  }

  const queryTokens = extractSearchTokens(normalizedQuery)
  const memoryTokens = new Set(memory.keywords.length > 0 ? memory.keywords : extractSearchTokens(`${normalizedMemory} ${normalizedSource}`))
  const overlap = queryTokens.filter(token => memoryTokens.has(token))
  const overlapScore = queryTokens.length > 0 ? overlap.length / queryTokens.length : 0
  const substringBoost = normalizedMemory.includes(normalizedQuery) || normalizedSource.includes(normalizedQuery)
    ? 0.45
    : 0
  const reverseSubstringBoost = normalizedQuery.includes(normalizedMemory)
    ? 0.25
    : 0

  return Math.min(1, overlapScore + substringBoost + reverseSubstringBoost)
}

function sortMemoriesByRecency(memories: StoredShortTermMemory[]) {
  return [...memories].sort((left, right) => right.updatedAt.localeCompare(left.updatedAt))
}

function toShortTermResultItem(memory: StoredShortTermMemory, score?: number): ShortTermMemoryResultItem {
  return {
    createdAt: memory.createdAt,
    id: memory.id,
    memory: memory.memory,
    score,
    userId: memory.userId,
  }
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

async function validateShortTermMemory(payload: ShortTermMemoryValidationPayload): Promise<ShortTermMemoryValidationResult> {
  if (!payload.userId.trim()) {
    return {
      valid: false,
      message: 'User ID is required before short-term memory can be used.',
      resolvedStorePath: '',
    }
  }

  if (!payload.embedder.trim()) {
    return {
      valid: false,
      message: 'Embedder configuration is required for short-term memory.',
      resolvedStorePath: '',
    }
  }

  if (!payload.vectorStore.trim()) {
    return {
      valid: false,
      message: 'Vector store configuration is required for short-term memory.',
      resolvedStorePath: '',
    }
  }

  if (payload.topK < 1) {
    return {
      valid: false,
      message: 'Top K must be at least 1.',
      resolvedStorePath: '',
    }
  }

  if (payload.searchThreshold < 0 || payload.searchThreshold > 1) {
    return {
      valid: false,
      message: 'Search threshold must stay between 0 and 1.',
      resolvedStorePath: '',
    }
  }

  if (payload.mode !== 'open-source' && payload.mode !== 'platform') {
    return {
      valid: false,
      message: 'Mode must be either open-source or platform.',
      resolvedStorePath: '',
    }
  }

  if (payload.mode === 'platform' && !payload.apiKey.trim()) {
    return {
      valid: false,
      message: 'API key is required when short-term memory is configured in platform mode.',
      resolvedStorePath: '',
    }
  }

  const resolvedStorePath = resolveShortTermStorePathInput(
    payload.baseUrl,
    resolveAppDataPath(payload.baseUrl),
    resolveDefaultShortTermMemoryPath(payload.baseUrl),
  )

  await ensureShortTermStoreDirectory(resolvedStorePath)

  return {
    valid: true,
    message: `Short-term memory runtime is ready at ${resolvedStorePath}.`,
    resolvedStorePath,
  }
}

async function listShortTermMemory(payload: ShortTermMemoryListPayload): Promise<ShortTermMemoryListResult> {
  const validation = await validateShortTermMemory({
    mode: 'open-source',
    userId: payload.userId,
    baseUrl: payload.baseUrl,
    apiKey: '',
    embedder: 'airi-local',
    vectorStore: 'local-file',
    topK: 5,
    searchThreshold: 0,
  })
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.message,
      items: [],
    }
  }

  const state = await readShortTermMemoryState(validation.resolvedStorePath)
  const items = sortMemoriesByRecency(state.memories)
    .filter(memory => memory.userId === payload.userId.trim())
    .slice(0, Math.max(1, Math.min(payload.limit ?? 8, 20)))
    .map(memory => toShortTermResultItem(memory))

  return {
    ok: true,
    message: items.length > 0
      ? `Loaded ${items.length} short-term memory item(s).`
      : 'Short-term memory is empty.',
    items,
  }
}

async function searchShortTermMemory(payload: ShortTermMemorySearchPayload): Promise<ShortTermMemorySearchResult> {
  const validation = await validateShortTermMemory({
    mode: 'open-source',
    userId: payload.userId,
    baseUrl: payload.baseUrl,
    apiKey: '',
    embedder: 'airi-local',
    vectorStore: 'local-file',
    topK: payload.topK,
    searchThreshold: payload.searchThreshold,
  })
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.message,
      items: [],
      latestMemories: [],
    }
  }

  const trimmedQuery = payload.query.trim()
  if (!trimmedQuery) {
    return {
      ok: false,
      message: 'Short-term recall query is empty.',
      items: [],
      latestMemories: [],
    }
  }

  const state = await readShortTermMemoryState(validation.resolvedStorePath)
  const scopedMemories = sortMemoriesByRecency(state.memories.filter(memory => memory.userId === payload.userId.trim()))
  const latestMemories = scopedMemories.slice(0, 8).map(memory => memory.memory)
  const scoredItems = scopedMemories
    .map(memory => ({
      memory,
      score: scoreShortTermMemory(memory, trimmedQuery),
    }))
    .filter(item => item.score > 0)
    .sort((left, right) => right.score - left.score)
    .slice(0, Math.max(1, Math.min(payload.topK, 20)))

  const filteredItems = scoredItems.filter(item => item.score >= payload.searchThreshold)
  const finalItems = filteredItems.length > 0 ? filteredItems : scoredItems.slice(0, 1)

  return {
    ok: true,
    message: finalItems.length > 0
      ? `Short-term recall matched ${finalItems.length} memory item(s).`
      : 'Short-term recall completed but found no matching memory.',
    items: finalItems.map(item => toShortTermResultItem(item.memory, item.score)),
    latestMemories,
  }
}

async function captureShortTermMemory(payload: ShortTermMemoryCapturePayload): Promise<ShortTermMemoryCaptureResult> {
  const validation = await validateShortTermMemory({
    mode: 'open-source',
    userId: payload.userId,
    baseUrl: payload.baseUrl,
    apiKey: '',
    embedder: 'airi-local',
    vectorStore: 'local-file',
    topK: 5,
    searchThreshold: 0,
  })
  if (!validation.valid) {
    return {
      ok: false,
      message: validation.message,
      items: [],
      latestMemories: [],
    }
  }

  const candidates = extractMemoryCandidates(payload.messages)
  if (candidates.length === 0) {
    const latest = await listShortTermMemory({
      baseUrl: payload.baseUrl,
      userId: payload.userId,
      limit: 8,
    })
    return {
      ok: true,
      message: 'Short-term capture found no stable memory candidate in this turn.',
      items: [],
      latestMemories: latest.items.map(item => item.memory),
    }
  }

  const state = await readShortTermMemoryState(validation.resolvedStorePath)
  const results: ShortTermMemoryCaptureResultItem[] = []
  const now = new Date().toISOString()

  for (const candidate of candidates) {
    const identity = parseShortTermMemoryIdentity(candidate)
    const existing = state.memories.find((memory) => {
      if (memory.userId !== payload.userId.trim()) {
        return false
      }

      const existingIdentity = parseShortTermMemoryIdentity(memory.memory)
      return existingIdentity.conflictKey === identity.conflictKey
    })

    if (existing) {
      const existingIdentity = parseShortTermMemoryIdentity(existing.memory)

      if (existingIdentity.normalizedMemory === identity.normalizedMemory) {
        existing.updatedAt = now
        existing.sourceText = candidate
        existing.keywords = extractSearchTokens(candidate)
        results.push({
          event: 'update',
          id: existing.id,
          memory: existing.memory,
          previousMemory: existing.memory,
        })
        continue
      }

      const previousMemory = existing.memory
      existing.memory = candidate
      existing.updatedAt = now
      existing.sourceText = candidate
      existing.keywords = extractSearchTokens(`${candidate} ${candidate}`)
      results.push({
        event: 'update',
        id: existing.id,
        memory: candidate,
        previousMemory,
      })
      continue
    }

    const stored = createStoredMemory(candidate, candidate, payload.userId.trim())
    state.memories.push(stored)
    results.push({
      event: 'add',
      id: stored.id,
      memory: stored.memory,
    })
  }

  await writeShortTermMemoryState(validation.resolvedStorePath, {
    memories: sortMemoriesByRecency(state.memories),
  })

  const latestMemories = sortMemoriesByRecency(state.memories)
    .filter(memory => memory.userId === payload.userId.trim())
    .slice(0, 8)
    .map(memory => memory.memory)

  return {
    ok: true,
    message: results.length > 0
      ? `Short-term capture stored ${results.length} memory item(s).`
      : 'Short-term capture completed without storing new memory.',
    items: results,
    latestMemories,
  }
}

export function createMemoryValidationService(params: { context: ReturnType<typeof createContext>['context'] }) {
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
}

export const __memoryValidationTestUtils = {
  captureShortTermMemory,
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
