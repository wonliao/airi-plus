import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'

import { isElectronWindow } from './window'

function getRendererWindow() {
  return (globalThis as { window?: unknown }).window
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

export const electronValidateLlmWikiWorkspace = defineInvokeEventa<LlmWikiWorkspaceValidationResult, LlmWikiWorkspaceValidationPayload>('eventa:invoke:electron:memory:llm-wiki:validate-workspace')
export const electronEnsureDefaultLlmWikiWorkspace = defineInvokeEventa<LlmWikiDefaultWorkspaceResult, void>('eventa:invoke:electron:memory:llm-wiki:ensure-default-workspace')
export const electronQueryLlmWiki = defineInvokeEventa<LlmWikiQueryResult, LlmWikiQueryPayload>('eventa:invoke:electron:memory:llm-wiki:query')

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
