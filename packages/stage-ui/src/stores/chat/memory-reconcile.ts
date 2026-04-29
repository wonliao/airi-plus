export interface ShortTermMemoryExtractionCandidate {
  action?: 'forget' | 'remember'
  category: string
  confidence: number
  fact: string
  captureText: string
  stable: boolean
}

export interface ShortTermMemoryMemoryOperation {
  candidate: ShortTermMemoryExtractionCandidate
  kind: 'add' | 'delete' | 'none'
  matchedMemory?: string
}

function normalizeMemoryFact(value: string) {
  return value
    .trim()
    .toLowerCase()
    .replace(/[。！？!?,，．.]/g, '')
    .replace(/\s+/g, ' ')
}

export function reconcileShortTermMemoryCandidates(
  candidates: ShortTermMemoryExtractionCandidate[],
  existingMemories: string[],
) {
  const normalizedExistingMemories = new Map(
    existingMemories.map(memory => [normalizeMemoryFact(memory), memory]),
  )

  return candidates.map<ShortTermMemoryMemoryOperation>((candidate) => {
    const normalizedFact = normalizeMemoryFact(candidate.fact)
    const matchedMemory = normalizedExistingMemories.get(normalizedFact)

    if (candidate.action === 'forget') {
      return {
        candidate,
        kind: matchedMemory ? 'delete' : 'none',
        matchedMemory,
      }
    }

    if (matchedMemory) {
      return {
        candidate,
        kind: 'none',
        matchedMemory,
      }
    }

    return {
      candidate,
      kind: 'add',
    }
  })
}
