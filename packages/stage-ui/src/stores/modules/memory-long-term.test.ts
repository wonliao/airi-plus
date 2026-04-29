import { describe, expect, it } from 'vitest'

import { buildLlmWikiPromotionCandidates } from './memory-long-term'

describe('buildLlmWikiPromotionCandidates', () => {
  it('blocks user-scoped short-term memories from llm-wiki promotion', () => {
    const candidates = buildLlmWikiPromotionCandidates({
      allowPromotion: true,
      items: [
        {
          category: 'identity.name',
          createdAt: new Date().toISOString(),
          id: 'memory-1',
          memory: '名字是Ben',
          userId: 'ben',
        },
      ],
      manualReviewRequired: true,
      personaReviewRequired: true,
    })

    expect(candidates[0]?.status).toBe('blocked')
    expect(candidates[0]?.blockedReason).toContain('short-term memory')
  })

  it('keeps non-personal stable facts as pending review candidates', () => {
    const candidates = buildLlmWikiPromotionCandidates({
      allowPromotion: true,
      items: [
        {
          category: 'topic.world',
          confidence: 0.91,
          createdAt: new Date().toISOString(),
          id: 'memory-2',
          memory: 'Frieren takes place after the hero party adventure',
          provenance: 'heuristic',
          userId: 'ben',
        },
      ],
      manualReviewRequired: true,
      personaReviewRequired: true,
    })

    expect(candidates[0]?.status).toBe('pending-review')
    expect(candidates[0]?.suggestedPath).toContain('wiki/topics/')
  })

  it('blocks low-confidence llm-assisted candidates', () => {
    const candidates = buildLlmWikiPromotionCandidates({
      allowPromotion: true,
      items: [
        {
          category: 'topic.world',
          confidence: 0.42,
          createdAt: new Date().toISOString(),
          id: 'memory-3',
          memory: 'An uncertain lore fact',
          provenance: 'llm-assisted',
          userId: 'ben',
        },
      ],
      manualReviewRequired: true,
      personaReviewRequired: true,
    })

    expect(candidates[0]?.status).toBe('blocked')
    expect(candidates[0]?.blockedReason).toContain('confidence')
  })
})
