import { object, optional, record, string, unknown } from 'valibot'

export const OAuthStartBodySchema = object({
  returnTo: optional(string()),
})

export const OAuthCallbackQuerySchema = object({
  code: string(),
  state: string(),
})

export const ProxyBodySchema = record(string(), unknown())
