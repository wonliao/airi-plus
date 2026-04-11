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

const log = useLogg('auth-service').useGlobalConfig()

type MainContext = ReturnType<typeof createContext>['context']

// OIDC configuration for the Electron client.
const OIDC_CLIENT_ID = import.meta.env.VITE_OIDC_CLIENT_ID || 'airi-stage-electron'
const OIDC_SCOPES = 'openid profile email offline_access'
const SERVER_URL = import.meta.env.VITE_SERVER_URL || 'https://api.airi.build'
const OIDC_AUTHORIZE_PATH = '/api/auth/oauth2/authorize'
const OIDC_TOKEN_PATH = '/api/auth/oauth2/token'
const OPENAI_SUBSCRIPTION_FALLBACK_INSTRUCTIONS = 'You are AIRI, a helpful AI assistant.'

// Active loopback server cleanup handle
let closeLoopback: (() => void) | null = null
let loginInFlight = false
const authContexts = new Set<MainContext>()
let closeOpenAISubscriptionLoopback: (() => void) | null = null
let openAISubscriptionLoginInFlight = false
const OPENAI_SUBSCRIPTION_OAUTH_PORT = 1455
const OPENAI_SUBSCRIPTION_CALLBACK_PATH = '/auth/callback'
const WINDOWS_NEWLINE_PATTERN = /\r\n/g

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

function extractTextFromResponseContentPart(part: unknown): string {
  if (typeof part === 'string') {
    return part
  }

  if (!part || typeof part !== 'object') {
    return ''
  }

  if ('text' in part && typeof part.text === 'string') {
    return part.text
  }

  if ('content' in part) {
    if (typeof part.content === 'string') {
      return part.content
    }

    if (Array.isArray(part.content)) {
      return part.content
        .map(extractTextFromResponseContentPart)
        .filter(Boolean)
        .join('\n')
    }
  }

  if ('output' in part && typeof part.output === 'string') {
    return part.output
  }

  return ''
}

function extractInstructionTextFromMessage(message: unknown): string {
  if (!message || typeof message !== 'object') {
    return ''
  }

  const record = message as Record<string, unknown>

  if (typeof record.content === 'string') {
    return record.content
  }

  if (Array.isArray(record.content)) {
    return record.content
      .map(extractTextFromResponseContentPart)
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

export function mapChatMessagesToCodexInput(messages: unknown[]): Array<Record<string, unknown>> {
  return messages.flatMap((message) => {
    if (!message || typeof message !== 'object') {
      return []
    }

    const record = message as Record<string, unknown>

    if (record.role === 'system') {
      return []
    }

    const normalizedRole = record.role === 'assistant' ? 'assistant' : 'user'
    const textContentType = normalizedRole === 'assistant' ? 'output_text' : 'input_text'
    const content = Array.isArray(record.content)
      ? record.content
      : [{ type: textContentType, text: String(record.content ?? '') }]

    return [{
      role: normalizedRole,
      content: content.map((item: unknown) => {
        if (item && typeof item === 'object' && 'type' in item && item.type === 'tool_result') {
          return {
            type: 'function_call_output',
            call_id: 'tool_call_id' in item ? item.tool_call_id : undefined,
            output: 'content' in item
              ? (typeof item.content === 'string' ? item.content : JSON.stringify(item.content ?? ''))
              : '',
          }
        }

        if (item && typeof item === 'object' && 'type' in item && item.type === 'image_url') {
          return item
        }

        return {
          type: textContentType,
          text: extractTextFromResponseContentPart(item) || String(record.content ?? ''),
        }
      }),
    }]
  })
}

function deriveInstructionsFromMessages(messages: unknown[]): string | undefined {
  const instructionText = messages
    .filter((message): message is Record<string, unknown> => !!message && typeof message === 'object')
    .filter(message => message.role === 'system')
    .map(extractInstructionTextFromMessage)
    .filter(Boolean)
    .join('\n\n')
    .trim()

  return instructionText || undefined
}

function normalizeResponsesInputForCodex(input: unknown): unknown {
  if (!Array.isArray(input)) {
    return input
  }

  return input.filter((entry) => {
    if (!entry || typeof entry !== 'object') {
      return true
    }

    return entry.role !== 'system'
  })
}

function normalizeCodexToolChoice(toolChoice: unknown): unknown {
  if (!toolChoice || typeof toolChoice === 'string') {
    return toolChoice
  }

  if (typeof toolChoice !== 'object') {
    return toolChoice
  }

  const record = toolChoice as Record<string, unknown>
  const toolFunction = record.function
  if (record.type === 'function' && toolFunction && typeof toolFunction === 'object') {
    const functionRecord = toolFunction as Record<string, unknown>
    if (typeof functionRecord.name === 'string' && functionRecord.name.trim()) {
      return {
        type: 'function',
        name: functionRecord.name,
      }
    }
  }

  return toolChoice
}

function normalizeCodexTools(tools: unknown): unknown {
  if (!Array.isArray(tools)) {
    return tools
  }

  const normalizedTools = tools.map((tool) => {
    if (!tool || typeof tool !== 'object') {
      return undefined
    }

    const record = tool as Record<string, unknown>
    if (typeof record.name === 'string' && record.name.trim()) {
      return {
        ...record,
        name: record.name,
      }
    }

    const toolFunction = record.function
    if (record.type === 'function' && toolFunction && typeof toolFunction === 'object') {
      const functionRecord = toolFunction as Record<string, unknown>
      if (!functionRecord.name || typeof functionRecord.name !== 'string' || !functionRecord.name.trim()) {
        return undefined
      }

      return {
        type: 'function',
        name: functionRecord.name,
        description: functionRecord.description,
        parameters: functionRecord.parameters,
        strict: functionRecord.strict,
      }
    }

    return undefined
  }).filter(Boolean)

  return normalizedTools.length > 0 ? normalizedTools : undefined
}

export function normalizeOpenAISubscriptionCodexBody(body: string | undefined): string | undefined {
  if (!body) {
    return body
  }

  try {
    const payload = JSON.parse(body) as Record<string, unknown>
    const existingInstructions = typeof payload.instructions === 'string' ? payload.instructions.trim() : ''
    const messages = Array.isArray(payload.messages) ? payload.messages : undefined
    const input = payload.input
    const normalizedTools = normalizeCodexTools(payload.tools)
    const normalizedToolChoice = normalizedTools ? normalizeCodexToolChoice(payload.tool_choice) : undefined

    const normalizedInput = messages
      ? mapChatMessagesToCodexInput(messages)
      : normalizeResponsesInputForCodex(input)

    const derivedInstructions = existingInstructions
      || (messages ? deriveInstructionsFromMessages(messages) : undefined)
      || (Array.isArray(input) ? deriveInstructionsFromMessages(input) : undefined)
      || OPENAI_SUBSCRIPTION_FALLBACK_INSTRUCTIONS

    const normalizedPayload: Record<string, unknown> = {
      ...payload,
      ...(messages ? { input: normalizedInput } : {}),
      ...(!messages && normalizedInput !== undefined ? { input: normalizedInput } : {}),
      instructions: derivedInstructions,
      store: false,
      ...(normalizedTools !== undefined ? { tools: normalizedTools } : {}),
      ...(normalizedToolChoice !== undefined ? { tool_choice: normalizedToolChoice } : {}),
    }

    delete normalizedPayload.messages

    return JSON.stringify(normalizedPayload)
  }
  catch {
    return body
  }
}

interface OpenAISubscriptionSSEEvent {
  event?: string
  data: string
}

interface OpenAISubscriptionChatCompletionChunk {
  choices?: Array<{
    delta: Record<string, unknown>
    finish_reason?: string | null
  }>
  usage?: {
    prompt_tokens: number
    completion_tokens: number
    total_tokens: number
  }
}

interface OpenAISubscriptionToolCallState {
  id: string
  index: number
  name: string
  started: boolean
}

function parseSSEEvents(body: string): OpenAISubscriptionSSEEvent[] {
  const events: OpenAISubscriptionSSEEvent[] = []
  const normalized = body.replace(WINDOWS_NEWLINE_PATTERN, '\n')
  const chunks = normalized.split('\n\n')

  for (const chunk of chunks) {
    const trimmedChunk = chunk.trim()
    if (!trimmedChunk) {
      continue
    }

    const lines = trimmedChunk.split('\n')
    let eventName: string | undefined
    const dataLines: string[] = []

    for (const line of lines) {
      if (line.startsWith('event:')) {
        eventName = line.slice('event:'.length).trim()
        continue
      }

      if (line.startsWith('data:')) {
        dataLines.push(line.slice('data:'.length).trimStart())
      }
    }

    if (dataLines.length === 0) {
      continue
    }

    events.push({
      event: eventName,
      data: dataLines.join('\n'),
    })
  }

  return events
}

function toSSEDataLine(payload: OpenAISubscriptionChatCompletionChunk | '[DONE]'): string {
  if (payload === '[DONE]') {
    return 'data: [DONE]\n\n'
  }

  return `data: ${JSON.stringify(payload)}\n\n`
}

function normalizeUsage(value: unknown) {
  if (!value || typeof value !== 'object') {
    return undefined
  }

  const record = value as Record<string, unknown>
  const inputTokens = typeof record.input_tokens === 'number'
    ? record.input_tokens
    : typeof record.prompt_tokens === 'number'
      ? record.prompt_tokens
      : 0
  const outputTokens = typeof record.output_tokens === 'number'
    ? record.output_tokens
    : typeof record.completion_tokens === 'number'
      ? record.completion_tokens
      : 0

  return {
    prompt_tokens: inputTokens,
    completion_tokens: outputTokens,
    total_tokens: typeof record.total_tokens === 'number'
      ? record.total_tokens
      : inputTokens + outputTokens,
  }
}

function getOrCreateToolCallState(
  toolCalls: Map<string, OpenAISubscriptionToolCallState>,
  params: {
    itemId?: string
    callId?: string
    name?: string
  },
): OpenAISubscriptionToolCallState | undefined {
  const key = params.itemId || params.callId
  if (!key) {
    return undefined
  }

  const existing = toolCalls.get(key)
  if (existing) {
    if (params.name) {
      existing.name = params.name
    }
    return existing
  }

  const nextName = params.name?.trim()
  if (!nextName) {
    return undefined
  }

  const created = {
    id: params.callId || params.itemId || key,
    index: toolCalls.size,
    name: nextName,
    started: false,
  }
  toolCalls.set(key, created)
  return created
}

function mapCodexEventToChatCompletionChunk(
  event: Record<string, unknown>,
  toolCalls: Map<string, OpenAISubscriptionToolCallState>,
): OpenAISubscriptionChatCompletionChunk | '[DONE]' | undefined {
  const eventType = typeof event.type === 'string' ? event.type : undefined
  if (!eventType) {
    return undefined
  }

  if (eventType === 'error') {
    return {
      choices: [{
        delta: {
          refusal: typeof event.message === 'string' ? event.message : JSON.stringify(event),
        },
        finish_reason: 'stop',
      }],
    }
  }

  if (eventType === 'response.output_text.delta' && typeof event.delta === 'string' && event.delta) {
    return {
      choices: [{
        delta: {
          content: event.delta,
        },
      }],
    }
  }

  if (eventType === 'response.function_call_arguments.delta' && typeof event.delta === 'string') {
    const toolCall = getOrCreateToolCallState(toolCalls, {
      itemId: typeof event.item_id === 'string' ? event.item_id : undefined,
      callId: typeof event.call_id === 'string' ? event.call_id : undefined,
      name: typeof event.name === 'string' ? event.name : undefined,
    })
    if (!toolCall) {
      return undefined
    }
    toolCall.started = true

    return {
      choices: [{
        delta: {
          tool_calls: [{
            index: toolCall.index,
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: event.delta,
            },
          }],
        },
      }],
    }
  }

  if (eventType === 'response.function_call_arguments.done') {
    const toolCall = getOrCreateToolCallState(toolCalls, {
      itemId: typeof event.item_id === 'string' ? event.item_id : undefined,
      callId: typeof event.call_id === 'string' ? event.call_id : undefined,
      name: typeof event.name === 'string' ? event.name : undefined,
    })
    const argumentsText = typeof event.arguments === 'string' ? event.arguments : ''
    if (!toolCall || toolCall.started || !argumentsText) {
      return undefined
    }
    toolCall.started = true

    return {
      choices: [{
        delta: {
          tool_calls: [{
            index: toolCall.index,
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: argumentsText,
            },
          }],
        },
      }],
    }
  }

  if (eventType === 'response.output_item.added' || eventType === 'response.output_item.done') {
    const item = event.item
    if (!item || typeof item !== 'object') {
      return undefined
    }

    const itemRecord = item as Record<string, unknown>
    if (itemRecord.type !== 'function_call') {
      return undefined
    }

    const toolCall = getOrCreateToolCallState(toolCalls, {
      itemId: typeof itemRecord.id === 'string' ? itemRecord.id : undefined,
      callId: typeof itemRecord.call_id === 'string' ? itemRecord.call_id : undefined,
      name: typeof itemRecord.name === 'string' ? itemRecord.name : undefined,
    })
    if (!toolCall) {
      return undefined
    }

    if (eventType === 'response.output_item.added') {
      return undefined
    }

    const argumentsText = typeof itemRecord.arguments === 'string' ? itemRecord.arguments : ''
    if (toolCall.started || !argumentsText) {
      return undefined
    }
    toolCall.started = true

    return {
      choices: [{
        delta: {
          tool_calls: [{
            index: toolCall.index,
            id: toolCall.id,
            type: 'function',
            function: {
              name: toolCall.name,
              arguments: argumentsText,
            },
          }],
        },
      }],
    }
  }

  if (eventType === 'response.completed') {
    const response = event.response
    const usage = response && typeof response === 'object'
      ? normalizeUsage((response as Record<string, unknown>).usage)
      : undefined

    return {
      choices: [{
        delta: {},
        finish_reason: 'stop',
      }],
      ...(usage ? { usage } : {}),
    }
  }

  return undefined
}

// NOTICE: `@xsai/stream-text` currently parses Chat Completions SSE chunks,
// while the ChatGPT subscription Codex endpoint emits Responses API events.
// We normalize the stream in the Electron main process so the renderer can
// keep using the existing xsAI provider path unchanged.
export function transformCodexResponseToChatCompletionsSSE(body: string): string {
  const toolCalls = new Map<string, OpenAISubscriptionToolCallState>()
  const outputLines: string[] = []

  for (const rawEvent of parseSSEEvents(body)) {
    if (rawEvent.data === '[DONE]') {
      outputLines.push(toSSEDataLine('[DONE]'))
      continue
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawEvent.data) as Record<string, unknown>
    }
    catch {
      continue
    }

    const normalizedChunk = mapCodexEventToChatCompletionChunk(parsed, toolCalls)
    if (!normalizedChunk) {
      continue
    }

    outputLines.push(toSSEDataLine(normalizedChunk))
    if (parsed.type === 'response.completed') {
      outputLines.push(toSSEDataLine('[DONE]'))
    }
  }

  return outputLines.join('')
}

export function transformCodexResponseToChatCompletionsJson(body: string, model: string): Record<string, unknown> {
  const toolCalls = new Map<string, {
    arguments: string
    id: string
    name: string
  }>()
  let content = ''
  let usage: ReturnType<typeof normalizeUsage> | undefined

  for (const rawEvent of parseSSEEvents(body)) {
    if (rawEvent.data === '[DONE]') {
      continue
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(rawEvent.data) as Record<string, unknown>
    }
    catch {
      continue
    }

    const eventType = typeof parsed.type === 'string' ? parsed.type : ''
    if (eventType === 'error') {
      throw new Error(typeof parsed.message === 'string' ? parsed.message : JSON.stringify(parsed))
    }

    if (eventType === 'response.output_text.delta' && typeof parsed.delta === 'string') {
      content += parsed.delta
      continue
    }

    if (eventType === 'response.function_call_arguments.delta' && typeof parsed.delta === 'string') {
      const key = typeof parsed.item_id === 'string'
        ? parsed.item_id
        : typeof parsed.call_id === 'string'
          ? parsed.call_id
          : undefined
      if (!key) {
        continue
      }

      const existing = toolCalls.get(key)
      toolCalls.set(key, {
        arguments: `${existing?.arguments ?? ''}${parsed.delta}`,
        id: typeof parsed.call_id === 'string' ? parsed.call_id : existing?.id ?? key,
        name: typeof parsed.name === 'string' ? parsed.name : existing?.name ?? 'tool_call',
      })
      continue
    }

    if (eventType === 'response.function_call_arguments.done') {
      const key = typeof parsed.item_id === 'string'
        ? parsed.item_id
        : typeof parsed.call_id === 'string'
          ? parsed.call_id
          : undefined
      if (!key) {
        continue
      }

      toolCalls.set(key, {
        arguments: typeof parsed.arguments === 'string' ? parsed.arguments : toolCalls.get(key)?.arguments ?? '',
        id: typeof parsed.call_id === 'string' ? parsed.call_id : toolCalls.get(key)?.id ?? key,
        name: typeof parsed.name === 'string' ? parsed.name : toolCalls.get(key)?.name ?? 'tool_call',
      })
      continue
    }

    if (eventType === 'response.output_item.done') {
      const item = parsed.item
      if (!item || typeof item !== 'object') {
        continue
      }

      const record = item as Record<string, unknown>
      if (record.type !== 'function_call') {
        continue
      }

      const key = typeof record.id === 'string'
        ? record.id
        : typeof record.call_id === 'string'
          ? record.call_id
          : undefined
      if (!key) {
        continue
      }

      toolCalls.set(key, {
        arguments: typeof record.arguments === 'string' ? record.arguments : toolCalls.get(key)?.arguments ?? '',
        id: typeof record.call_id === 'string' ? record.call_id : toolCalls.get(key)?.id ?? key,
        name: typeof record.name === 'string' ? record.name : toolCalls.get(key)?.name ?? 'tool_call',
      })
      continue
    }

    if (eventType === 'response.completed') {
      const response = parsed.response
      usage = response && typeof response === 'object'
        ? normalizeUsage((response as Record<string, unknown>).usage)
        : undefined
    }
  }

  const finalizedToolCalls = Array.from(toolCalls.values()).map(toolCall => ({
    id: toolCall.id,
    type: 'function',
    function: {
      name: toolCall.name,
      arguments: toolCall.arguments,
    },
  }))

  return {
    id: 'chatcmpl-openai-subscription',
    object: 'chat.completion',
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{
      index: 0,
      message: {
        role: 'assistant',
        content: content || '',
        ...(finalizedToolCalls.length > 0 ? { tool_calls: finalizedToolCalls } : {}),
      },
      finish_reason: finalizedToolCalls.length > 0 ? 'tool_calls' : 'stop',
    }],
    ...(usage ? { usage } : {}),
  }
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
