import { Buffer } from 'node:buffer'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const KEY_BYTES = 32
const IV_BYTES = 12
const TAG_BYTES = 16
const PAYLOAD_VERSION = 'v1'

export class OpenAISubscriptionTokenEncryptionError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'OpenAISubscriptionTokenEncryptionError'
  }
}

export interface OpenAISubscriptionTokenCipher {
  decrypt: (ciphertext: string) => string
  encrypt: (plaintext: string) => string
  isConfigured: () => boolean
}

function resolveKey(key: string | undefined): Buffer {
  if (!key) {
    throw new OpenAISubscriptionTokenEncryptionError('OpenAI subscription token encryption key is not configured')
  }

  const decoded = Buffer.from(key, 'base64')
  if (decoded.length !== KEY_BYTES) {
    throw new OpenAISubscriptionTokenEncryptionError('OpenAI subscription token encryption key must decode to 32 bytes')
  }

  return decoded
}

export function createOpenAISubscriptionTokenCipher(key: string | undefined): OpenAISubscriptionTokenCipher {
  return {
    isConfigured() {
      return typeof key === 'string' && key.length > 0
    },

    encrypt(plaintext: string) {
      const resolvedKey = resolveKey(key)
      const iv = randomBytes(IV_BYTES)
      const cipher = createCipheriv('aes-256-gcm', resolvedKey, iv)
      const encrypted = Buffer.concat([
        cipher.update(plaintext, 'utf8'),
        cipher.final(),
      ])
      const tag = cipher.getAuthTag()
      return `${PAYLOAD_VERSION}:${Buffer.concat([iv, tag, encrypted]).toString('base64')}`
    },

    decrypt(ciphertext: string) {
      const [version, payload] = ciphertext.split(':', 2)
      if (version !== PAYLOAD_VERSION || !payload) {
        throw new OpenAISubscriptionTokenEncryptionError('Unsupported OpenAI subscription token ciphertext format')
      }

      const bytes = Buffer.from(payload, 'base64')
      if (bytes.length <= IV_BYTES + TAG_BYTES) {
        throw new OpenAISubscriptionTokenEncryptionError('Invalid OpenAI subscription token ciphertext')
      }

      const resolvedKey = resolveKey(key)
      const iv = bytes.subarray(0, IV_BYTES)
      const tag = bytes.subarray(IV_BYTES, IV_BYTES + TAG_BYTES)
      const encrypted = bytes.subarray(IV_BYTES + TAG_BYTES)
      const decipher = createDecipheriv('aes-256-gcm', resolvedKey, iv)
      decipher.setAuthTag(tag)
      return Buffer.concat([
        decipher.update(encrypted),
        decipher.final(),
      ]).toString('utf8')
    },
  }
}
