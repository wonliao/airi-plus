import { describe, expect, it } from 'vitest'

import {
  extractOpenAISubscriptionAccountIdFromClaims,
  normalizeOpenAISubscriptionCodexBody,
  transformCodexResponseToChatCompletionsSSE,
} from './openai-subscription-codex'

describe('openai subscription codex helpers', () => {
  it('extracts account id from OpenAI subscription claims', () => {
    expect(extractOpenAISubscriptionAccountIdFromClaims({
      'https://api.openai.com/auth': {
        chatgpt_account_id: 'acct_123',
      },
    })).toBe('acct_123')
  })

  it('normalizes chat messages into Codex responses payload', () => {
    const normalized = normalizeOpenAISubscriptionCodexBody(JSON.stringify({
      model: 'gpt-5.4',
      messages: [
        { role: 'system', content: 'You are AIRI.' },
        { role: 'user', content: 'Hi' },
      ],
      store: true,
    }))

    expect(JSON.parse(normalized!)).toMatchObject({
      model: 'gpt-5.4',
      instructions: 'You are AIRI.',
      store: false,
      input: [{
        role: 'user',
        content: [{
          type: 'input_text',
          text: 'Hi',
        }],
      }],
    })
  })

  it('transforms Codex output text events into chat completions SSE chunks', () => {
    const transformed = transformCodexResponseToChatCompletionsSSE([
      'event: response.output_text.delta',
      'data: {"type":"response.output_text.delta","delta":"Hello"}',
      '',
      'event: response.completed',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":2}}}',
      '',
    ].join('\n'))

    expect(transformed).toContain('"content":"Hello"')
    expect(transformed).toContain('"finish_reason":"stop"')
    expect(transformed).toContain('data: [DONE]')
  })
})
