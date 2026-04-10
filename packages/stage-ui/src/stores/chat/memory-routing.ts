export type MemoryRecallRoute = 'personal-memory' | 'knowledge' | 'hybrid'

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
  /我偏好/u,
  /我的偏好/u,
  /我的生日/u,
  /\bremember\b/u,
  /\bmy name\b/u,
  /\bwhat(?:'s| is)? my name\b/u,
  /\bwhere do i live\b/u,
  /\bwhat do i like\b/u,
  /\bwhat is my favorite\b/u,
  /\bmy favorite\b/u,
  /\bi prefer\b/u,
  /\bdo you remember me\b/u,
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

  const matchesPersonalMemory = personalMemoryPatterns.some(pattern => pattern.test(normalizedMessage))
  const matchesKnowledge = knowledgePatterns.some(pattern => pattern.test(normalizedMessage))

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
