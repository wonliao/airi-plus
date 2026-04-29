import type { Database } from '../../libs/db'

import { Buffer } from 'node:buffer'

import { beforeEach, describe, expect, it } from 'vitest'

import { mockDB } from '../../libs/mock-db'
import { createOpenAISubscriptionAccountService } from '../openai-subscription'

import * as schema from '../../schemas'

describe('openAI subscription account service', () => {
  let db: Database

  beforeEach(async () => {
    db = await mockDB(schema)
    await db.insert(schema.user).values({
      id: 'user-1',
      name: 'Test User',
      email: 'test@example.com',
    })
  })

  it('upserts and decrypts one account per user', async () => {
    const key = Buffer.alloc(32, 3).toString('base64')
    const service = createOpenAISubscriptionAccountService(db, key)

    await service.upsertAccountForUser({
      userId: 'user-1',
      chatgptAccountId: 'acct-1',
      accessToken: 'access-1',
      refreshToken: 'refresh-1',
      accessTokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    await service.upsertAccountForUser({
      userId: 'user-1',
      chatgptAccountId: 'acct-2',
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
      accessTokenExpiresAt: new Date('2026-02-01T00:00:00.000Z'),
    })

    const stored = await service.getStoredAccountByUserId('user-1')
    expect(stored?.chatgptAccountId).toBe('acct-2')
    expect(stored?.accessTokenCiphertext).not.toContain('access-2')

    const account = await service.getAccountByUserId('user-1')
    expect(account).toMatchObject({
      userId: 'user-1',
      chatgptAccountId: 'acct-2',
      accessToken: 'access-2',
      refreshToken: 'refresh-2',
    })
  })

  it('deletes the account by user id', async () => {
    const service = createOpenAISubscriptionAccountService(db, Buffer.alloc(32, 4).toString('base64'))
    await service.upsertAccountForUser({
      userId: 'user-1',
      accessToken: 'access',
      refreshToken: 'refresh',
      accessTokenExpiresAt: new Date('2026-01-01T00:00:00.000Z'),
    })

    await service.deleteAccountByUserId('user-1')

    expect(await service.getStoredAccountByUserId('user-1')).toBeUndefined()
  })
})
