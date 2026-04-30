import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStoredOpenAISubscriptionTokens,
  createOpenAISubscriptionFetch,
  extractOpenAISubscriptionAccountId,
  extractOpenAISubscriptionAccountIdFromClaims,
  fetchOpenAISubscriptionStatus,
  getStoredOpenAISubscriptionTokens,
  hasOpenAISubscriptionLogin,
  logoutOpenAISubscription,
  OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY,
  parseOpenAISubscriptionJwtClaims,
  setStoredOpenAISubscriptionTokens,
  startOpenAISubscriptionLogin,
} from './openai-subscription-auth'

const {
  getAuthTokenMock,
  isStageTamagotchiMock,
  isStageWebMock,
  proxyOpenAISubscriptionFetchOnDesktopMock,
} = vi.hoisted(() => ({
  getAuthTokenMock: vi.fn(),
  isStageTamagotchiMock: vi.fn(),
  isStageWebMock: vi.fn(),
  proxyOpenAISubscriptionFetchOnDesktopMock: vi.fn(),
}))

vi.mock('@proj-airi/stage-shared', () => ({
  isStageTamagotchi: isStageTamagotchiMock,
  isStageWeb: isStageWebMock,
}))

vi.mock('@proj-airi/stage-shared/openai-subscription', () => ({
  proxyOpenAISubscriptionFetchOnDesktop: proxyOpenAISubscriptionFetchOnDesktopMock,
}))

vi.mock('./auth', () => ({
  getAuthToken: getAuthTokenMock,
}))

vi.mock('./server', () => ({
  SERVER_URL: 'https://airi.test',
}))

function createTestJwt(payload: object) {
  const header = Buffer.from(JSON.stringify({ alg: 'none' })).toString('base64url')
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url')
  return `${header}.${body}.sig`
}

function createLocalStorageMock(): Storage {
  const storage = new Map<string, string>()

  return {
    get length() {
      return storage.size
    },
    clear() {
      storage.clear()
    },
    getItem(key: string) {
      return storage.has(key) ? storage.get(key)! : null
    },
    key(index: number) {
      return Array.from(storage.keys())[index] ?? null
    },
    removeItem(key: string) {
      storage.delete(key)
    },
    setItem(key: string, value: string) {
      storage.set(key, value)
    },
  }
}

describe('openai subscription auth helpers', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.stubGlobal('localStorage', createLocalStorageMock())
    vi.stubGlobal('location', undefined)
    vi.stubGlobal('fetch', vi.fn())
    localStorage.clear()
    getAuthTokenMock.mockReturnValue('airi-token')
    isStageTamagotchiMock.mockReturnValue(true)
    isStageWebMock.mockReturnValue(false)
  })

  it('parses jwt claims', () => {
    const token = createTestJwt({ chatgpt_account_id: 'acc-123' })
    expect(parseOpenAISubscriptionJwtClaims(token)).toEqual({ chatgpt_account_id: 'acc-123' })
  })

  it('extracts account id from nested claims', () => {
    expect(extractOpenAISubscriptionAccountIdFromClaims({
      'https://api.openai.com/auth': { chatgpt_account_id: 'acc-nested' },
    })).toBe('acc-nested')
  })

  it('extracts account id from id_token first', () => {
    expect(extractOpenAISubscriptionAccountId({
      id_token: createTestJwt({ chatgpt_account_id: 'from-id-token' }),
      access_token: createTestJwt({ chatgpt_account_id: 'from-access-token' }),
    })).toBe('from-id-token')
  })

  it('stores and clears tokens', () => {
    setStoredOpenAISubscriptionTokens({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
      accountId: 'acc-123',
    })

    expect(getStoredOpenAISubscriptionTokens()).toEqual({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
      accountId: 'acc-123',
    })

    clearStoredOpenAISubscriptionTokens()
    expect(localStorage.getItem(OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY)).toBeNull()
  })

  it('proxies desktop fetch through Electron and preserves refreshed tokens', async () => {
    setStoredOpenAISubscriptionTokens({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
    })

    proxyOpenAISubscriptionFetchOnDesktopMock.mockResolvedValue({
      response: {
        status: 200,
        statusText: 'OK',
        headers: [['content-type', 'application/json']],
        body: '{"ok":true}',
      },
      tokens: {
        accessToken: 'access-next',
        refreshToken: 'refresh-next',
        expiresAt: 456,
      },
    })

    const response = await createOpenAISubscriptionFetch()('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'X-Test': 'yes' },
      body: '{"model":"gpt-5.4"}',
    })

    expect(await response.json()).toEqual({ ok: true })
    expect(proxyOpenAISubscriptionFetchOnDesktopMock).toHaveBeenCalledWith({
      request: {
        url: 'https://api.openai.com/v1/responses',
        method: 'POST',
        headers: expect.arrayContaining([['x-test', 'yes']]),
        body: '{"model":"gpt-5.4"}',
      },
      tokens: {
        accessToken: 'access',
        refreshToken: 'refresh',
        expiresAt: 123,
      },
    })
    expect(getStoredOpenAISubscriptionTokens()?.refreshToken).toBe('refresh-next')
  })

  it('proxies web fetch through the server using AIRI auth without storing OpenAI tokens', async () => {
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    const response = await createOpenAISubscriptionFetch()('https://api.openai.com/v1/responses', {
      method: 'POST',
      headers: { 'X-Test': 'yes' },
      body: '{"model":"gpt-5.4"}',
    })

    expect(await response.json()).toEqual({ ok: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://airi.test/api/v1/openai-subscription/proxy')
    expect(init?.method).toBe('POST')
    expect(init?.credentials).toBe('omit')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer airi-token')
    expect(JSON.parse(init?.body as string)).toEqual({ model: 'gpt-5.4' })
    expect(localStorage.getItem(OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY)).toBeNull()
  })

  it('proxies web fetch through a subscription bridge without AIRI auth', async () => {
    getAuthTokenMock.mockReturnValue(null)
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response('{"ok":true}', { status: 200 }))

    const response = await createOpenAISubscriptionFetch()('https://api.openai.com/v1/responses', {
      method: 'POST',
      body: '{"model":"gpt-5.4"}',
    })

    expect(await response.json()).toEqual({ ok: true })
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.get('X-OpenAI-Subscription-Session')).toMatch(/^[\w-]{16,128}$/)
  })

  it('fetches web subscription status with AIRI auth', async () => {
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({
      connected: true,
      chatgptAccountId: 'acc-123',
      accessTokenExpiresAt: '2026-01-01T00:00:00.000Z',
    }), { status: 200 }))

    await expect(fetchOpenAISubscriptionStatus()).resolves.toEqual({
      connected: true,
      accountId: 'acc-123',
      expiresAt: Date.parse('2026-01-01T00:00:00.000Z'),
    })
    const [url, init] = fetchMock.mock.calls[0]
    expect(String(url)).toBe('https://airi.test/api/v1/openai-subscription/status')
    expect(init?.method).toBe('GET')
    expect(new Headers(init?.headers).get('Authorization')).toBe('Bearer airi-token')
  })

  it('fetches web subscription status without AIRI auth', async () => {
    getAuthTokenMock.mockReturnValue(null)
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ connected: false }), { status: 200 }))

    await expect(fetchOpenAISubscriptionStatus()).resolves.toEqual({ connected: false })
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.get('X-OpenAI-Subscription-Session')).toMatch(/^[\w-]{16,128}$/)
  })

  it('starts and logs out of web subscription sessions through the server', async () => {
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)
    fetchMock
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://auth.openai.com/oauth' }), { status: 200 }))
      .mockResolvedValueOnce(new Response(null, { status: 204 }))

    await expect(startOpenAISubscriptionLogin()).resolves.toBe('https://auth.openai.com/oauth')
    await expect(logoutOpenAISubscription()).resolves.toBeUndefined()

    expect(String(fetchMock.mock.calls[0][0])).toBe('https://airi.test/api/v1/openai-subscription/oauth/start')
    expect(fetchMock.mock.calls[0][1]?.method).toBe('POST')
    expect(String(fetchMock.mock.calls[1][0])).toBe('https://airi.test/api/v1/openai-subscription/logout')
    expect(fetchMock.mock.calls[1][1]?.method).toBe('POST')
  })

  it('starts web OpenAI subscription login without AIRI auth', async () => {
    getAuthTokenMock.mockReturnValue(null)
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authorizationUrl: 'https://auth.openai.com/oauth' }), { status: 200 }))

    await expect(startOpenAISubscriptionLogin()).resolves.toBe('https://auth.openai.com/oauth')
    const [, init] = fetchMock.mock.calls[0]
    const headers = new Headers(init?.headers)
    expect(headers.has('Authorization')).toBe(false)
    expect(headers.get('X-OpenAI-Subscription-Session')).toMatch(/^[\w-]{16,128}$/)
  })

  it('uses the local OpenAI subscription bridge for localhost stage web', async () => {
    getAuthTokenMock.mockReturnValue(null)
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    vi.stubGlobal('location', {
      hostname: 'localhost',
      href: 'http://localhost:5173/settings/providers/chat/openai-subscription',
    })
    const fetchMock = vi.mocked(fetch)
    fetchMock.mockResolvedValue(new Response(JSON.stringify({ authorizationUrl: 'https://auth.openai.com/oauth' }), { status: 200 }))

    await expect(startOpenAISubscriptionLogin()).resolves.toBe('https://auth.openai.com/oauth')
    expect(String(fetchMock.mock.calls[0][0])).toBe('http://localhost:6112/api/v1/openai-subscription/oauth/start')
    expect(new Headers(fetchMock.mock.calls[0][1]?.headers).get('X-OpenAI-Subscription-Session')).toMatch(/^[\w-]{16,128}$/)
  })

  it('reports when the local OpenAI subscription bridge is not running', async () => {
    getAuthTokenMock.mockReturnValue(null)
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    vi.stubGlobal('location', {
      hostname: 'localhost',
      href: 'http://localhost:5173/settings/providers/chat/openai-subscription',
    })
    vi.mocked(fetch).mockRejectedValue(new TypeError('Failed to fetch'))

    await expect(startOpenAISubscriptionLogin()).rejects.toThrow('OpenAI subscription local bridge is not running at http://localhost:6112')
  })

  it('checks login through desktop storage or web server status by runtime', async () => {
    setStoredOpenAISubscriptionTokens({
      accessToken: 'access',
      refreshToken: 'refresh',
      expiresAt: 123,
    })
    await expect(hasOpenAISubscriptionLogin()).resolves.toBe(true)

    clearStoredOpenAISubscriptionTokens()
    isStageTamagotchiMock.mockReturnValue(false)
    isStageWebMock.mockReturnValue(true)
    vi.mocked(fetch).mockResolvedValue(new Response(JSON.stringify({ connected: true }), { status: 200 }))

    await expect(hasOpenAISubscriptionLogin()).resolves.toBe(true)
  })
})
