export interface CharacterIdentityStrategy {
  isCharacterIdentity: boolean
  reason: string
}

const characterIdentityPatterns = [
  /^你是誰[？?]?$/u,
  /^妳是誰[？?]?$/u,
  /^你叫什麼[？?]?$/u,
  /^妳叫什麼[？?]?$/u,
  /^芙莉蓮是誰[？?]?$/u,
  /^芙莉蓮在哪[裡里]? [？?]?$/u,
  /^芙莉蓮在哪[裡里]?[？?]?$/u,
  /^who are you[?？]?$/u,
  /^what(?:'s| is) your name[?？]?$/u,
  /^who is frieren[?？]?$/u,
  /^where is frieren[?？]?$/u,
]

export function determineCharacterIdentityStrategy(message: string): CharacterIdentityStrategy {
  const trimmedMessage = message.trim().toLowerCase()
  const matchesCharacterIdentity = characterIdentityPatterns.some(pattern => pattern.test(trimmedMessage))

  if (matchesCharacterIdentity) {
    return {
      isCharacterIdentity: true,
      reason: 'Message asks who or where the active character is, so the role card should answer directly.',
    }
  }

  return {
    isCharacterIdentity: false,
    reason: 'Message is not a character self-identification query.',
  }
}
