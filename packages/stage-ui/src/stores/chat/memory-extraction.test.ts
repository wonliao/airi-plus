import { describe, expect, it } from 'vitest'

import { __memoryExtractionTestUtils } from './memory-extraction'

describe('memory extraction candidate filtering', () => {
  it('drops question-shaped candidates', () => {
    const candidates = __memoryExtractionTestUtils.parseExtractionResponse(JSON.stringify({
      candidates: [
        {
          action: 'remember',
          category: 'preference.favorite-color',
          confidence: 0.9,
          fact: '我最喜歡的顏色是什麼？',
          captureText: 'my favorite color?',
          stable: true,
        },
      ],
    }))

    expect(candidates).toEqual([])
  })
})
