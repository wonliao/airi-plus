import { Buffer } from 'node:buffer'

const CODEX_HELPER_MODULE = '@proj-airi/stage-shared/openai-subscription-codex'
const BASE64_URL_DASH_PATTERN = /-/g
const BASE64_URL_UNDERSCORE_PATTERN = /_/g
const WINDOWS_NEWLINE_PATTERN = /\r\n/g
const FALLBACK_INSTRUCTIONS = 'You are AIRI, a helpful AI assistant.'

export interface OpenAISubscriptionCodexHelpers {
  extractOpenAISubscriptionAccountId: (tokens: { access_token: string, id_token?: string }) => string | undefined
  normalizeOpenAISubscriptionCodexBody: (body: string | undefined) => string | undefined
  transformCodexResponseToChatCompletionsSSE: (body: string) => string
}

let helpersPromise: Promise<OpenAISubscriptionCodexHelpers> | undefined

function decodeBase64Url(value: string): string {
  const normalized = value.replace(BASE64_URL_DASH_PATTERN, '+').replace(BASE64_URL_UNDERSCORE_PATTERN, '/')
  const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, '=')
  return Buffer.from(padded, 'base64').toString('utf8')
}

function parseJwtClaims(token: string): Record<string, unknown> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3)
    return undefined

  try {
    return JSON.parse(decodeBase64Url(parts[1])) as Record<string, unknown>
  }
  catch {
    return undefined
  }
}

function fallbackExtractOpenAISubscriptionAccountId(tokens: { access_token: string, id_token?: string }): string | undefined {
  const claims = (tokens.id_token ? parseJwtClaims(tokens.id_token) : undefined) ?? parseJwtClaims(tokens.access_token)
  if (!claims)
    return undefined

  if (typeof claims.chatgpt_account_id === 'string')
    return claims.chatgpt_account_id

  const authClaims = claims['https://api.openai.com/auth']
  if (authClaims && typeof authClaims === 'object' && typeof (authClaims as Record<string, unknown>).chatgpt_account_id === 'string')
    return (authClaims as Record<string, string>).chatgpt_account_id

  const organizations = claims.organizations
  if (Array.isArray(organizations)) {
    const first = organizations[0]
    if (first && typeof first === 'object' && typeof (first as Record<string, unknown>).id === 'string')
      return (first as Record<string, string>).id
  }

  return undefined
}

function extractTextFromContent(content: unknown): string {
  if (typeof content === 'string')
    return content

  if (Array.isArray(content)) {
    return content
      .map((part) => {
        if (typeof part === 'string')
          return part
        if (!part || typeof part !== 'object')
          return ''
        const record = part as Record<string, unknown>
        if (typeof record.text === 'string')
          return record.text
        if (typeof record.content === 'string')
          return record.content
        return ''
      })
      .filter(Boolean)
      .join('\n')
  }

  return ''
}

function fallbackNormalizeOpenAISubscriptionCodexBody(body: string | undefined): string | undefined {
  if (!body)
    return body

  let parsed: Record<string, unknown>
  try {
    parsed = JSON.parse(body) as Record<string, unknown>
  }
  catch {
    return body
  }

  if (Array.isArray(parsed.input))
    return JSON.stringify(parsed)

  const messages = Array.isArray(parsed.messages) ? parsed.messages : []
  const systemMessages: string[] = []
  const input = messages
    .map((message) => {
      if (!message || typeof message !== 'object')
        return undefined

      const record = message as Record<string, unknown>
      const role = typeof record.role === 'string' ? record.role : 'user'
      const content = extractTextFromContent(record.content).replace(WINDOWS_NEWLINE_PATTERN, '\n')
      if (role === 'system') {
        if (content)
          systemMessages.push(content)
        return undefined
      }

      return { role, content }
    })
    .filter((message): message is { role: string, content: string } => message != null)

  return JSON.stringify({
    model: typeof parsed.model === 'string' ? parsed.model : 'gpt-5.1-codex',
    instructions: systemMessages.join('\n\n') || FALLBACK_INSTRUCTIONS,
    input,
    stream: true,
    ...(parsed.tools != null ? { tools: parsed.tools } : {}),
    ...(parsed.tool_choice != null ? { tool_choice: parsed.tool_choice } : {}),
    ...(parsed.temperature != null ? { temperature: parsed.temperature } : {}),
    ...(parsed.max_completion_tokens != null ? { max_output_tokens: parsed.max_completion_tokens } : {}),
    ...(parsed.max_tokens != null ? { max_output_tokens: parsed.max_tokens } : {}),
  })
}

function toSSEDataLine(payload: unknown): string {
  return `data: ${typeof payload === 'string' ? payload : JSON.stringify(payload)}\n\n`
}

function fallbackTransformCodexResponseToChatCompletionsSSE(body: string): string {
  const outputLines: string[] = []
  const events = body.split('\n\n')
  for (const event of events) {
    const dataLine = event.split('\n').find(line => line.startsWith('data: '))
    if (!dataLine)
      continue

    const data = dataLine.slice(6)
    if (data === '[DONE]') {
      outputLines.push(toSSEDataLine('[DONE]'))
      continue
    }

    let parsed: Record<string, unknown>
    try {
      parsed = JSON.parse(data) as Record<string, unknown>
    }
    catch {
      continue
    }

    if (parsed.type === 'response.output_text.delta' && typeof parsed.delta === 'string') {
      outputLines.push(toSSEDataLine({
        choices: [{
          delta: { content: parsed.delta },
          finish_reason: null,
        }],
      }))
    }
    else if (parsed.type === 'response.completed') {
      outputLines.push(toSSEDataLine({
        choices: [{
          delta: {},
          finish_reason: 'stop',
        }],
      }))
      outputLines.push(toSSEDataLine('[DONE]'))
    }
  }

  return outputLines.length > 0 ? outputLines.join('') : body
}

function fallbackHelpers(): OpenAISubscriptionCodexHelpers {
  return {
    extractOpenAISubscriptionAccountId: fallbackExtractOpenAISubscriptionAccountId,
    normalizeOpenAISubscriptionCodexBody: fallbackNormalizeOpenAISubscriptionCodexBody,
    transformCodexResponseToChatCompletionsSSE: fallbackTransformCodexResponseToChatCompletionsSSE,
  }
}

export async function loadOpenAISubscriptionCodexHelpers(): Promise<OpenAISubscriptionCodexHelpers> {
  helpersPromise ??= import(CODEX_HELPER_MODULE)
    .then((mod) => {
      const loaded = mod as Partial<OpenAISubscriptionCodexHelpers>
      if (
        typeof loaded.extractOpenAISubscriptionAccountId !== 'function'
        || typeof loaded.normalizeOpenAISubscriptionCodexBody !== 'function'
        || typeof loaded.transformCodexResponseToChatCompletionsSSE !== 'function'
      ) {
        return fallbackHelpers()
      }

      return loaded as OpenAISubscriptionCodexHelpers
    })
    .catch(() => fallbackHelpers())

  return helpersPromise
}
