import type { ElectronAPI } from '@electron-toolkit/preload'

import { defineInvoke, defineInvokeEventa } from '@moeru/eventa'

function getRendererWindow() {
  return (globalThis as { window?: unknown }).window
}

function isElectronProxyWindow(
  value: unknown,
): value is { electron: Pick<ElectronAPI, 'ipcRenderer'> } {
  return typeof value === 'object' && value !== null && 'electron' in value
}

export interface ElectronOpenAISubscriptionProxyTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
}

export interface ElectronOpenAISubscriptionProxyRequest {
  url: string
  method?: string
  headers?: Array<[string, string]>
  body?: string
}

export interface ElectronOpenAISubscriptionProxyPayload {
  request: ElectronOpenAISubscriptionProxyRequest
  tokens: ElectronOpenAISubscriptionProxyTokens
}

export interface ElectronOpenAISubscriptionProxyResponse {
  status: number
  statusText: string
  headers: Array<[string, string]>
  body: string
}

export interface ElectronOpenAISubscriptionProxyResult {
  response: ElectronOpenAISubscriptionProxyResponse
  tokens: ElectronOpenAISubscriptionProxyTokens
}

export const electronOpenAISubscriptionProxyFetch = defineInvokeEventa<ElectronOpenAISubscriptionProxyResult, ElectronOpenAISubscriptionProxyPayload>('eventa:invoke:electron:providers:openai-subscription:proxy-fetch')

export async function proxyOpenAISubscriptionFetchOnDesktop(payload: ElectronOpenAISubscriptionProxyPayload) {
  const rendererWindow = getRendererWindow()
  if (!rendererWindow) {
    return undefined
  }

  if (!isElectronProxyWindow(rendererWindow)) {
    return undefined
  }

  const { createContext } = await import('@moeru/eventa/adapters/electron/renderer')
  const { context } = createContext(rendererWindow.electron.ipcRenderer)
  const proxyFetch = defineInvoke(context, electronOpenAISubscriptionProxyFetch)

  return proxyFetch(payload)
}
