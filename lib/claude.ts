/**
 * Shared Anthropic (Claude) API client.
 * Replaces the previous per-file Perplexity integrations.
 *
 * Tiers mirror the old Perplexity model split:
 * - "fast"  (was sonar)     → claude-haiku-4-5
 * - "smart" (was sonar-pro) → claude-sonnet-4-6
 *
 * Web search is Claude's server-side tool ($10 / 1K searches) and is enabled
 * per call site only where live grounding is actually needed.
 */

const ANTHROPIC_API_URL = "https://api.anthropic.com/v1/messages"
const ANTHROPIC_VERSION = "2023-06-01"
const DEFAULT_TIMEOUT_MS = 55_000

export type ClaudeTier = "fast" | "smart"

function modelForTier(tier: ClaudeTier): string {
  // Both tiers default to Haiku for cost control (low-traffic deployment).
  // Set CLAUDE_SMART_MODEL=claude-sonnet-4-6 to upgrade the smart tier.
  if (tier === "smart") {
    return process.env.CLAUDE_SMART_MODEL?.trim() || "claude-haiku-4-5"
  }
  return process.env.CLAUDE_FAST_MODEL?.trim() || "claude-haiku-4-5"
}

export function getClaudeApiKey(): string | undefined {
  return process.env.ANTHROPIC_API_KEY?.trim() || undefined
}

export type CallClaudeOptions = {
  system: string
  user: string
  /** "fast" = Haiku (default), "smart" = Sonnet */
  tier?: ClaudeTier
  maxTokens?: number
  temperature?: number
  /** Enable Claude's live web search tool. */
  webSearch?: boolean
  /** Cap on searches per request to control cost (default 3). */
  maxSearches?: number
  timeoutMs?: number
}

type ClaudeContentBlock = {
  type: string
  text?: string
}

type ClaudeResponse = {
  content?: ClaudeContentBlock[]
  stop_reason?: string
  error?: { type?: string; message?: string }
}

/**
 * Calls the Claude Messages API and returns the concatenated text output.
 * Throws on missing key, HTTP error, timeout, or empty response.
 */
export async function callClaude(options: CallClaudeOptions): Promise<string> {
  const apiKey = getClaudeApiKey()
  if (!apiKey) throw new Error("Missing ANTHROPIC_API_KEY")

  const {
    system,
    user,
    tier = "fast",
    maxTokens = 1200,
    temperature = 0.2,
    webSearch = false,
    maxSearches = 3,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const body: Record<string, unknown> = {
    model: modelForTier(tier),
    max_tokens: maxTokens,
    temperature,
    system,
    messages: [{ role: "user", content: user }],
  }

  if (webSearch) {
    body.tools = [
      { type: "web_search_20250305", name: "web_search", max_uses: maxSearches },
    ]
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(ANTHROPIC_API_URL, {
      method: "POST",
      headers: {
        "x-api-key": apiKey,
        "anthropic-version": ANTHROPIC_VERSION,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    })

    if (!res.ok) {
      let detail = ""
      try {
        const errJson = (await res.json()) as ClaudeResponse
        detail = errJson?.error?.message ? `: ${errJson.error.message}` : ""
      } catch {
        /* keep status-only message */
      }
      throw new Error(`Claude API error ${res.status}${detail}`)
    }

    const data = (await res.json()) as ClaudeResponse
    // Seamless join: with web search enabled, cited spans arrive as separate
    // text blocks that are fragments of the same sentence (or JSON payload).
    // Inline <cite> markers the model emits around searched facts are stripped.
    const text = (data.content || [])
      .filter((block) => block.type === "text" && typeof block.text === "string")
      .map((block) => block.text as string)
      .join("")
      .replace(/<\/?cite[^>]*>/g, "")
      .trim()

    if (!text) throw new Error("Claude returned an empty response")
    return text
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`Claude request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Calls Claude and extracts the first JSON object from the response.
 * Returns null if the call fails or no parseable JSON is found.
 */
export async function callClaudeJson(
  options: CallClaudeOptions,
  notes?: string[]
): Promise<any | null> {
  try {
    const text = await callClaude(options)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      notes?.push("Could not find JSON object in Claude response.")
      return null
    }
    try {
      return JSON.parse(match[0])
    } catch {
      notes?.push("Failed to parse JSON from Claude response.")
      return null
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    notes?.push(`Claude call failed: ${message}`)
    return null
  }
}
