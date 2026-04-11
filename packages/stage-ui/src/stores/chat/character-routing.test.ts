import { describe, expect, it } from 'vitest'

import { determineCharacterIdentityStrategy } from './character-routing'

describe('determineCharacterIdentityStrategy', () => {
  it('detects self-identification prompts for the active character', () => {
    expect(determineCharacterIdentityStrategy('你是誰？').isCharacterIdentity).toBe(true)
    expect(determineCharacterIdentityStrategy('芙莉蓮是誰？').isCharacterIdentity).toBe(true)
    expect(determineCharacterIdentityStrategy('芙莉蓮在哪？').isCharacterIdentity).toBe(true)
    expect(determineCharacterIdentityStrategy('Where is Frieren?').isCharacterIdentity).toBe(true)
  })

  it('does not classify regular memory or knowledge prompts as character identity', () => {
    expect(determineCharacterIdentityStrategy('我的名字是什麼？').isCharacterIdentity).toBe(false)
    expect(determineCharacterIdentityStrategy('Himmel 和芙莉蓮的關係是什麼？').isCharacterIdentity).toBe(false)
  })
})
