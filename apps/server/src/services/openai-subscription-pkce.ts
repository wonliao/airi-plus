import type { Buffer } from 'node:buffer'

import { createHash, randomBytes } from 'node:crypto'

const authHelperModule = '@proj-airi/stage-shared/auth'

interface OpenAISubscriptionPkceHelpers {
  generateCodeChallenge: (verifier: string) => Promise<string>
  generateCodeVerifier: (length?: number) => string
  generateState: () => string
}

let helpersPromise: Promise<OpenAISubscriptionPkceHelpers> | undefined

function base64UrlEncode(buffer: Buffer) {
  return buffer.toString('base64url')
}

function fallbackHelpers(): OpenAISubscriptionPkceHelpers {
  return {
    generateCodeVerifier(length = 64) {
      return base64UrlEncode(randomBytes(length))
    },

    async generateCodeChallenge(verifier: string) {
      return base64UrlEncode(createHash('sha256').update(verifier).digest())
    },

    generateState() {
      return base64UrlEncode(randomBytes(32))
    },
  }
}

export async function loadOpenAISubscriptionPkceHelpers(): Promise<OpenAISubscriptionPkceHelpers> {
  helpersPromise ??= import(authHelperModule)
    .then((mod) => {
      const loaded = mod as Partial<OpenAISubscriptionPkceHelpers>
      if (
        typeof loaded.generateCodeVerifier !== 'function'
        || typeof loaded.generateCodeChallenge !== 'function'
        || typeof loaded.generateState !== 'function'
      ) {
        return fallbackHelpers()
      }

      return loaded as OpenAISubscriptionPkceHelpers
    })
    .catch(() => fallbackHelpers())

  return helpersPromise
}
