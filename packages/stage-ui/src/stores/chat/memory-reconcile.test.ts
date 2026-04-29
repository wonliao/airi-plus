import { describe, expect, it } from 'vitest'

import { reconcileShortTermMemoryCandidates } from './memory-reconcile'

describe('reconcileShortTermMemoryCandidates', () => {
  it('marks exact normalized duplicates as none', () => {
    const operations = reconcileShortTermMemoryCandidates([
      {
        category: 'identity.name',
        confidence: 0.98,
        fact: '名字是Ben',
        captureText: 'my name is Ben',
        stable: true,
      },
    ], ['名字是Ben'])

    expect(operations).toEqual([
      expect.objectContaining({
        kind: 'none',
        matchedMemory: '名字是Ben',
      }),
    ])
  })

  it('keeps unseen candidates as add', () => {
    const operations = reconcileShortTermMemoryCandidates([
      {
        action: 'remember',
        category: 'preference.favorite-idol',
        confidence: 0.92,
        fact: '最喜歡的偶像是BLACKPINK',
        captureText: 'my favorite idol is BLACKPINK',
        stable: true,
      },
    ], ['名字是Ben'])

    expect(operations).toEqual([
      expect.objectContaining({
        kind: 'add',
      }),
    ])
  })

  it('marks exact matched forget requests as delete', () => {
    const operations = reconcileShortTermMemoryCandidates([
      {
        action: 'forget',
        category: 'preference.favorite-color',
        confidence: 0.94,
        fact: 'favorite color is lake green',
        captureText: 'my favorite color is lake green',
        stable: true,
      },
    ], ['favorite color is lake green'])

    expect(operations).toEqual([
      expect.objectContaining({
        kind: 'delete',
        matchedMemory: 'favorite color is lake green',
      }),
    ])
  })
})
