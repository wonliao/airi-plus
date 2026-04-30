import type { Database } from '../../libs/db'
import type { HonoEnv } from '../../types/hono'

import { Buffer } from 'node:buffer'

import { Hono } from 'hono'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { createOpenAISubscriptionRoutes } from '.'
import { mockDB } from '../../libs/mock-db'
import { createOpenAISubscriptionAccountService } from '../../services/openai-subscription'
import { ApiError } from '../../utils/error'

import * as schema from '../../schemas'

class FakeRedis {
  values = new Map<string, string>()

  async get(key: string) {
    return this.values.get(key) ?? null
  }

  async set(key: string, value: string) {
    this.values.set(key, value)
    return 'OK'
  }

  async del(key: string) {
    return this.values.delete(key) ? 1 : 0
  }
}

const testUser = { id: 'user-1', name: 'Test User', email: 'test@example.com' }
const encryptionKey = Buffer.alloc(32, 9).toString('base64')
const originalFetch = globalThis.fetch

function encodeJwt(payload: Record<string, unknown>) {
  const encode = (value: unknown) => Buffer.from(JSON.stringify(value)).toString('base64url')
  return `${encode({ alg: 'none' })}.${encode(payload)}.signature`
}

function createTestApp(input: {
  db: Database
  encryptionKey?: string
  redis?: FakeRedis
}) {
  const redis = input.redis ?? new FakeRedis()
  const accountService = createOpenAISubscriptionAccountService(input.db, input.encryptionKey)
  const app = new Hono<HonoEnv>()

  app.onError((err, c) => {
    if (err instanceof ApiError) {
      return c.json({
        error: err.errorCode,
        message: err.message,
        details: err.details,
      }, err.statusCode)
    }
    return c.json({ error: 'Internal Server Error', message: err.message }, 500)
  })

  app.use('*', async (c, next) => {
    const user = (c.env as any)?.user
    if (user) {
      c.set('user', user)
    }
    await next()
  })

  app.route('/api/v1/openai-subscription', createOpenAISubscriptionRoutes({
    accountService,
    env: { API_SERVER_URL: 'http://localhost:3000' } as any,
    redis: redis as any,
  }))

  return { app, accountService, redis }
}

describe('openAI subscription routes', () => {
  let db: Database

  beforeEach(async () => {
    db = await mockDB(schema)
    await db.insert(schema.user).values(testUser)
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    vi.restoreAllMocks()
  })

  it('requires authentication', async () => {
    const { app } = createTestApp({ db, encryptionKey })

    const res = await app.request('/api/v1/openai-subscription/status')

    expect(res.status).toBe(401)
  })

  it('returns 503 for oauth start when token encryption is not configured', async () => {
    const { app } = createTestApp({ db })

    const res = await app.fetch(new Request('http://localhost/api/v1/openai-subscription/oauth/start', {
      method: 'POST',
    }), { user: testUser } as any)

    expect(res.status).toBe(503)
    expect(await res.json()).toMatchObject({
      error: 'OPENAI_SUBSCRIPTION_TOKEN_ENCRYPTION_KEY_MISSING',
    })
  })

  it('starts oauth and stores state in redis for ten minutes', async () => {
    const redis = new FakeRedis()
    const { app } = createTestApp({ db, encryptionKey, redis })

    const res = await app.fetch(new Request('http://localhost/api/v1/openai-subscription/oauth/start', {
      method: 'POST',
    }), { user: testUser } as any)

    expect(res.status).toBe(200)
    const body = await res.json() as { authorizationUrl: string, state: string }
    expect(body.authorizationUrl).toContain('https://auth.openai.com/oauth/authorize')
    expect(body.authorizationUrl).toContain(`state=${body.state}`)
    expect(redis.values.get(`openai-subscription:oauth-state:${body.state}`)).toContain('"userId":"user-1"')
  })

  it('starts oauth for a local OpenAI subscription session', async () => {
    const redis = new FakeRedis()
    const { app } = createTestApp({ db, encryptionKey, redis })

    const res = await app.fetch(new Request('http://localhost/api/v1/openai-subscription/oauth/start', {
      method: 'POST',
      headers: {
        'X-OpenAI-Subscription-Session': 'local-session-123456',
      },
    }))

    expect(res.status).toBe(200)
    const body = await res.json() as { authorizationUrl: string, state: string }
    expect(body.authorizationUrl).toContain('https://auth.openai.com/oauth/authorize')
    expect(body.authorizationUrl).toContain('redirect_uri=http%3A%2F%2Flocalhost%3A1455%2Fauth%2Fcallback')
    expect(redis.values.get(`openai-subscription:oauth-state:${body.state}`)).toContain('"userId":"openai-subscription-session:local-session-123456"')
  })

  it('returns local subscription status by session header', async () => {
    const { app } = createTestApp({ db, encryptionKey })

    const res = await app.fetch(new Request('http://localhost/api/v1/openai-subscription/status', {
      headers: {
        'X-OpenAI-Subscription-Session': 'local-session-123456',
      },
    }))

    expect(res.status).toBe(200)
    expect(await res.json()).toMatchObject({ connected: false })
  })

  it('handles oauth callback and stores encrypted tokens', async () => {
    const redis = new FakeRedis()
    redis.values.set('openai-subscription:oauth-state:state-1', JSON.stringify({
      userId: 'user-1',
      codeVerifier: 'verifier-1',
      redirectUri: 'http://localhost:3000/api/v1/openai-subscription/oauth/callback',
      returnTo: 'http://localhost:5173/settings/providers/chat/openai-subscription',
    }))

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: encodeJwt({ chatgpt_account_id: 'acct-1' }),
      refresh_token: 'refresh-token',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const { app, accountService } = createTestApp({ db, encryptionKey, redis })

    const res = await app.fetch(
      new Request('http://localhost/api/v1/openai-subscription/oauth/callback?code=code-1&state=state-1'),
      { user: testUser } as any,
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:5173/settings/providers/chat/openai-subscription?openaiSubscription=connected')
    const stored = await accountService.getStoredAccountByUserId('user-1')
    expect(stored?.accessTokenCiphertext).toMatch(/^v1:/)
    expect(stored?.accessTokenCiphertext).not.toContain('acct-1')
    expect(redis.values.has('openai-subscription:oauth-state:state-1')).toBe(false)
  })

  it('handles local session oauth callback without app authentication', async () => {
    const redis = new FakeRedis()
    redis.values.set('openai-subscription:oauth-state:state-local', JSON.stringify({
      userId: 'openai-subscription-session:local-session-123456',
      codeVerifier: 'verifier-local',
      redirectUri: 'http://localhost:1455/auth/callback',
      returnTo: 'http://localhost:5173/settings/providers/chat/openai-subscription',
    }))

    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      access_token: encodeJwt({ chatgpt_account_id: 'acct-local' }),
      refresh_token: 'refresh-token',
      expires_in: 3600,
    }), {
      status: 200,
      headers: { 'Content-Type': 'application/json' },
    }))

    const { app, accountService } = createTestApp({ db, encryptionKey, redis })
    await accountService.ensureLocalSubscriptionUser('openai-subscription-session:local-session-123456')

    const res = await app.fetch(
      new Request('http://localhost/api/v1/openai-subscription/oauth/callback?code=code-local&state=state-local'),
    )

    expect(res.status).toBe(302)
    expect(res.headers.get('location')).toBe('http://localhost:5173/settings/providers/chat/openai-subscription?openaiSubscription=connected')
    const stored = await accountService.getStoredAccountByUserId('openai-subscription-session:local-session-123456')
    expect(stored?.accessTokenCiphertext).toMatch(/^v1:/)
    expect(redis.values.has('openai-subscription:oauth-state:state-local')).toBe(false)
  })

  it('proxies requests through the stored subscription account', async () => {
    const { app, accountService } = createTestApp({ db, encryptionKey })
    await accountService.upsertAccountForUser({
      userId: 'user-1',
      chatgptAccountId: 'acct-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    })

    globalThis.fetch = vi.fn(async () => new Response([
      'data: {"type":"response.output_text.delta","delta":"hello"}',
      '',
      'data: {"type":"response.completed","response":{"usage":{"input_tokens":1,"output_tokens":1}}}',
      '',
    ].join('\n'), {
      status: 200,
      headers: { 'Content-Type': 'text/event-stream' },
    }))

    const res = await app.fetch(new Request('http://localhost/api/v1/openai-subscription/proxy', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        model: 'gpt-5.1-codex',
        messages: [{ role: 'user', content: 'hi' }],
      }),
    }), { user: testUser } as any)

    expect(res.status).toBe(200)
    expect(await res.text()).toContain('"content":"hello"')
    expect(globalThis.fetch).toHaveBeenCalledWith(
      'https://chatgpt.com/backend-api/codex/responses',
      expect.objectContaining({
        method: 'POST',
        headers: expect.objectContaining({
          'Authorization': 'Bearer access-token',
          'ChatGPT-Account-Id': 'acct-1',
        }),
      }),
    )
  })

  it('logs out by deleting the stored account', async () => {
    const { app, accountService } = createTestApp({ db, encryptionKey })
    await accountService.upsertAccountForUser({
      userId: 'user-1',
      accessToken: 'access-token',
      refreshToken: 'refresh-token',
      accessTokenExpiresAt: new Date(Date.now() + 3600_000),
    })

    const res = await app.fetch(new Request('http://localhost/api/v1/openai-subscription/logout', {
      method: 'POST',
    }), { user: testUser } as any)

    expect(res.status).toBe(204)
    expect(await accountService.getStoredAccountByUserId('user-1')).toBeUndefined()
  })
})
