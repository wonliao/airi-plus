import { describe, expect, it } from 'vitest'

import {
  buildMem0CaptureRequestBody,
  buildMem0ListQuery,
  buildMem0SearchRequestBody,
  createMem0Headers,
  normalizeMem0BaseUrl,
  resolveMem0RemotePath,
} from './memory-short-term'

describe('mem0 remote helpers', () => {
  it('normalizes the configured base URL', () => {
    expect(normalizeMem0BaseUrl('http://127.0.0.1:8000/')).toBe('http://127.0.0.1:8000')
    expect(normalizeMem0BaseUrl('')).toBe('http://127.0.0.1:8000')
  })

  it('builds OSS headers and paths', () => {
    expect(resolveMem0RemotePath('memories')).toBe('memories')
    expect(resolveMem0RemotePath('search')).toBe('search')
    expect(createMem0Headers('oss-key', { contentType: 'application/json' })).toEqual({
      'Accept': 'application/json',
      'Content-Type': 'application/json',
      'X-API-Key': 'oss-key',
    })
  })

  it('builds search and capture payloads from the configured scope', () => {
    expect(buildMem0SearchRequestBody({
      query: 'What do I like?',
      userId: 'alice',
      agentId: 'airi',
      runId: 'run-1',
      appId: 'desktop',
      topK: 5,
    })).toEqual({
      query: 'What do I like?',
      top_k: 5,
      user_id: 'alice',
      agent_id: 'airi',
      run_id: 'run-1',
      app_id: 'desktop',
    })

    expect(buildMem0CaptureRequestBody({
      userId: 'alice',
      agentId: 'airi',
      runId: 'run-1',
      appId: 'desktop',
      messages: [
        { role: 'user', content: 'I love mangoes.' },
        { role: 'assistant', content: 'I will remember that.' },
      ],
    })).toEqual({
      async_mode: false,
      infer: true,
      user_id: 'alice',
      agent_id: 'airi',
      run_id: 'run-1',
      app_id: 'desktop',
      messages: [
        { role: 'user', content: 'I love mangoes.' },
        { role: 'assistant', content: 'I will remember that.' },
      ],
    })
  })

  it('builds list query params for the remote API', () => {
    expect(buildMem0ListQuery({
      userId: 'alice',
      agentId: 'airi',
      runId: 'run-1',
      limit: 8,
    }).toString()).toBe('user_id=alice&agent_id=airi&run_id=run-1&limit=8')
  })
})
