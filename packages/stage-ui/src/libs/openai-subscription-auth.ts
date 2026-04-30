import type { OpenAISubscriptionJwtClaims } from '@proj-airi/stage-shared/openai-subscription-codex'

import { isStageTamagotchi, isStageWeb } from '@proj-airi/stage-shared'
import { proxyOpenAISubscriptionFetchOnDesktop } from '@proj-airi/stage-shared/openai-subscription'
import {
  extractOpenAISubscriptionAccountId,
  extractOpenAISubscriptionAccountIdFromClaims,

  parseOpenAISubscriptionJwtClaims,
} from '@proj-airi/stage-shared/openai-subscription-codex'

import { getAuthToken } from './auth'
import { SERVER_URL } from './server'

export const OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY = 'auth/v1/providers/openai-subscription'
export const OPENAI_SUBSCRIPTION_SESSION_STORAGE_KEY = `${OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY}/session`
export const OPENAI_SUBSCRIPTION_SESSION_HEADER = 'X-OpenAI-Subscription-Session'
export const OPENAI_SUBSCRIPTION_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_SUBSCRIPTION_ISSUER = 'https://auth.openai.com'
export const OPENAI_SUBSCRIPTION_SERVER_PROXY_PATH = '/api/v1/openai-subscription/proxy'
export const OPENAI_SUBSCRIPTION_SERVER_STATUS_PATH = '/api/v1/openai-subscription/status'
export const OPENAI_SUBSCRIPTION_SERVER_OAUTH_START_PATH = '/api/v1/openai-subscription/oauth/start'
export const OPENAI_SUBSCRIPTION_SERVER_LOGOUT_PATH = '/api/v1/openai-subscription/logout'
export const OPENAI_SUBSCRIPTION_LOCAL_BRIDGE_URL = 'http://localhost:6112'
export const OPENAI_SUBSCRIPTION_CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
export const OPENAI_SUBSCRIPTION_ALLOWED_MODELS = [
  'gpt-5.1-codex',
  'gpt-5.1-codex-max',
  'gpt-5.1-codex-mini',
  'gpt-5.2',
  'gpt-5.2-codex',
  'gpt-5.3-codex',
  'gpt-5.4',
  'gpt-5.4-mini',
] as const
const OPENAI_SUBSCRIPTION_SESSION_ID_PATTERN = /^[\w-]{16,128}$/

export interface OpenAISubscriptionTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
}

export {
  extractOpenAISubscriptionAccountId,
  extractOpenAISubscriptionAccountIdFromClaims,
  type OpenAISubscriptionJwtClaims,
  parseOpenAISubscriptionJwtClaims,
}

export interface OpenAISubscriptionServerStatus {
  connected: boolean
  accountId?: string
  expiresAt?: number
}

interface OpenAISubscriptionServerLoginStartResponse {
  url?: string
  authorizationUrl?: string
  redirectUrl?: string
}

function getLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis))
    return null

  return globalThis.localStorage
}

function getStoredAiriAuthToken(): string | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis))
    return null

  return getAuthToken()
}

function createOpenAISubscriptionSessionId(): string {
  const crypto = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto
  if (crypto?.randomUUID)
    return crypto.randomUUID()

  return Array.from({ length: 32 }).fill(Math.floor(Math.random() * 16).toString(16)).join('')
}

function getOpenAISubscriptionSessionId(): string {
  const localStorage = getLocalStorage()
  const stored = localStorage?.getItem(OPENAI_SUBSCRIPTION_SESSION_STORAGE_KEY)
  if (stored && OPENAI_SUBSCRIPTION_SESSION_ID_PATTERN.test(stored))
    return stored

  const sessionId = createOpenAISubscriptionSessionId()
  localStorage?.setItem(OPENAI_SUBSCRIPTION_SESSION_STORAGE_KEY, sessionId)
  return sessionId
}

function getOpenAISubscriptionServerBaseUrl(): string {
  const configuredUrl = import.meta.env.VITE_OPENAI_SUBSCRIPTION_SERVER_URL
  if (configuredUrl)
    return configuredUrl

  const location = (globalThis as { location?: Location }).location
  if (location && ['localhost', '127.0.0.1', '::1'].includes(location.hostname))
    return OPENAI_SUBSCRIPTION_LOCAL_BRIDGE_URL

  return SERVER_URL
}

function createOpenAISubscriptionServerUrl(path: string): URL {
  return new URL(path, getOpenAISubscriptionServerBaseUrl())
}

async function fetchOpenAISubscriptionServer(path: string, init: RequestInit): Promise<Response> {
  const url = createOpenAISubscriptionServerUrl(path)
  try {
    return await globalThis.fetch(url, init)
  }
  catch (error) {
    if (url.origin === OPENAI_SUBSCRIPTION_LOCAL_BRIDGE_URL) {
      throw new Error(`OpenAI subscription local bridge is not running at ${OPENAI_SUBSCRIPTION_LOCAL_BRIDGE_URL}`)
    }

    throw error
  }
}

function createOpenAISubscriptionServerHeaders(headersInit?: RequestInit['headers']): Headers {
  const headers = new Headers(headersInit)
  const token = getStoredAiriAuthToken()
  if (token) {
    headers.set('Authorization', `Bearer ${token}`)
  }
  else {
    headers.set(OPENAI_SUBSCRIPTION_SESSION_HEADER, getOpenAISubscriptionSessionId())
  }

  return headers
}

function getCurrentBrowserLocationHref(): string | undefined {
  const location = (globalThis as { location?: { href?: string } }).location
  return location?.href
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function normalizeOpenAISubscriptionServerStatus(payload: unknown): OpenAISubscriptionServerStatus {
  if (!isRecord(payload))
    return { connected: false }

  const connected = payload.connected === true
    || payload.authenticated === true
    || payload.signedIn === true
    || payload.hasSession === true
  const expiresAt = typeof payload.expiresAt === 'number'
    ? payload.expiresAt
    : typeof payload.accessTokenExpiresAt === 'string'
      ? Date.parse(payload.accessTokenExpiresAt)
      : undefined

  return {
    connected,
    ...(typeof payload.accountId === 'string'
      ? { accountId: payload.accountId }
      : typeof payload.chatgptAccountId === 'string'
        ? { accountId: payload.chatgptAccountId }
        : {}),
    ...(typeof expiresAt === 'number' && Number.isFinite(expiresAt) ? { expiresAt } : {}),
  }
}

async function parseJsonResponse(response: Response): Promise<unknown> {
  const text = await response.text()
  if (!text)
    return undefined

  return JSON.parse(text)
}

export function getStoredOpenAISubscriptionTokens(): OpenAISubscriptionTokens | null {
  const localStorage = getLocalStorage()
  if (!localStorage)
    return null

  const raw = localStorage.getItem(OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY)
  if (!raw)
    return null

  try {
    const parsed = JSON.parse(raw) as Partial<OpenAISubscriptionTokens>
    if (!parsed || typeof parsed !== 'object')
      return null
    if (typeof parsed.accessToken !== 'string' || typeof parsed.refreshToken !== 'string' || typeof parsed.expiresAt !== 'number')
      return null

    return {
      accessToken: parsed.accessToken,
      refreshToken: parsed.refreshToken,
      expiresAt: parsed.expiresAt,
      ...(typeof parsed.accountId === 'string' ? { accountId: parsed.accountId } : {}),
    }
  }
  catch {
    return null
  }
}

export function setStoredOpenAISubscriptionTokens(tokens: OpenAISubscriptionTokens): void {
  const localStorage = getLocalStorage()
  if (!localStorage)
    return

  localStorage.setItem(OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY, JSON.stringify(tokens))
}

export function clearStoredOpenAISubscriptionTokens(): void {
  const localStorage = getLocalStorage()
  if (!localStorage)
    return

  localStorage.removeItem(OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY)
}

export function hasStoredOpenAISubscriptionTokens(): boolean {
  return getStoredOpenAISubscriptionTokens() != null
}

function collectHeaderEntries(headersInit?: RequestInit['headers']): Array<[string, string]> {
  const entries: Array<[string, string]> = []
  const headers = new Headers(headersInit)
  headers.forEach((value, key) => {
    entries.push([key, value])
  })
  return entries
}

async function resolveRequestBody(request: Request): Promise<string | undefined> {
  if (request.method.toUpperCase() === 'GET' || request.method.toUpperCase() === 'HEAD') {
    return undefined
  }

  return request.clone().text()
}

async function createDesktopOpenAISubscriptionResponse(input: string | Request | URL, init?: RequestInit): Promise<Response> {
  const tokens = getStoredOpenAISubscriptionTokens()
  if (!tokens) {
    throw new Error('OpenAI subscription login is missing or expired')
  }

  const request = new Request(input, init)

  const proxyResult = await proxyOpenAISubscriptionFetchOnDesktop({
    request: {
      url: request.url,
      method: request.method,
      headers: collectHeaderEntries(request.headers),
      body: await resolveRequestBody(request),
    },
    tokens,
  })

  if (!proxyResult) {
    throw new Error('OpenAI subscription desktop proxy is unavailable')
  }

  setStoredOpenAISubscriptionTokens(proxyResult.tokens)

  return new Response(proxyResult.response.body, {
    status: proxyResult.response.status,
    statusText: proxyResult.response.statusText,
    headers: new Headers(proxyResult.response.headers),
  })
}

async function createWebOpenAISubscriptionResponse(input: string | Request | URL, init?: RequestInit): Promise<Response> {
  const request = new Request(input, init)
  const headers = createOpenAISubscriptionServerHeaders({
    'Content-Type': 'application/json',
  })
  const body = await resolveRequestBody(request)

  return fetchOpenAISubscriptionServer(OPENAI_SUBSCRIPTION_SERVER_PROXY_PATH, {
    method: 'POST',
    headers,
    credentials: 'omit',
    body: body || '{}',
  })
}

export async function fetchOpenAISubscriptionStatus(): Promise<OpenAISubscriptionServerStatus> {
  const headers = createOpenAISubscriptionServerHeaders()
  const response = await fetchOpenAISubscriptionServer(OPENAI_SUBSCRIPTION_SERVER_STATUS_PATH, {
    method: 'GET',
    headers,
    credentials: 'omit',
  })

  if (response.status === 401) {
    return { connected: false }
  }

  if (!response.ok) {
    throw new Error(`OpenAI subscription status request failed with HTTP ${response.status}`)
  }

  return normalizeOpenAISubscriptionServerStatus(await parseJsonResponse(response))
}

export async function startOpenAISubscriptionLogin(): Promise<string> {
  const headers = createOpenAISubscriptionServerHeaders({
    'Content-Type': 'application/json',
  })
  const response = await fetchOpenAISubscriptionServer(OPENAI_SUBSCRIPTION_SERVER_OAUTH_START_PATH, {
    method: 'POST',
    headers,
    credentials: 'omit',
    redirect: 'manual',
    body: JSON.stringify({
      returnTo: getCurrentBrowserLocationHref(),
    }),
  })

  const location = response.headers.get('Location')
  if (location)
    return new URL(location, SERVER_URL).toString()

  if (!response.ok) {
    throw new Error(`OpenAI subscription login request failed with HTTP ${response.status}`)
  }

  const payload = await parseJsonResponse(response) as OpenAISubscriptionServerLoginStartResponse | undefined
  const url = payload?.url ?? payload?.authorizationUrl ?? payload?.redirectUrl
  if (!url)
    throw new Error('OpenAI subscription login response did not include a redirect URL')

  return new URL(url, SERVER_URL).toString()
}

export async function logoutOpenAISubscription(): Promise<void> {
  const headers = createOpenAISubscriptionServerHeaders()
  const response = await fetchOpenAISubscriptionServer(OPENAI_SUBSCRIPTION_SERVER_LOGOUT_PATH, {
    method: 'POST',
    headers,
    credentials: 'omit',
  })

  if (!response.ok && response.status !== 401) {
    throw new Error(`OpenAI subscription logout request failed with HTTP ${response.status}`)
  }
}

export async function hasOpenAISubscriptionLogin(): Promise<boolean> {
  if (isStageTamagotchi())
    return !!getStoredOpenAISubscriptionTokens()?.refreshToken

  if (isStageWeb())
    return (await fetchOpenAISubscriptionStatus()).connected

  return false
}

export function createOpenAISubscriptionFetch() {
  return async (input: string | Request | URL, init?: RequestInit) => {
    if (isStageTamagotchi())
      return createDesktopOpenAISubscriptionResponse(input, init)

    if (isStageWeb())
      return createWebOpenAISubscriptionResponse(input, init)

    throw new Error('OpenAI subscription provider is unavailable in this runtime')
  }
}
