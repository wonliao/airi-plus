import type { InferInsertModel, InferSelectModel } from 'drizzle-orm'

import { relations } from 'drizzle-orm'
import { pgTable, text, timestamp } from 'drizzle-orm/pg-core'

import { user } from './accounts'

export const openaiSubscriptionAccounts = pgTable('openai_subscription_accounts', {
  userId: text('user_id').primaryKey().references(() => user.id, { onDelete: 'cascade' }),
  chatgptAccountId: text('chatgpt_account_id'),
  accessTokenCiphertext: text('access_token_ciphertext').notNull(),
  refreshTokenCiphertext: text('refresh_token_ciphertext').notNull(),
  accessTokenExpiresAt: timestamp('access_token_expires_at').notNull(),
  createdAt: timestamp('created_at').defaultNow().notNull(),
  updatedAt: timestamp('updated_at')
    .defaultNow()
    .$onUpdate(() => /* @__PURE__ */ new Date())
    .notNull(),
})

export const openaiSubscriptionAccountsRelations = relations(openaiSubscriptionAccounts, ({ one }) => ({
  user: one(user, {
    fields: [openaiSubscriptionAccounts.userId],
    references: [user.id],
  }),
}))

export type OpenAISubscriptionAccount = InferSelectModel<typeof openaiSubscriptionAccounts>
export type NewOpenAISubscriptionAccount = InferInsertModel<typeof openaiSubscriptionAccounts>
