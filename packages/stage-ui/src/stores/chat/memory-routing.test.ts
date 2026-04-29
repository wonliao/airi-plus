import { describe, expect, it } from 'vitest'

import { determineMemoryRecallStrategy } from './memory-routing'

describe('determineMemoryRecallStrategy', () => {
  it('routes character identity prompts to the role card only', () => {
    const selfResult = determineMemoryRecallStrategy('你是誰？')
    const frierenResult = determineMemoryRecallStrategy('芙莉蓮是誰？')

    expect(selfResult.route).toBe('character-identity')
    expect(selfResult.shouldRecallShortTerm).toBe(false)
    expect(selfResult.shouldRecallLongTerm).toBe(false)

    expect(frierenResult.route).toBe('character-identity')
    expect(frierenResult.shouldRecallShortTerm).toBe(false)
    expect(frierenResult.shouldRecallLongTerm).toBe(false)
  })

  it('routes personal memory prompts to short-term recall only', () => {
    const result = determineMemoryRecallStrategy('我的名字是什麼？')

    expect(result.route).toBe('personal-memory')
    expect(result.shouldRecallShortTerm).toBe(true)
    expect(result.shouldRecallLongTerm).toBe(false)
  })

  it('routes wiki-style knowledge prompts to long-term recall only', () => {
    const result = determineMemoryRecallStrategy('誰是 Himmel？')

    expect(result.route).toBe('knowledge')
    expect(result.shouldRecallShortTerm).toBe(false)
    expect(result.shouldRecallLongTerm).toBe(true)
  })

  it('routes idol preference prompts to short-term recall only', () => {
    const chineseResult = determineMemoryRecallStrategy('我的偶像是什麼？')
    const englishResult = determineMemoryRecallStrategy('What is my favorite idol?')

    expect(chineseResult.route).toBe('personal-memory')
    expect(chineseResult.shouldRecallShortTerm).toBe(true)
    expect(chineseResult.shouldRecallLongTerm).toBe(false)

    expect(englishResult.route).toBe('personal-memory')
    expect(englishResult.shouldRecallShortTerm).toBe(true)
    expect(englishResult.shouldRecallLongTerm).toBe(false)
  })

  it('falls back to hybrid recall for ambiguous prompts', () => {
    const result = determineMemoryRecallStrategy('今天可以聊點什麼？')

    expect(result.route).toBe('hybrid')
    expect(result.shouldRecallShortTerm).toBe(true)
    expect(result.shouldRecallLongTerm).toBe(true)
  })
})
