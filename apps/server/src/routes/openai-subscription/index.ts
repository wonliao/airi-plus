import type { Context } from 'hono'
import type Redis from 'ioredis'

import type { Env } from '../../libs/env'
import type { OpenAISubscriptionAccountService, OpenAISubscriptionAccountWithTokens } from '../../services/openai-subscription'
import type { HonoEnv } from '../../types/hono'

import { errorMessageFrom } from '@moeru/std'
import { Hono } from 'hono'
import { safeParse } from 'valibot'

import { loadOpenAISubscriptionCodexHelpers } from '../../services/openai-subscription-codex'
import { OpenAISubscriptionTokenEncryptionError } from '../../services/openai-subscription-crypto'
import { loadOpenAISubscriptionPkceHelpers } from '../../services/openai-subscription-pkce'
import {
  createBadRequestError,
  createNotFoundError,
  createServiceUnavailableError,
  createUnauthorizedError,
} from '../../utils/error'
import { getTrustedOrigin, resolveTrustedRequestOrigin } from '../../utils/origin'
import { OAuthCallbackQuerySchema, OAuthStartBodySchema, ProxyBodySchema } from './schema'

const OPENAI_SUBSCRIPTION_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_SUBSCRIPTION_ISSUER = 'https://auth.openai.com'
const OPENAI_SUBSCRIPTION_CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const OPENAI_SUBSCRIPTION_STATE_TTL_SECONDS = 10 * 60
const OPENAI_SUBSCRIPTION_REFRESH_SKEW_MS = 60 * 1000
const OPENAI_SUBSCRIPTION_SESSION_HEADER = 'X-OpenAI-Subscription-Session'
const OPENAI_SUBSCRIPTION_LOCAL_CALLBACK_URL = 'http://localhost:1455/auth/callback'
const OPENAI_SUBSCRIPTION_LOCAL_USER_PREFIX = 'openai-subscription-session:'
const OPENAI_SUBSCRIPTION_SESSION_ID_PATTERN = /^[\w-]{16,128}$/

interface OpenAISubscriptionOAuthState {
  codeVerifier: string
  redirectUri: string
  returnTo: string
  userId: string
}

interface OpenAISubscriptionTokenResponse {
  access_token: string
  expires_in?: number
  id_token?: string
  refresh_token?: string
}

function oauthStateKey(state: string) {
  return `openai-subscription:oauth-state:${state}`
}

async function resolveOpenAISubscriptionUserId(c: Context<HonoEnv>, accountService: OpenAISubscriptionAccountService) {
  const user = c.get('user')
  if (user) {
    return user.id
  }

  const sessionId = c.req.header(OPENAI_SUBSCRIPTION_SESSION_HEADER)
  if (!sessionId || !OPENAI_SUBSCRIPTION_SESSION_ID_PATTERN.test(sessionId)) {
    throw createUnauthorizedError('OpenAI subscription session is missing')
  }

  const userId = `${OPENAI_SUBSCRIPTION_LOCAL_USER_PREFIX}${sessionId}`
  await accountService.ensureLocalSubscriptionUser(userId)
  return userId
}

function requireTokenEncryption(accountService: OpenAISubscriptionAccountService) {
  if (!accountService.isTokenEncryptionConfigured()) {
    throw createServiceUnavailableError(
      'OpenAI subscription token encryption key is not configured',
      'OPENAI_SUBSCRIPTION_TOKEN_ENCRYPTION_KEY_MISSING',
    )
  }
}

async function withTokenEncryptionErrors<T>(operation: () => Promise<T>): Promise<T> {
  try {
    return await operation()
  }
  catch (error) {
    if (error instanceof OpenAISubscriptionTokenEncryptionError) {
      throw createServiceUnavailableError(
        error.message,
        'OPENAI_SUBSCRIPTION_TOKEN_ENCRYPTION_UNAVAILABLE',
      )
    }

    throw error
  }
}

async function exchangeOpenAISubscriptionCode(input: {
  code: string
  codeVerifier: string
  redirectUri: string
}) {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: input.code,
    redirect_uri: input.redirectUri,
    client_id: OPENAI_SUBSCRIPTION_CLIENT_ID,
    code_verifier: input.codeVerifier,
  })

  const response = await fetch(new URL('/oauth/token', OPENAI_SUBSCRIPTION_ISSUER), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw createBadRequestError(`OpenAI subscription token exchange failed (${response.status}): ${text}`, 'OPENAI_SUBSCRIPTION_TOKEN_EXCHANGE_FAILED')
  }

  return await response.json() as OpenAISubscriptionTokenResponse
}

async function refreshOpenAISubscriptionAccount(accountService: OpenAISubscriptionAccountService, account: OpenAISubscriptionAccountWithTokens) {
  if (account.accessTokenExpiresAt.getTime() > Date.now() + OPENAI_SUBSCRIPTION_REFRESH_SKEW_MS) {
    return account
  }

  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: account.refreshToken,
    client_id: OPENAI_SUBSCRIPTION_CLIENT_ID,
  })

  const response = await fetch(new URL('/oauth/token', OPENAI_SUBSCRIPTION_ISSUER), {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  })

  if (!response.ok) {
    const text = await response.text()
    throw createUnauthorizedError(`OpenAI subscription token refresh failed (${response.status}): ${text}`)
  }

  const data = await response.json() as OpenAISubscriptionTokenResponse
  const helpers = await loadOpenAISubscriptionCodexHelpers()
  const refreshedAccount = {
    userId: account.userId,
    accessToken: data.access_token,
    refreshToken: typeof data.refresh_token === 'string' ? data.refresh_token : account.refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + (data.expires_in ?? 3600) * 1000),
    chatgptAccountId: helpers.extractOpenAISubscriptionAccountId({
      access_token: data.access_token,
      id_token: data.id_token,
    }) ?? account.chatgptAccountId,
  }

  await accountService.upsertAccountForUser(refreshedAccount)
  return refreshedAccount
}

function buildAuthorizeUrl(redirectUri: string, state: string, codeChallenge: string) {
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
  return url
}

function getOpenAISubscriptionRedirectUri(env: Env) {
  const apiServerUrl = new URL(env.API_SERVER_URL)
  if (apiServerUrl.hostname === 'localhost' || apiServerUrl.hostname === '127.0.0.1' || apiServerUrl.hostname === '[::1]') {
    return OPENAI_SUBSCRIPTION_LOCAL_CALLBACK_URL
  }

  return new URL('/api/v1/openai-subscription/oauth/callback', env.API_SERVER_URL).toString()
}

function getDefaultOpenAISubscriptionReturnTo(request: Request) {
  const trustedOrigin = resolveTrustedRequestOrigin(request) || 'https://airi.moeru.ai'
  return new URL('/settings/providers/chat/openai-subscription', trustedOrigin).toString()
}

function resolveTrustedReturnTo(returnTo: string | undefined, request: Request) {
  if (!returnTo) {
    return getDefaultOpenAISubscriptionReturnTo(request)
  }

  try {
    const url = new URL(returnTo)
    return getTrustedOrigin(url.origin)
      ? url.toString()
      : getDefaultOpenAISubscriptionReturnTo(request)
  }
  catch {
    return getDefaultOpenAISubscriptionReturnTo(request)
  }
}

async function readOptionalJsonBody(request: Request): Promise<unknown> {
  const text = await request.text()
  if (!text.trim()) {
    return {}
  }

  return JSON.parse(text)
}

function appendOpenAISubscriptionCallbackResult(returnTo: string, connected: boolean) {
  const url = new URL(returnTo)
  url.searchParams.set('openaiSubscription', connected ? 'connected' : 'failed')
  return url.toString()
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null
}

function extractProxyRequestPayload(payload: unknown): unknown {
  if (!isRecord(payload) || !isRecord(payload.request)) {
    return payload
  }

  const requestBody = payload.request.body
  if (typeof requestBody !== 'string') {
    return requestBody
  }

  try {
    return JSON.parse(requestBody)
  }
  catch {
    throw createBadRequestError('Invalid OpenAI subscription proxied request body', 'OPENAI_SUBSCRIPTION_INVALID_PROXY_REQUEST_BODY')
  }
}

function safeProxyResponseHeaders(response: Response) {
  const headers = new Headers(response.headers)
  headers.delete('content-length')
  headers.delete('Content-Length')
  return headers
}

export async function handleOpenAISubscriptionOAuthCallback(c: Context<HonoEnv>, input: {
  accountService: OpenAISubscriptionAccountService
  redis: Redis
}) {
  requireTokenEncryption(input.accountService)

  const result = safeParse(OAuthCallbackQuerySchema, c.req.query())
  if (!result.success) {
    throw createBadRequestError('Invalid OpenAI subscription OAuth callback', 'OPENAI_SUBSCRIPTION_INVALID_CALLBACK', result.issues)
  }

  const statePayload = await input.redis.get(oauthStateKey(result.output.state))
  await input.redis.del(oauthStateKey(result.output.state))
  if (!statePayload) {
    throw createBadRequestError('OpenAI subscription OAuth state is missing or expired', 'OPENAI_SUBSCRIPTION_OAUTH_STATE_EXPIRED')
  }

  const oauthState = JSON.parse(statePayload) as OpenAISubscriptionOAuthState
  const user = c.get('user')
  if (user && oauthState.userId !== user.id) {
    throw createUnauthorizedError('OpenAI subscription OAuth state belongs to another user')
  }

  const tokens = await exchangeOpenAISubscriptionCode({
    code: result.output.code,
    codeVerifier: oauthState.codeVerifier,
    redirectUri: oauthState.redirectUri,
  })

  if (typeof tokens.access_token !== 'string' || typeof tokens.refresh_token !== 'string') {
    throw createBadRequestError('OpenAI subscription token response is missing required tokens', 'OPENAI_SUBSCRIPTION_INVALID_TOKEN_RESPONSE')
  }
  const accessToken = tokens.access_token
  const refreshToken = tokens.refresh_token

  const helpers = await loadOpenAISubscriptionCodexHelpers()
  const account = await withTokenEncryptionErrors(() => input.accountService.upsertAccountForUser({
    userId: oauthState.userId,
    accessToken,
    refreshToken,
    accessTokenExpiresAt: new Date(Date.now() + (tokens.expires_in ?? 3600) * 1000),
    chatgptAccountId: helpers.extractOpenAISubscriptionAccountId({
      access_token: accessToken,
      id_token: tokens.id_token,
    }) ?? null,
  }))

  return c.redirect(appendOpenAISubscriptionCallbackResult(oauthState.returnTo, account != null))
}

export function createOpenAISubscriptionRoutes(input: {
  accountService: OpenAISubscriptionAccountService
  env: Env
  redis: Redis
}) {
  return new Hono<HonoEnv>()
    .post('/oauth/start', async (c) => {
      requireTokenEncryption(input.accountService)

      const userId = await resolveOpenAISubscriptionUserId(c, input.accountService)
      const startBody = safeParse(OAuthStartBodySchema, await readOptionalJsonBody(c.req.raw))
      if (!startBody.success) {
        throw createBadRequestError('Invalid OpenAI subscription OAuth start payload', 'OPENAI_SUBSCRIPTION_INVALID_START_PAYLOAD', startBody.issues)
      }

      const pkce = await loadOpenAISubscriptionPkceHelpers()
      const codeVerifier = pkce.generateCodeVerifier()
      const codeChallenge = await pkce.generateCodeChallenge(codeVerifier)
      const state = pkce.generateState()
      const redirectUri = getOpenAISubscriptionRedirectUri(input.env)
      const returnTo = resolveTrustedReturnTo(startBody.output.returnTo, c.req.raw)

      await input.redis.set(
        oauthStateKey(state),
        JSON.stringify({ userId, codeVerifier, redirectUri, returnTo } satisfies OpenAISubscriptionOAuthState),
        'EX',
        OPENAI_SUBSCRIPTION_STATE_TTL_SECONDS,
      )

      return c.json({
        authorizationUrl: buildAuthorizeUrl(redirectUri, state, codeChallenge).toString(),
        expiresIn: OPENAI_SUBSCRIPTION_STATE_TTL_SECONDS,
        returnTo,
        state,
      })
    })

    .get('/oauth/callback', async (c) => {
      return handleOpenAISubscriptionOAuthCallback(c, input)
    })

    .get('/status', async (c) => {
      const userId = await resolveOpenAISubscriptionUserId(c, input.accountService)
      const account = await input.accountService.getStoredAccountByUserId(userId)
      return c.json({
        connected: account != null,
        chatgptAccountId: account?.chatgptAccountId ?? null,
        accessTokenExpiresAt: account?.accessTokenExpiresAt.toISOString() ?? null,
        tokenEncryptionConfigured: input.accountService.isTokenEncryptionConfigured(),
      })
    })

    .post('/logout', async (c) => {
      const userId = await resolveOpenAISubscriptionUserId(c, input.accountService)
      await input.accountService.deleteAccountByUserId(userId)
      return c.body(null, 204)
    })

    .post('/proxy', async (c) => {
      requireTokenEncryption(input.accountService)

      const userId = await resolveOpenAISubscriptionUserId(c, input.accountService)
      const result = safeParse(ProxyBodySchema, await readOptionalJsonBody(c.req.raw))
      if (!result.success) {
        throw createBadRequestError('Invalid OpenAI subscription proxy payload', 'OPENAI_SUBSCRIPTION_INVALID_PROXY_PAYLOAD', result.issues)
      }

      const account = await withTokenEncryptionErrors(() => input.accountService.getAccountByUserId(userId))
      if (!account) {
        throw createNotFoundError('OpenAI subscription account is not connected')
      }

      const activeAccount = await withTokenEncryptionErrors(() => refreshOpenAISubscriptionAccount(input.accountService, account))
      const helpers = await loadOpenAISubscriptionCodexHelpers()
      const requestBody = helpers.normalizeOpenAISubscriptionCodexBody(JSON.stringify(extractProxyRequestPayload(result.output)))

      const response = await fetch(OPENAI_SUBSCRIPTION_CODEX_ENDPOINT, {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${activeAccount.accessToken}`,
          'Content-Type': 'application/json',
          ...(activeAccount.chatgptAccountId ? { 'ChatGPT-Account-Id': activeAccount.chatgptAccountId } : {}),
        },
        body: requestBody,
      })

      const responseBody = await response.text()
      const headers = safeProxyResponseHeaders(response)
      if (!response.ok) {
        return new Response(responseBody, { status: response.status, statusText: response.statusText, headers })
      }

      try {
        headers.set('content-type', 'text/event-stream; charset=utf-8')
        return new Response(helpers.transformCodexResponseToChatCompletionsSSE(responseBody), {
          status: response.status,
          statusText: response.statusText,
          headers,
        })
      }
      catch (error) {
        throw createServiceUnavailableError(
          errorMessageFrom(error) ?? 'Failed to transform OpenAI subscription response',
          'OPENAI_SUBSCRIPTION_RESPONSE_TRANSFORM_FAILED',
        )
      }
    })
}
