/**
 * EmbeddingService — Semantic vector embeddings via OpenAI-compatible /embeddings endpoint.
 *
 * Features:
 * - Works with any OpenAI-compatible API (OpenRouter, OpenAI, Ollama, etc.)
 * - In-memory LRU cache (up to 200 entries) to avoid redundant API calls
 * - Graceful fallback: if API unavailable → returns null → caller uses Jaccard
 * - Cosine similarity for semantic ranking
 */

export interface EmbeddingConfig {
  baseUrl?: string
  apiKey?: string
  embeddingModel?: string
  embeddingBaseUrl?: string
}

interface CacheEntry {
  embedding: number[]
  accessedAt: number
}

const CACHE_MAX_SIZE = 200

export class EmbeddingService {
  private static _cache: Map<string, CacheEntry> = new Map()
  private static _unsupportedEndpoints: Set<string> = new Set()

  /** Fast deterministic string hash (djb2 variant, hex output) */
  private static _hash(str: string): string {
    let h = 5381
    for (let i = 0; i < str.length; i++) {
      h = ((h << 5) + h) ^ str.charCodeAt(i)
      h = h >>> 0 // keep unsigned 32-bit
    }
    return h.toString(16)
  }

  /**
   * Get embedding vector for a text string.
   * Returns null if API is not configured or fails — use Jaccard fallback in that case.
   */
  static async getEmbedding(text: string, config: EmbeddingConfig): Promise<number[] | null> {
    const model = config.embeddingModel?.trim()
    if (!model) return null

    const apiKey = config.apiKey?.trim()
    const baseUrl = (config.embeddingBaseUrl?.trim() || config.baseUrl?.trim() || '').replace(/\/+$/, '')
    if (!baseUrl) return null

    const endpointKey = `${baseUrl}::${model}`
    if (this._unsupportedEndpoints.has(endpointKey)) {
      return null
    }

    const cleanText = text.trim().slice(0, 8000) // Safety limit
    if (!cleanText) return null

    // Use short hash as cache key — avoids 8KB keys in Map
    const cacheKey = `${model}::${this._hash(cleanText)}`
    const cached = this._cache.get(cacheKey)
    if (cached) {
      cached.accessedAt = Date.now()
      return cached.embedding
    }

    try {
      const url = baseUrl.endsWith('/embeddings') ? baseUrl : `${baseUrl}/embeddings`

      const headers: Record<string, string> = {
        'Content-Type': 'application/json',
        'HTTP-Referer': 'https://zipply.fun',
        'X-Title': 'zipply',
        'User-Agent': 'zipply/1.0.0 (https://zipply.fun)'
      }
      if (apiKey) {
        headers['Authorization'] = `Bearer ${apiKey}`
      }

      const response = await fetch(url, {
        method: 'POST',
        headers,
        body: JSON.stringify({ model, input: cleanText }),
        signal: AbortSignal.timeout(6000) // 6s timeout
      })

      if (!response.ok) {
        const errText = await response.text().catch(() => '')
        if (
          errText.includes('No credentials') ||
          errText.includes('model_not_found') ||
          response.status === 404 ||
          response.status === 400
        ) {
          this._unsupportedEndpoints.add(endpointKey)
          console.warn(`[EmbeddingService] Embedding unavailable on ${baseUrl} (${model}): ${errText.slice(0, 120)}. Falling back to lexical search.`)
        } else {
          console.warn(`[EmbeddingService] API error ${response.status}: ${errText.slice(0, 200)}`)
        }
        return null
      }

      const data = await response.json()
      const embedding = data?.data?.[0]?.embedding

      if (!Array.isArray(embedding) || embedding.length === 0) {
        console.warn('[EmbeddingService] Invalid embedding response shape')
        return null
      }

      // Store in LRU cache
      this._pruneCache()
      this._cache.set(cacheKey, { embedding, accessedAt: Date.now() })

      return embedding
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      if (!msg.includes('abort') && !msg.includes('timeout')) {
        console.warn(`[EmbeddingService] Failed to get embedding: ${msg}`)
      }
      return null
    }
  }

  /**
   * Cosine similarity between two vectors (0..1).
   */
  static cosineSimilarity(a: number[], b: number[]): number {
    if (a.length !== b.length || a.length === 0) return 0

    let dot = 0
    let normA = 0
    let normB = 0

    for (let i = 0; i < a.length; i++) {
      dot += a[i] * b[i]
      normA += a[i] * a[i]
      normB += b[i] * b[i]
    }

    const denom = Math.sqrt(normA) * Math.sqrt(normB)
    if (denom === 0) return 0

    return Math.max(0, Math.min(1, dot / denom))
  }

  /**
   * Get embeddings for multiple texts in batch (sequential to respect rate limits).
   */
  static async getBatchEmbeddings(
    texts: string[],
    config: EmbeddingConfig
  ): Promise<Array<number[] | null>> {
    const results: Array<number[] | null> = []
    for (const text of texts) {
      results.push(await this.getEmbedding(text, config))
    }
    return results
  }

  /**
   * Clear entire embedding cache.
   */
  static clearCache(): void {
    this._cache.clear()
  }

  /**
   * LRU prune: remove oldest entries when over limit.
   */
  private static _pruneCache(): void {
    if (this._cache.size < CACHE_MAX_SIZE) return

    const entries = [...this._cache.entries()].sort(
      (a, b) => a[1].accessedAt - b[1].accessedAt
    )

    const toRemove = Math.ceil(CACHE_MAX_SIZE * 0.2)
    for (let i = 0; i < toRemove; i++) {
      this._cache.delete(entries[i][0])
    }
  }
}
