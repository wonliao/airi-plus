import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it, vi } from 'vitest'

import {
  clearStoredOpenAISubscriptionTokens,
  extractOpenAISubscriptionAccountId,
  extractOpenAISubscriptionAccountIdFromClaims,
  getStoredOpenAISubscriptionTokens,
  OPENAI_SUBSCRIPTION_AUTH_STORAGE_KEY,
  parseOpenAISubscriptionJwtClaims,
  setStoredOpenAISubscriptionTokens,
} from './openai-subscription-auth'

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
    vi.stubGlobal('localStorage', createLocalStorageMock())
    localStorage.clear()
    vi.restoreAllMocks()
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
})
