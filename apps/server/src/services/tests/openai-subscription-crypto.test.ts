import { Buffer } from 'node:buffer'

import { describe, expect, it } from 'vitest'

import {
  createOpenAISubscriptionTokenCipher,
  OpenAISubscriptionTokenEncryptionError,
} from '../openai-subscription-crypto'

describe('openAI subscription token cipher', () => {
  it('encrypts and decrypts with AES-GCM', () => {
    const key = Buffer.alloc(32, 7).toString('base64')
    const cipher = createOpenAISubscriptionTokenCipher(key)

    const encrypted = cipher.encrypt('access-token')

    expect(encrypted).toMatch(/^v1:/)
    expect(encrypted).not.toContain('access-token')
    expect(cipher.decrypt(encrypted)).toBe('access-token')
  })

  it('rejects missing or invalid keys at use time', () => {
    expect(() => createOpenAISubscriptionTokenCipher(undefined).encrypt('token'))
      .toThrow(OpenAISubscriptionTokenEncryptionError)

    expect(() => createOpenAISubscriptionTokenCipher(Buffer.alloc(16).toString('base64')).encrypt('token'))
      .toThrow('must decode to 32 bytes')
  })
})
