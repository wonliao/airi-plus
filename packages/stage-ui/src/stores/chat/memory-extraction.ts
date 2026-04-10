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

function looksLikeQuestion(value: string) {
  const trimmed = value.trim()
  if (!trimmed) {
    return false
  }

  if (/[？?]\s*$/u.test(trimmed)) {
    return true
  }

  return /^(what|who|where|when|why|how|is|are|do|does|did|can|could|would|should|我的|我最喜歡的.+是什麼|我叫什麼|我住在哪|你記得)/iu.test(trimmed)
}

function isUsableExtractionCandidate(candidate: ShortTermMemoryExtractionCandidate) {
  if (!candidate.stable) {
    return false
  }

  if (candidate.category.length === 0 || candidate.fact.length === 0 || candidate.captureText.length === 0) {
    return false
  }

  // NOTICE: The extraction LLM can occasionally echo the user's question back as a
  // "memory" candidate after a delete/forget flow. Guarding against question-like
  // facts/capture text keeps follow-up queries from being stored as new memories.
  return !looksLikeQuestion(candidate.fact) && !looksLikeQuestion(candidate.captureText)
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
          action: record.action === 'forget' ? 'forget' : 'remember',
          category: typeof record.category === 'string' ? record.category.trim() : '',
          confidence: typeof record.confidence === 'number' ? record.confidence : 0,
          fact: typeof record.fact === 'string' ? record.fact.trim() : '',
          captureText: typeof record.captureText === 'string' ? record.captureText.trim() : '',
          stable: record.stable === true,
        } satisfies ShortTermMemoryExtractionCandidate
      })
      .filter(isUsableExtractionCandidate)
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
    '- "action": either "remember" or "forget"',
    '- "category": a stable label like "identity.name" or "preference.favorite-idol"',
    '- "fact": a concise normalized fact',
    '- "captureText": a short normalized English memory sentence, such as "my name is Ben" or "my favorite idol is BLACKPINK"; when action is "forget", still provide the normalized memory text to remove',
    '- "confidence": a number between 0 and 1',
    '- "stable": true only when this should be remembered',
    'Use action="forget" when the user explicitly asks to forget, remove, delete, or no longer remember a personal fact or preference.',
    'When action="forget", "fact" should describe the memory to remove, not the forgetting request itself.',
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
  existingMemories: string[]
  messages: Array<{ role: 'assistant' | 'user', content: string }>
  model: string
  provider: ChatProvider
}) {
  try {
    const providerConfig = params.provider.chat(params.model)
    const response = await generateText({
      ...providerConfig,
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

export const __memoryExtractionTestUtils = {
  parseExtractionResponse,
}
