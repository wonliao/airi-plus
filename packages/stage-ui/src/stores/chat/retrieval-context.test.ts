import { describe, expect, it } from 'vitest'

import { buildRetrievalContextMessage, formatRetrievalContextText } from './retrieval-context'

describe('retrieval-context', () => {
  it('builds a system retrieval context message when short-term memory is present', () => {
    const message = buildRetrievalContextMessage({
      shortTermRecall: {
        prompt: 'These are short-term memories recalled from the configured memory backend.\n1. my favorite idol is A',
      },
    })

    expect(message).not.toBeNull()
    expect(message?.role).toBe('system')
    expect(message?.content).toContain('[Retrieved Short-Term Memory]')
    expect(message?.content).toContain('supporting context')
  })

  it('merges short-term and long-term recall into one context block', () => {
    const text = formatRetrievalContextText({
      shortTermRecall: { prompt: 'short-term prompt' },
      longTermRecall: { prompt: 'long-term prompt' },
    })

    expect(text).toContain('[Retrieved Short-Term Memory]')
    expect(text).toContain('short-term prompt')
    expect(text).toContain('[Retrieved Long-Term Knowledge]')
    expect(text).toContain('long-term prompt')
  })

  it('returns null when there is no retrieval context', () => {
    expect(buildRetrievalContextMessage({})).toBeNull()
  })
})
