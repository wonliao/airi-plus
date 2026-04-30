import type { Database } from '../libs/db'

import { eq } from 'drizzle-orm'

import { user } from '../schemas/accounts'
import { createOpenAISubscriptionTokenCipher } from './openai-subscription-crypto'

import * as schema from '../schemas/openai-subscription'

export interface OpenAISubscriptionAccountInput {
  accessToken: string
  accessTokenExpiresAt: Date
  chatgptAccountId?: string | null
  refreshToken: string
  userId: string
}

export interface OpenAISubscriptionAccountWithTokens {
  accessToken: string
  accessTokenExpiresAt: Date
  chatgptAccountId: string | null
  refreshToken: string
  userId: string
}

export function createOpenAISubscriptionAccountService(db: Database, encryptionKey: string | undefined) {
  const tokenCipher = createOpenAISubscriptionTokenCipher(encryptionKey)

  async function getStoredAccountByUserId(userId: string) {
    return await db.query.openaiSubscriptionAccounts.findFirst({
      where: eq(schema.openaiSubscriptionAccounts.userId, userId),
    })
  }

  return {
    isTokenEncryptionConfigured() {
      return tokenCipher.isConfigured()
    },

    getStoredAccountByUserId,

    async ensureLocalSubscriptionUser(userId: string) {
      await db.insert(user)
        .values({
          id: userId,
          name: 'Local OpenAI Subscription',
          email: `${userId.replaceAll(':', '-')}@local.openai-subscription.airi`,
          emailVerified: true,
        })
        .onConflictDoNothing()
    },

    async getAccountByUserId(userId: string): Promise<OpenAISubscriptionAccountWithTokens | undefined> {
      const account = await getStoredAccountByUserId(userId)
      if (!account) {
        return undefined
      }

      return {
        userId: account.userId,
        chatgptAccountId: account.chatgptAccountId,
        accessToken: tokenCipher.decrypt(account.accessTokenCiphertext),
        refreshToken: tokenCipher.decrypt(account.refreshTokenCiphertext),
        accessTokenExpiresAt: account.accessTokenExpiresAt,
      }
    },

    async upsertAccountForUser(input: OpenAISubscriptionAccountInput) {
      const [account] = await db.insert(schema.openaiSubscriptionAccounts)
        .values({
          userId: input.userId,
          chatgptAccountId: input.chatgptAccountId ?? null,
          accessTokenCiphertext: tokenCipher.encrypt(input.accessToken),
          refreshTokenCiphertext: tokenCipher.encrypt(input.refreshToken),
          accessTokenExpiresAt: input.accessTokenExpiresAt,
        })
        .onConflictDoUpdate({
          target: schema.openaiSubscriptionAccounts.userId,
          set: {
            chatgptAccountId: input.chatgptAccountId ?? null,
            accessTokenCiphertext: tokenCipher.encrypt(input.accessToken),
            refreshTokenCiphertext: tokenCipher.encrypt(input.refreshToken),
            accessTokenExpiresAt: input.accessTokenExpiresAt,
            updatedAt: new Date(),
          },
        })
        .returning()

      return account
    },

    async deleteAccountByUserId(userId: string) {
      await db.delete(schema.openaiSubscriptionAccounts)
        .where(eq(schema.openaiSubscriptionAccounts.userId, userId))
    },
  }
}

export type OpenAISubscriptionAccountService = ReturnType<typeof createOpenAISubscriptionAccountService>
