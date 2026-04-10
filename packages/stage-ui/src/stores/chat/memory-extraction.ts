import type { ChatProvider } from '@xsai-ext/providers/utils'

import type { ShortTermMemoryExtractionCandidate } from './memory-reconcile'

import { errorMessageFrom } from '@moeru/std'
import { generateText } from '@xsai/generate-text'
import { message } from '@xsai/utils-chat'

function stripMarkdownCodeFence(text: string) {
  return text
    .replace(/^```(?:json)?\s*/iu, '')
    .replace(/\s*```$/u, '')
    .trim()
}

function parseExtractionResponse(text: string): ShortTermMemoryExtractionCandidate[] {
  const cleaned = stripMarkdownCodeFence(text)

  try {
    const parsed = JSON.parse(cleaned) as unknown
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return []
    }

    const record = parsed as { candidates?: unknown }
    if (!Array.isArray(record.candidates)) {
      return []
    }

    return record.candidates
      .filter(candidate => candidate && typeof candidate === 'object' && !Array.isArray(candidate))
      .map((candidate) => {
        const record = candidate as Record<string, unknown>
        return {
          category: typeof record.category === 'string' ? record.category.trim() : '',
          confidence: typeof record.confidence === 'number' ? record.confidence : 0,
          fact: typeof record.fact === 'string' ? record.fact.trim() : '',
          captureText: typeof record.captureText === 'string' ? record.captureText.trim() : '',
          stable: record.stable === true,
        } satisfies ShortTermMemoryExtractionCandidate
      })
      .filter(candidate =>
        candidate.stable
        && candidate.category.length > 0
        && candidate.fact.length > 0
        && candidate.captureText.length > 0,
      )
  }
  catch {
    return []
  }
}

function buildExtractionPrompt(params: {
  existingMemories: string[]
  messages: Array<{ role: 'assistant' | 'user', content: string }>
}) {
  const conversationText = params.messages
    .map(message => `[${message.role}] ${message.content}`)
    .join('\n')

  const existingMemories = params.existingMemories.length > 0
    ? params.existingMemories.map(memory => `- ${memory}`).join('\n')
    : '- none'

  return [
    'Extract stable short-term memories from the conversation turn.',
    'Only keep personal facts or preferences that are likely to remain useful in later turns.',
    'Ignore world knowledge, compliments, generic banter, and questions that do not introduce a stable fact.',
    'Return strict JSON with the shape {"candidates":[...]} and no markdown.',
    'Each candidate must contain:',
    '- "category": a stable label like "identity.name" or "preference.favorite-idol"',
    '- "fact": a concise normalized fact',
    '- "captureText": a short first-person English sentence compatible with memory capture, such as "my name is Ben" or "my favorite idol is BLACKPINK"',
    '- "confidence": a number between 0 and 1',
    '- "stable": true only when this should be remembered',
    'Prefer up to 3 candidates.',
    'If nothing should be remembered, return {"candidates":[]}.',
    '',
    'Existing memories:',
    existingMemories,
    '',
    'Conversation turn:',
    conversationText,
  ].join('\n')
}

export async function extractShortTermMemoryCandidatesWithLlm(params: {
  apiKeyOverride?: string
  existingMemories: string[]
  messages: Array<{ role: 'assistant' | 'user', content: string }>
  model: string
  provider: ChatProvider
}) {
  try {
    const providerConfig = params.provider.chat(params.model)
    const response = await generateText({
      ...providerConfig,
      ...(params.apiKeyOverride?.trim() ? { apiKey: params.apiKeyOverride.trim() } : {}),
      model: params.model,
      messages: message.messages(
        message.system('You are a memory extraction engine.'),
        message.user(buildExtractionPrompt({
          existingMemories: params.existingMemories,
          messages: params.messages,
        })),
      ),
      max_tokens: 400,
      temperature: 0,
    } as Parameters<typeof generateText>[0])

    return {
      candidates: parseExtractionResponse(response.text ?? ''),
      rawText: response.text ?? '',
    }
  }
  catch (error) {
    return {
      candidates: [],
      error: errorMessageFrom(error) ?? 'Unknown extraction error.',
      rawText: '',
    }
  }
}
