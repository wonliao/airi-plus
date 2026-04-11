import { describe, expect, it } from 'vitest'

import {
  mapChatMessagesToCodexInput,
  normalizeOpenAISubscriptionCodexBody,
  transformCodexResponseToChatCompletionsSSE,
} from './auth'

describe('openai subscription codex normalization', () => {
  it('maps user and assistant chat history to role-aware Responses input parts', () => {
    expect(mapChatMessagesToCodexInput([
      { role: 'system', content: 'ignored' },
      { role: 'user', content: 'hello' },
      { role: 'assistant', content: 'hi there' },
      {
        role: 'assistant',
        content: [
          {
            type: 'tool_result',
            tool_call_id: 'call_123',
            content: { ok: true },
          },
        ],
      },
    ])).toEqual([
      {
        role: 'user',
        content: [{ type: 'input_text', text: 'hello' }],
      },
      {
        role: 'assistant',
        content: [{ type: 'output_text', text: 'hi there' }],
      },
      {
        role: 'assistant',
        content: [{
          type: 'function_call_output',
          call_id: 'call_123',
          output: JSON.stringify({ ok: true }),
        }],
      },
    ])
  })

  it('normalizes messages into a codex-compatible request body', () => {
    const normalized = normalizeOpenAISubscriptionCodexBody(JSON.stringify({
      messages: [
        { role: 'system', content: 'Be brief.' },
        { role: 'user', content: 'ping' },
        { role: 'assistant', content: 'pong' },
      ],
      store: true,
      tools: [
        {
          type: 'function',
          function: {
            name: 'echo_tool',
            description: 'Echo text',
            parameters: { type: 'object', properties: {} },
            strict: true,
          },
        },
      ],
      tool_choice: {
        type: 'function',
        function: {
          name: 'echo_tool',
        },
      },
    }))

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!)).toEqual({
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'ping' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: 'pong' }],
        },
      ],
      instructions: 'Be brief.',
      store: false,
      tools: [
        {
          type: 'function',
          name: 'echo_tool',
          description: 'Echo text',
          parameters: { type: 'object', properties: {} },
          strict: true,
        },
      ],
      tool_choice: {
        type: 'function',
        name: 'echo_tool',
      },
    })
  })

  it('keeps tool calls and tool outputs codex-compatible across multi-step history', () => {
    const normalized = normalizeOpenAISubscriptionCodexBody(JSON.stringify({
      messages: [
        { role: 'system', content: 'Use tools when helpful.' },
        { role: 'user', content: 'What is the weather in Taipei?' },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool-call',
              id: 'tool-call-1',
              toolName: 'weather',
              args: { city: 'Taipei' },
            },
          ],
        },
        {
          role: 'assistant',
          content: [
            {
              type: 'tool_result',
              tool_call_id: 'tool-call-1',
              content: { forecast: 'Rainy' },
            },
          ],
        },
      ],
      tools: [
        {
          type: 'function',
          function: {
            name: 'weather',
            description: 'Look up weather',
            parameters: {
              type: 'object',
              properties: {
                city: { type: 'string' },
              },
              required: ['city'],
            },
          },
        },
      ],
      tool_choice: 'auto',
    }))

    expect(normalized).toBeTruthy()
    expect(JSON.parse(normalized!)).toEqual({
      input: [
        {
          role: 'user',
          content: [{ type: 'input_text', text: 'What is the weather in Taipei?' }],
        },
        {
          role: 'assistant',
          content: [{ type: 'output_text', text: '[object Object]' }],
        },
        {
          role: 'assistant',
          content: [{
            type: 'function_call_output',
            call_id: 'tool-call-1',
            output: JSON.stringify({ forecast: 'Rainy' }),
          }],
        },
      ],
      instructions: 'Use tools when helpful.',
      store: false,
      tools: [
        {
          type: 'function',
          name: 'weather',
          description: 'Look up weather',
          parameters: {
            type: 'object',
            properties: {
              city: { type: 'string' },
            },
            required: ['city'],
          },
        },
      ],
      tool_choice: 'auto',
    })
  })
})

describe('openai subscription codex stream transform', () => {
  it('transforms Responses SSE into chat-completions SSE chunks', () => {
    const transformed = transformCodexResponseToChatCompletionsSSE([
      'data: {"type":"response.created","response":{"error":null}}',
      '',
      'data: {"type":"response.output_text.delta","delta":"Hel"}',
      '',
      'data: {"type":"response.output_text.delta","delta":"lo"}',
      '',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":3,"output_tokens":2,"total_tokens":5}}}',
      '',
    ].join('\n'))

    expect(transformed).toContain('"content":"Hel"')
    expect(transformed).toContain('"content":"lo"')
    expect(transformed).toContain('"finish_reason":"stop"')
    expect(transformed).toContain('"usage":{"prompt_tokens":3,"completion_tokens":2,"total_tokens":5}')
    expect(transformed.trimEnd().endsWith('data: [DONE]')).toBe(true)
    expect(transformed).not.toContain('response.created')
  })

  it('emits a single tool-call stream from function call delta events', () => {
    const transformed = transformCodexResponseToChatCompletionsSSE([
      'data: {"type":"response.function_call_arguments.delta","item_id":"item_1","call_id":"call_1","name":"weather","delta":"{\\"city\\":\\"Tai"}',
      '',
      'data: {"type":"response.function_call_arguments.delta","item_id":"item_1","call_id":"call_1","name":"weather","delta":"pei\\"}"}',
      '',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1,"total_tokens":2}}}',
      '',
    ].join('\n'))

    expect(transformed).toContain('"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"weather","arguments":"{\\"city\\":\\"Tai"}}]')
    expect(transformed).toContain('"tool_calls":[{"index":0,"id":"call_1","type":"function","function":{"name":"weather","arguments":"pei\\"}"}}]')
  })

  it('falls back to a done event payload when tool calls arrive as completed output items', () => {
    const transformed = transformCodexResponseToChatCompletionsSSE([
      'data: {"type":"response.output_item.done","item":{"type":"function_call","id":"item_2","call_id":"call_2","name":"calendar_lookup","arguments":"{\\"date\\":\\"2026-04-11\\"}"}}',
      '',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":4,"output_tokens":3,"total_tokens":7}}}',
      '',
    ].join('\n'))

    expect(transformed).toContain('"tool_calls":[{"index":0,"id":"call_2","type":"function","function":{"name":"calendar_lookup","arguments":"{\\"date\\":\\"2026-04-11\\"}"}}]')
    expect(transformed).toContain('"finish_reason":"stop"')
  })
})
