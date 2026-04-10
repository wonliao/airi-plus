export type MemoryRecallRoute = 'character-identity' | 'personal-memory' | 'knowledge' | 'hybrid'

export interface MemoryRecallStrategy {
  route: MemoryRecallRoute
  shouldRecallShortTerm: boolean
  shouldRecallLongTerm: boolean
  reason: string
}

const personalMemoryPatterns = [
  /請記住/u,
  /記住我/u,
  /你記得我/u,
  /還記得我/u,
  /我的名字/u,
  /我叫/u,
  /我住/u,
  /我喜歡/u,
  /我最喜歡/u,
  /我的偶像/u,
  /我偶像/u,
  /我的本命/u,
  /我本命/u,
  /我偏好/u,
  /我的偏好/u,
  /我的生日/u,
  /\bremember\b/u,
  /\bmy idol\b/u,
  /\bmy bias\b/u,
  /\bmy name\b/u,
  /\bwhat(?:'s| is)? my name\b/u,
  /\bwhere do i live\b/u,
  /\bwhat do i like\b/u,
  /\bwhat(?:'s| is)? my idol\b/u,
  /\bwhat(?:'s| is)? my bias\b/u,
  /\bwhat is my favorite\b/u,
  /\bwhat(?:'s| is)? my favorite idol\b/u,
  /\bmy favorite\b/u,
  /\bfavorite idol\b/u,
  /\bi prefer\b/u,
  /\bdo you remember me\b/u,
]

const characterIdentityPatterns = [
  /^你是誰[？?]?$/u,
  /^妳是誰[？?]?$/u,
  /^你叫什麼[？?]?$/u,
  /^妳叫什麼[？?]?$/u,
  /^芙莉蓮是誰[？?]?$/u,
  /^\bwho are you\b[?？]?$/u,
  /^\bwhat(?:'s| is) your name\b[?？]?$/u,
  /^\bwho is frieren\b[?？]?$/u,
]

const knowledgePatterns = [
  /誰是/u,
  /是什麼/u,
  /關係/u,
  /背景/u,
  /設定/u,
  /劇情/u,
  /考試/u,
  /\bwho is\b/u,
  /\bwhat is\b/u,
  /\brelationship\b/u,
  /\blore\b/u,
  /\bworld\b/u,
  /\bexam\b/u,
  /\btopic\b/u,
]

export function determineMemoryRecallStrategy(message: string): MemoryRecallStrategy {
  const trimmedMessage = message.trim()
  const normalizedMessage = trimmedMessage.toLowerCase()

  const matchesCharacterIdentity = characterIdentityPatterns.some(pattern => pattern.test(normalizedMessage))
  const matchesPersonalMemory = personalMemoryPatterns.some(pattern => pattern.test(normalizedMessage))
  const matchesKnowledge = knowledgePatterns.some(pattern => pattern.test(normalizedMessage))

  if (matchesCharacterIdentity) {
    return {
      route: 'character-identity',
      shouldRecallShortTerm: false,
      shouldRecallLongTerm: false,
      reason: 'Message asks who the active character is, so the role card should answer directly.',
    }
  }

  if (matchesPersonalMemory) {
    return {
      route: 'personal-memory',
      shouldRecallShortTerm: true,
      shouldRecallLongTerm: false,
      reason: matchesKnowledge
        ? 'Message includes knowledge wording, but personal-memory signals take priority.'
        : 'Message looks like a personal memory query or preference statement.',
    }
  }

  if (!matchesPersonalMemory && matchesKnowledge) {
    return {
      route: 'knowledge',
      shouldRecallShortTerm: false,
      shouldRecallLongTerm: true,
      reason: 'Message looks like world knowledge or wiki recall.',
    }
  }

  return {
    route: 'hybrid',
    shouldRecallShortTerm: true,
    shouldRecallLongTerm: true,
    reason: matchesPersonalMemory && matchesKnowledge
      ? 'Message contains both personal-memory and knowledge signals.'
      : 'Message does not strongly match one memory source, so both are consulted.',
  }
}
