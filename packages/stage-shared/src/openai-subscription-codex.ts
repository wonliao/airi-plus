const BASE64_URL_DASH_PATTERN = /-/g
const BASE64_URL_UNDERSCORE_PATTERN = /_/g

export interface OpenAISubscriptionJwtClaims {
  'chatgpt_account_id'?: string
  'organizations'?: Array<{ id: string }>
  'https://api.openai.com/auth'?: {
    chatgpt_account_id?: string
  }
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

export function extractOpenAISubscriptionAccountId(tokens: { access_token: string, id_token?: string }): string | undefined {
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

const OPENAI_SUBSCRIPTION_FALLBACK_INSTRUCTIONS = 'You are AIRI, a helpful AI assistant.'
const WINDOWS_NEWLINE_PATTERN = /\r\n/g

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
