import { proxyOpenAISubscriptionFetchOnDesktop } from '@proj-airi/stage-shared/openai-subscription'

export const OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY = 'auth/v1/providers/openai-subscription'
export const OPENAI_SUBSCRIPTION_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
export const OPENAI_SUBSCRIPTION_ISSUER = 'https://auth.openai.com'
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
const BASE64_URL_DASH_PATTERN = /-/g
const BASE64_URL_UNDERSCORE_PATTERN = /_/g

export interface OpenAISubscriptionTokens {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
}

interface OpenAISubscriptionTokenResponse {
  access_token: string
  refresh_token: string
  expires_in?: number
  id_token?: string
}

interface OpenAISubscriptionJwtClaims {
  'chatgpt_account_id'?: string
  'organizations'?: Array<{ id: string }>
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
}

function getLocalStorage(): Storage | null {
  if (typeof globalThis === 'undefined' || !('localStorage' in globalThis))
    return null

  return globalThis.localStorage
}

function decodeBase64Url(value: string): string {
  const normalized = value.replace(BASE64_URL_DASH_PATTERN, '+').replace(BASE64_URL_UNDERSCORE_PATTERN, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')

  if (typeof globalThis.atob === 'function') {
    const binary = globalThis.atob(padded)
    const bytes = Uint8Array.from(binary, char => char.charCodeAt(0))
    return new TextDecoder().decode(bytes)
  }

  throw new Error('No base64 decoder available in this runtime')
}

export function parseOpenAISubscriptionJwtClaims(token: string): OpenAISubscriptionJwtClaims | undefined {
  const parts = token.split('.')
  if (parts.length !== 3)
    return undefined

  try {
    return JSON.parse(decodeBase64Url(parts[1])) as OpenAISubscriptionJwtClaims
  }
  catch {
    return undefined
  }
}

export function extractOpenAISubscriptionAccountIdFromClaims(claims: OpenAISubscriptionJwtClaims): string | undefined {
  return claims.chatgpt_account_id
    || claims['https://api.openai.com/auth']?.chatgpt_account_id
    || claims.organizations?.[0]?.id
}

export function extractOpenAISubscriptionAccountId(tokens: Pick<OpenAISubscriptionTokenResponse, 'access_token' | 'id_token'>): string | undefined {
  if (tokens.id_token) {
    const claims = parseOpenAISubscriptionJwtClaims(tokens.id_token)
    const accountId = claims && extractOpenAISubscriptionAccountIdFromClaims(claims)
    if (accountId) {
      return accountId
    }
  }

  const accessClaims = parseOpenAISubscriptionJwtClaims(tokens.access_token)
  return accessClaims ? extractOpenAISubscriptionAccountIdFromClaims(accessClaims) : undefined
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

export function createOpenAISubscriptionFetch() {
  return async (input: string | Request | URL, init?: RequestInit) => {
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
}
