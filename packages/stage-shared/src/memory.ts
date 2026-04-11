import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'

import { isElectronWindow } from './window'

function getRendererWindow() {
  return (globalThis as { window?: unknown }).window
}

export type ElectronManagedMemoryPathKind = 'llm-wiki'
const windowsAbsolutePathPattern = /^[A-Z]:[\\/]/i

export function isAbsoluteFilesystemPath(value: string) {
  return value.startsWith('/') || windowsAbsolutePathPattern.test(value)
}

export function isElectronManagedMemoryAlias(value: string, kind: ElectronManagedMemoryPathKind) {
  return value.trim().toLowerCase() === kind
}

export function isElectronManagedRelativePath(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  if (isAbsoluteFilesystemPath(trimmed)) {
    return false
  }

  return trimmed.startsWith('./')
    || trimmed.startsWith('../')
    || (!trimmed.startsWith('/') && !windowsAbsolutePathPattern.test(trimmed))
}

export interface LlmWikiWorkspaceValidationPayload {
  workspacePath: string
  indexPath: string
  overviewPath: string
}

export interface LlmWikiWorkspaceValidationResult {
  valid: boolean
  message: string
  resolvedWorkspacePath: string
  resolvedIndexPath: string
  resolvedOverviewPath: string
}

export interface LlmWikiDefaultWorkspaceResult {
  initialized: boolean
  indexPath: string
  overviewPath: string
  workspacePath: string
}

export type LlmWikiQueryMode = 'digest' | 'hybrid' | 'query'

export interface LlmWikiQueryPayload {
  workspacePath: string
  indexPath: string
  overviewPath: string
  query: string
  queryMode: LlmWikiQueryMode
  maxResults?: number
}

export interface LlmWikiQueryResultItem {
  kind: 'index' | 'overview' | 'page'
  path: string
  score: number
  title: string
  excerpt: string
}

export interface LlmWikiQueryResult {
  ok: boolean
  message: string
  items: LlmWikiQueryResultItem[]
}

export interface ShortTermMemoryValidationPayload {
  deploymentMode?: 'electron-managed-local' | 'remote'
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  baseUrl: string
  apiKey: string
  openAIApiKey?: string
  topK: number
  searchThreshold: number
}

export interface ShortTermMemoryValidationResult {
  valid: boolean
  message: string
  validatedBaseUrl: string
}

export interface ShortTermMemoryMessageInput {
  role: 'assistant' | 'user'
  content: string
}

export interface ShortTermMemoryResultItem {
  category?: string
  conflictKey?: string
  createdAt: string
  id: string
  memory: string
  matchedBy?: string[]
  score?: number
  sourceText?: string
  updatedAt?: string
  userId: string
}

export interface ShortTermMemorySearchPayload {
  deploymentMode?: 'electron-managed-local' | 'remote'
  baseUrl: string
  apiKey: string
  openAIApiKey?: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  query: string
  topK: number
  searchThreshold: number
}

export interface ShortTermMemorySearchResult {
  ok: boolean
  message: string
  items: ShortTermMemoryResultItem[]
  latestMemoryItems?: ShortTermMemoryResultItem[]
  latestMemories: string[]
}

export interface ShortTermMemoryCapturePayload {
  deploymentMode?: 'electron-managed-local' | 'remote'
  baseUrl: string
  apiKey: string
  openAIApiKey?: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  messages: ShortTermMemoryMessageInput[]
}

export interface ShortTermMemoryCaptureResultItem {
  event: 'add' | 'delete' | 'update'
  id: string
  memory: string
  previousMemory?: string
}

export interface ShortTermMemoryCaptureResult {
  ok: boolean
  message: string
  items: ShortTermMemoryCaptureResultItem[]
  latestMemoryItems?: ShortTermMemoryResultItem[]
  latestMemories: string[]
}

export interface ShortTermMemoryListPayload {
  deploymentMode?: 'electron-managed-local' | 'remote'
  baseUrl: string
  apiKey: string
  openAIApiKey?: string
  userId: string
  agentId?: string
  runId?: string
  appId?: string
  limit?: number
}

export interface ShortTermMemoryListResult {
  ok: boolean
  message: string
  items: ShortTermMemoryResultItem[]
}

export interface ShortTermMemoryClearPayload {
  deploymentMode?: 'electron-managed-local' | 'remote'
  baseUrl: string
  apiKey: string
  openAIApiKey?: string
  userId: string
  agentId?: string
  runId?: string
}

export interface ShortTermMemoryClearResult {
  ok: boolean
  message: string
  deletedCount: number
  latestMemoryItems?: ShortTermMemoryResultItem[]
  latestMemories: string[]
}

export const electronValidateLlmWikiWorkspace = defineInvokeEventa<LlmWikiWorkspaceValidationResult, LlmWikiWorkspaceValidationPayload>('eventa:invoke:electron:memory:llm-wiki:validate-workspace')
export const electronEnsureDefaultLlmWikiWorkspace = defineInvokeEventa<LlmWikiDefaultWorkspaceResult, void>('eventa:invoke:electron:memory:llm-wiki:ensure-default-workspace')
export const electronQueryLlmWiki = defineInvokeEventa<LlmWikiQueryResult, LlmWikiQueryPayload>('eventa:invoke:electron:memory:llm-wiki:query')
export const electronValidateShortTermMemory = defineInvokeEventa<ShortTermMemoryValidationResult, ShortTermMemoryValidationPayload>('eventa:invoke:electron:memory:short-term:validate')
export const electronSearchShortTermMemory = defineInvokeEventa<ShortTermMemorySearchResult, ShortTermMemorySearchPayload>('eventa:invoke:electron:memory:short-term:search')
export const electronCaptureShortTermMemory = defineInvokeEventa<ShortTermMemoryCaptureResult, ShortTermMemoryCapturePayload>('eventa:invoke:electron:memory:short-term:capture')
export const electronListShortTermMemory = defineInvokeEventa<ShortTermMemoryListResult, ShortTermMemoryListPayload>('eventa:invoke:electron:memory:short-term:list')
export const electronClearShortTermMemory = defineInvokeEventa<ShortTermMemoryClearResult, ShortTermMemoryClearPayload>('eventa:invoke:electron:memory:short-term:clear')

export async function validateLlmWikiWorkspaceOnDesktop(payload: LlmWikiWorkspaceValidationPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const validateWorkspace = defineInvoke(context, electronValidateLlmWikiWorkspace)

  return validateWorkspace(payload)
}

export async function ensureDefaultLlmWikiWorkspaceOnDesktop() {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const ensureWorkspace = defineInvoke(context, electronEnsureDefaultLlmWikiWorkspace)

  return ensureWorkspace()
}

export async function queryLlmWikiOnDesktop(payload: LlmWikiQueryPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const queryWiki = defineInvoke(context, electronQueryLlmWiki)

  return queryWiki(payload)
}

export async function validateShortTermMemoryOnDesktop(payload: ShortTermMemoryValidationPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const validateMemory = defineInvoke(context, electronValidateShortTermMemory)

  return validateMemory(payload)
}

export async function searchShortTermMemoryOnDesktop(payload: ShortTermMemorySearchPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const searchMemory = defineInvoke(context, electronSearchShortTermMemory)

  return searchMemory(payload)
}

export async function captureShortTermMemoryOnDesktop(payload: ShortTermMemoryCapturePayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const captureMemory = defineInvoke(context, electronCaptureShortTermMemory)

  return captureMemory(payload)
}

export async function listShortTermMemoryOnDesktop(payload: ShortTermMemoryListPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const listMemory = defineInvoke(context, electronListShortTermMemory)

  return listMemory(payload)
}

export async function clearShortTermMemoryOnDesktop(payload: ShortTermMemoryClearPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  const maybeElectronWindow = rendererWindow as Parameters<typeof isElectronWindow>[0]
  if (!isElectronWindow(maybeElectronWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(maybeElectronWindow.electron.ipcRenderer)
  const clearMemory = defineInvoke(context, electronClearShortTermMemory)

  return clearMemory(payload)
}
