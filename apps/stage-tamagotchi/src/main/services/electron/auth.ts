import type { createContext } from '@moeru/eventa/adapters/electron/main'
import type {
  ElectronOpenAISubscriptionProxyPayload,
  ElectronOpenAISubscriptionProxyTokens,
} from '@proj-airi/stage-shared/openai-subscription'
import type { BrowserWindow } from 'electron'

import { useLogg } from '@guiiai/logg'
import { defineInvokeHandler } from '@moeru/eventa'
import { errorMessageFrom } from '@moeru/std'
import { generateCodeChallenge, generateCodeVerifier, generateState } from '@proj-airi/stage-shared/auth'
import {
  electronOpenAISubscriptionProxyFetch,
} from '@proj-airi/stage-shared/openai-subscription'
import {
  extractOpenAISubscriptionAccountId,
  mapChatMessagesToCodexInput,
  normalizeOpenAISubscriptionCodexBody,
  transformCodexResponseToChatCompletionsJson,
  transformCodexResponseToChatCompletionsSSE,
} from '@proj-airi/stage-shared/openai-subscription-codex'
import {
  OPENAI_SUBSCRIPTION_CLIENT_ID,
  OPENAI_SUBSCRIPTION_CODEX_ENDPOINT,
  OPENAI_SUBSCRIPTION_ISSUER,
} from '@proj-airi/stage-ui/libs/openai-subscription-auth'
import { shell } from 'electron'

import {
  electronAuthCallback,
  electronAuthCallbackError,
  electronAuthLogout,
  electronAuthStartLogin,
  electronOpenAISubscriptionAuthCallback,
  electronOpenAISubscriptionAuthCallbackError,
  electronOpenAISubscriptionAuthLogout,
  electronOpenAISubscriptionAuthStartLogin,
} from '../../../shared/eventa'
import { startLoopbackServer } from './loopback-server'

export {
  mapChatMessagesToCodexInput,
  normalizeOpenAISubscriptionCodexBody,
  transformCodexResponseToChatCompletionsSSE,
}

const log = useLogg('auth-service').useGlobalConfig()

type MainContext = ReturnType<typeof createContext>['context']

// OIDC configuration for the Electron client.
const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID || 'airi-stage-electron'
const OIDC_SCOPES = 'openid profile email offline_access'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://api.airi.build'
const OIDC_AUTHORIZE_PATH = '/api/auth/oauth2/authorize'
const OIDC_TOKEN_PATH = '/api/auth/oauth2/token'

// Active loopback server cleanup handle
let closeLoopback: (() => void) | null = null
let loginInFlight = false
const authContexts = new Set<MainContext>()
let closeOpenAISubscriptionLoopback: (() => void) | null = null
let openAISubscriptionLoginInFlight = false
const OPENAI_SUBSCRIPTION_OAUTH_PORT = 1455
const OPENAI_SUBSCRIPTION_CALLBACK_PATH = '/auth/callback'

interface OpenAISubscriptionTokenExchangeResult {
  accessToken: string
  refreshToken: string
  expiresIn: number
  accountId?: string
}

function emitAuthCallback(tokens: TokenExchangeResult): void {
  for (const context of authContexts) {
    context.emit(electronAuthCallback, tokens)
  }
}

function emitAuthError(error: string): void {
  for (const context of authContexts) {
    context.emit(electronAuthCallbackError, { error })
  }
}

function emitOpenAISubscriptionAuthCallback(tokens: OpenAISubscriptionTokenExchangeResult): void {
  for (const context of authContexts) {
    context.emit(electronOpenAISubscriptionAuthCallback, tokens)
  }
}

function emitOpenAISubscriptionAuthError(error: string): void {
  for (const context of authContexts) {
    context.emit(electronOpenAISubscriptionAuthCallbackError, { error })
  }
}

/**
 * Create the auth service IPC handlers for a given window context.
 */
export function createAuthService(params: {
  context: MainContext
  window: BrowserWindow
}): void {
  authContexts.add(params.context)
  params.window.on('closed', () => {
    authContexts.delete(params.context)
  })

  defineInvokeHandler(params.context, electronAuthStartLogin, async (_, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    if (loginInFlight) {
      log.withFields({ windowId: params.window.webContents.id }).warn('Replacing in-flight OIDC login attempt with a new request')
      closeLoopback?.()
      closeLoopback = null
      loginInFlight = false
    }

    loginInFlight = true

    try {
      // Clean up any previous in-flight login
      closeLoopback?.()

      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      const state = generateState()

      // Start loopback server to receive the callback
      const loopback = await startLoopbackServer()
      closeLoopback = loopback.close

      // Use the server-side relay as redirect_uri. The relay page serves HTML
      // that forwards the authorization code to the loopback via JS fetch().
      // The loopback port is encoded in the state parameter as "{port}:{state}".
      const redirectUri = `${SERVER_URL}/api/auth/oidc/electron-callback`
      const stateWithPort = `${loopback.port}:${state}`

      // Build authorization URL
      // NOTICE: prompt=login forces the authorization server to show the login
      // page even if the system browser has an existing session cookie. Without
      // this, the OIDC flow auto-completes silently using the stale cookie.
      const url = new URL(OIDC_AUTHORIZE_PATH, SERVER_URL)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', OIDC_CLIENT_ID)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', OIDC_SCOPES)
      url.searchParams.set('state', stateWithPort)
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('prompt', 'login')

      // Open system browser
      await shell.openExternal(url.toString())

      // Wait for the callback in the background
      loopback.result
        .then(async ({ code, state: returnedState }) => {
          if (returnedState !== state) {
            log.warn('State mismatch — possible CSRF attack')
            emitAuthError('State mismatch')
            return
          }

          const tokens = await exchangeCode(code, codeVerifier, redirectUri)
          emitAuthCallback(tokens)
          log.log('OIDC token exchange successful')
        })
        .catch((err) => {
          log.withError(err).error('OIDC login failed')
          emitAuthError(errorMessageFrom(err) ?? 'OIDC login failed')
        })
        .finally(() => {
          closeLoopback = null
          loginInFlight = false
        })
    }
    catch (err) {
      closeLoopback = null
      loginInFlight = false
      log.withError(err).error('Failed to start OIDC login flow')
      emitAuthError(errorMessageFrom(err) ?? 'OIDC login failed')
    }
  })

  defineInvokeHandler(params.context, electronAuthLogout, async (_, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    closeLoopback?.()
    closeLoopback = null
    loginInFlight = false
  })

  defineInvokeHandler(params.context, electronOpenAISubscriptionAuthStartLogin, async (_, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    if (openAISubscriptionLoginInFlight) {
      log.withFields({ windowId: params.window.webContents.id }).warn('Replacing in-flight OpenAI subscription login attempt with a new request')
      closeOpenAISubscriptionLoopback?.()
      closeOpenAISubscriptionLoopback = null
      openAISubscriptionLoginInFlight = false
    }

    openAISubscriptionLoginInFlight = true

    try {
      closeOpenAISubscriptionLoopback?.()

      const codeVerifier = generateCodeVerifier()
      const codeChallenge = await generateCodeChallenge(codeVerifier)
      const state = generateState()
      const loopback = await startLoopbackServer({
        callbackPath: OPENAI_SUBSCRIPTION_CALLBACK_PATH,
        host: '127.0.0.1',
        ports: [OPENAI_SUBSCRIPTION_OAUTH_PORT],
      })
      closeOpenAISubscriptionLoopback = loopback.close

      const redirectUri = `http://localhost:${loopback.port}${OPENAI_SUBSCRIPTION_CALLBACK_PATH}`
      const url = new URL('/oauth/authorize', OPENAI_SUBSCRIPTION_ISSUER)
      url.searchParams.set('response_type', 'code')
      url.searchParams.set('client_id', OPENAI_SUBSCRIPTION_CLIENT_ID)
      url.searchParams.set('redirect_uri', redirectUri)
      url.searchParams.set('scope', 'openid profile email offline_access')
      url.searchParams.set('code_challenge', codeChallenge)
      url.searchParams.set('code_challenge_method', 'S256')
      url.searchParams.set('id_token_add_organizations', 'true')
      url.searchParams.set('codex_cli_simplified_flow', 'true')
      url.searchParams.set('originator', 'airi')
      url.searchParams.set('state', state)

      await shell.openExternal(url.toString())

      loopback.result
        .then(async ({ code, state: returnedState }) => {
          if (returnedState !== state) {
            emitOpenAISubscriptionAuthError('State mismatch')
            return
          }

          const tokens = await exchangeOpenAISubscriptionCode(code, codeVerifier, redirectUri)
          emitOpenAISubscriptionAuthCallback(tokens)
        })
        .catch((err) => {
          log.withError(err).error('OpenAI subscription login failed')
          emitOpenAISubscriptionAuthError(errorMessageFrom(err) ?? 'OpenAI subscription login failed')
        })
        .finally(() => {
          closeOpenAISubscriptionLoopback = null
          openAISubscriptionLoginInFlight = false
        })
    }
    catch (err) {
      closeOpenAISubscriptionLoopback = null
      openAISubscriptionLoginInFlight = false
      log.withError(err).error('Failed to start OpenAI subscription login flow')
      emitOpenAISubscriptionAuthError(errorMessageFrom(err) ?? 'OpenAI subscription login failed')
    }
  })

  defineInvokeHandler(params.context, electronOpenAISubscriptionAuthLogout, async (_, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      return
    }

    closeOpenAISubscriptionLoopback?.()
    closeOpenAISubscriptionLoopback = null
    openAISubscriptionLoginInFlight = false
  })

  defineInvokeHandler(params.context, electronOpenAISubscriptionProxyFetch, async (payload, options) => {
    if (params.window.webContents.id !== options?.raw.ipcMainEvent.sender.id) {
      throw new Error('OpenAI subscription proxy is only available to the requesting window')
    }

    return proxyOpenAISubscriptionRequest(payload)
  })
}

// --- Internal helpers ---

interface TokenExchangeResult {
  accessToken: string
  refreshToken?: string
  idToken?: string
  expiresIn: number
}

async function exchangeCode(code: string, codeVerifier: string, redirectUri: string): Promise<TokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OIDC_CLIENT_ID,
    code_verifier: codeVerifier,
  })

  const response = await fetch(new URL(OIDC_TOKEN_PATH, SERVER_URL), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`Token exchange failed (${response.status}): ${text}`)
  }

  const data = await response.json() as Record<string, unknown>
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string | undefined,
    idToken: data.id_token as string | undefined,
    expiresIn: data.expires_in as number,
  }
}

async function exchangeOpenAISubscriptionCode(code: string, codeVerifier: string, redirectUri: string): Promise<OpenAISubscriptionTokenExchangeResult> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code,
    redirect_uri: redirectUri,
    client_id: OPENAI_SUBSCRIPTION_CLIENT_ID,
    code_verifier: codeVerifier,
  })

  const response = await fetch(new URL('/oauth/token', OPENAI_SUBSCRIPTION_ISSUER), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenAI subscription token exchange failed (${response.status}): ${text}`)
  }

  const data = await response.json() as Record<string, unknown>
  return {
    accessToken: data.access_token as string,
    refreshToken: data.refresh_token as string,
    expiresIn: data.expires_in as number,
    accountId: extractOpenAISubscriptionAccountId({
      access_token: data.access_token as string,
      id_token: typeof data.id_token === 'string' ? data.id_token : undefined,
    }),
  }
}

function shouldRefreshOpenAISubscriptionTokens(tokens: ElectronOpenAISubscriptionProxyTokens) {
  return tokens.expiresAt <= Date.now() + 60_000
}

async function refreshOpenAISubscriptionProxyTokens(tokens: ElectronOpenAISubscriptionProxyTokens): Promise<ElectronOpenAISubscriptionProxyTokens> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: tokens.refreshToken,
    client_id: OPENAI_SUBSCRIPTION_CLIENT_ID,
  })

  const response = await fetch(new URL('/oauth/token', OPENAI_SUBSCRIPTION_ISSUER), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw new Error(`OpenAI subscription token refresh failed (${response.status}): ${text}`)
  }

  const data = await response.json() as Record<string, unknown>
  return {
    accessToken: data.access_token as string,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : tokens.refreshToken,
    expiresAt: Date.now() + ((data.expires_in as number | undefined) ?? 3600) * 1000,
    accountId: extractOpenAISubscriptionAccountId({
      access_token: data.access_token as string,
      id_token: typeof data.id_token === 'string' ? data.id_token : undefined,
    }) ?? tokens.accountId,
  }
}

function rewriteOpenAISubscriptionTargetUrl(url: string) {
  const currentUrl = new URL(url)
  if (currentUrl.pathname.includes('/v1/responses') || currentUrl.pathname.includes('/chat/completions')) {
    return new URL(OPENAI_SUBSCRIPTION_CODEX_ENDPOINT)
  }

  return currentUrl
}

async function proxyOpenAISubscriptionRequest(payload: ElectronOpenAISubscriptionProxyPayload) {
  const nextTokens = shouldRefreshOpenAISubscriptionTokens(payload.tokens)
    ? await refreshOpenAISubscriptionProxyTokens(payload.tokens)
    : payload.tokens

  const headers = new Headers(payload.request.headers)
  headers.delete('authorization')
  headers.delete('Authorization')
  headers.set('authorization', `Bearer ${nextTokens.accessToken}`)
  if (nextTokens.accountId) {
    headers.set('ChatGPT-Account-Id', nextTokens.accountId)
  }

  const targetUrl = rewriteOpenAISubscriptionTargetUrl(payload.request.url)
  const requestBody = targetUrl.toString() === OPENAI_SUBSCRIPTION_CODEX_ENDPOINT
    ? normalizeOpenAISubscriptionCodexBody(payload.request.body)
    : payload.request.body

  const response = await fetch(targetUrl, {
    method: payload.request.method,
    headers,
    body: requestBody,
  })

  let responseBody = await response.text()
  const responseHeaders = new Headers(response.headers)
  if (!response.ok && targetUrl.toString() === OPENAI_SUBSCRIPTION_CODEX_ENDPOINT) {
    try {
      const normalizedPayload = requestBody ? JSON.parse(requestBody) as Record<string, unknown> : {}
      log.warn('OpenAI subscription Codex proxy request failed', {
        status: response.status,
        responseBody,
        instructions: normalizedPayload.instructions,
        toolChoice: normalizedPayload.tool_choice,
        tools: Array.isArray(normalizedPayload.tools)
          ? normalizedPayload.tools.map((tool) => {
              if (!tool || typeof tool !== 'object') {
                return tool
              }

              const record = tool as Record<string, unknown>
              return {
                type: record.type,
                name: record.name,
                hasParameters: record.parameters != null,
              }
            })
          : normalizedPayload.tools,
      })
    }
    catch (error) {
      log.withError(error).warn('Failed to inspect OpenAI subscription Codex proxy request payload')
    }
  }
  else if (response.ok && targetUrl.toString() === OPENAI_SUBSCRIPTION_CODEX_ENDPOINT) {
    responseBody = transformCodexResponseToChatCompletionsSSE(responseBody)
    responseHeaders.set('content-type', 'text/event-stream; charset=utf-8')
    responseHeaders.delete('content-length')
    responseHeaders.delete('Content-Length')
  }

  return {
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: Array.from(responseHeaders.entries()),
      body: responseBody,
    },
    tokens: nextTokens,
  }
}

export async function proxyOpenAISubscriptionRequestAsChatCompletionsJson(payload: ElectronOpenAISubscriptionProxyPayload & {
  model: string
}) {
  const nextTokens = shouldRefreshOpenAISubscriptionTokens(payload.tokens)
    ? await refreshOpenAISubscriptionProxyTokens(payload.tokens)
    : payload.tokens

  const headers = new Headers(payload.request.headers)
  headers.delete('authorization')
  headers.delete('Authorization')
  headers.set('authorization', `Bearer ${nextTokens.accessToken}`)
  if (nextTokens.accountId) {
    headers.set('ChatGPT-Account-Id', nextTokens.accountId)
  }

  const targetUrl = rewriteOpenAISubscriptionTargetUrl(payload.request.url)
  const requestBody = targetUrl.toString() === OPENAI_SUBSCRIPTION_CODEX_ENDPOINT
    ? normalizeOpenAISubscriptionCodexBody(payload.request.body)
    : payload.request.body

  const response = await fetch(targetUrl, {
    method: payload.request.method,
    headers,
    body: requestBody,
  })

  const responseBody = await response.text()
  if (!response.ok) {
    return {
      response: {
        status: response.status,
        statusText: response.statusText,
        headers: [['content-type', response.headers.get('content-type') || 'application/json']],
        body: responseBody,
      },
      tokens: nextTokens,
    }
  }

  const normalizedJson = targetUrl.toString() === OPENAI_SUBSCRIPTION_CODEX_ENDPOINT
    ? transformCodexResponseToChatCompletionsJson(responseBody, payload.model)
    : JSON.parse(responseBody)

  return {
    response: {
      status: response.status,
      statusText: response.statusText,
      headers: [['content-type', 'application/json; charset=utf-8']],
      body: JSON.stringify(normalizedJson),
    },
    tokens: nextTokens,
  }
}
