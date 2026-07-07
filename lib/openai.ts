/**
 * Shared OpenAI API client (Responses API).
 * Replaces the previous Anthropic (Claude) integration in lib/claude.ts.
 *
 * Tiers mirror the old Claude model split:
 * - "fast"  (was claude-haiku-4-5)  → gpt-5-mini
 * - "smart" (was claude-sonnet-4-6) → gpt-5-mini (upgrade via OPENAI_SMART_MODEL)
 *
 * Web search is OpenAI's hosted `web_search` tool on the Responses API and is
 * enabled per call site only where live grounding is actually needed.
 */

const OPENAI_RESPONSES_URL = "https://api.openai.com/v1/responses"
const DEFAULT_TIMEOUT_MS = 55_000

export type OpenAiTier = "fast" | "smart"

function modelForTier(tier: OpenAiTier): string {
  // Both tiers default to gpt-5-mini for cost control (low-traffic deployment).
  // Set OPENAI_SMART_MODEL=gpt-5 to upgrade the smart tier.
  if (tier === "smart") {
    return process.env.OPENAI_SMART_MODEL?.trim() || "gpt-5-mini"
  }
  return process.env.OPENAI_FAST_MODEL?.trim() || "gpt-5-mini"
}

/** GPT-5 / o-series reasoning models reject sampling params like temperature. */
function isReasoningModel(model: string): boolean {
  return /^(gpt-5|o\d)/i.test(model)
}

export function getOpenAiApiKey(): string | undefined {
  return process.env.OPENAI_API_KEY?.trim() || undefined
}

export type CallOpenAiOptions = {
  system: string
  user: string
  /** "fast" = gpt-5-mini (default), "smart" = OPENAI_SMART_MODEL or gpt-5-mini */
  tier?: OpenAiTier
  maxTokens?: number
  /** Ignored for reasoning models (gpt-5 family), which reject it. */
  temperature?: number
  /** Enable OpenAI's hosted web search tool. */
  webSearch?: boolean
  timeoutMs?: number
}

type ResponsesOutputContent = {
  type: string
  text?: string
}

type ResponsesOutputItem = {
  type: string
  content?: ResponsesOutputContent[]
}

type ResponsesApiResponse = {
  output?: ResponsesOutputItem[]
  output_text?: string
  status?: string
  error?: { code?: string; message?: string } | null
}

/**
 * Calls the OpenAI Responses API and returns the concatenated text output.
 * Throws on missing key, HTTP error, timeout, or empty response.
 */
export async function callOpenAi(options: CallOpenAiOptions): Promise<string> {
  const apiKey = getOpenAiApiKey()
  if (!apiKey) throw new Error("Missing OPENAI_API_KEY")

  const {
    system,
    user,
    tier = "fast",
    maxTokens = 1200,
    temperature = 0.2,
    webSearch = false,
    timeoutMs = DEFAULT_TIMEOUT_MS,
  } = options

  const model = modelForTier(tier)
  const reasoning = isReasoningModel(model)

  const body: Record<string, unknown> = {
    model,
    // Reasoning tokens count against max_output_tokens on GPT-5 models, so we
    // add headroom to preserve the visible-output budget call sites expect.
    max_output_tokens: reasoning ? maxTokens + 2000 : maxTokens,
    instructions: system,
    input: user,
  }

  if (reasoning) {
    // "low" keeps latency close to the old Haiku calls while still supporting
    // web search (which rejects "minimal").
    body.reasoning = { effort: "low" }
  } else {
    body.temperature = temperature
  }

  if (webSearch) {
    body.tools = [{ type: "web_search" }]
  }

  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  try {
    const res = await fetch(OPENAI_RESPONSES_URL, {
      method: "POST",
      headers: {
        authorization: `Bearer ${apiKey}`,
        "content-type": "application/json",
      },
      body: JSON.stringify(body),
      cache: "no-store",
      signal: controller.signal,
    })

    if (!res.ok) {
      let detail = ""
      try {
        const errJson = (await res.json()) as ResponsesApiResponse
        detail = errJson?.error?.message ? `: ${errJson.error.message}` : ""
      } catch {
        /* keep status-only message */
      }
      throw new Error(`OpenAI API error ${res.status}${detail}`)
    }

    const data = (await res.json()) as ResponsesApiResponse

    if (data.error?.message) {
      throw new Error(`OpenAI API error: ${data.error.message}`)
    }

    // Prefer the convenience field when present; otherwise concatenate the
    // text parts of message output items (web_search_call items carry no text).
    let text = (data.output_text || "").trim()
    if (!text) {
      text = (data.output || [])
        .filter((item) => item.type === "message" && Array.isArray(item.content))
        .flatMap((item) => item.content || [])
        .filter((part) => part.type === "output_text" && typeof part.text === "string")
        .map((part) => part.text as string)
        .join("")
        .trim()
    }

    if (!text) throw new Error("OpenAI returned an empty response")
    return text
  } catch (err) {
    if (err instanceof Error && err.name === "AbortError") {
      throw new Error(`OpenAI request timed out after ${timeoutMs}ms`)
    }
    throw err
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Calls OpenAI and extracts the first JSON object from the response.
 * Returns null if the call fails or no parseable JSON is found.
 */
export async function callOpenAiJson(
  options: CallOpenAiOptions,
  notes?: string[]
): Promise<any | null> {
  try {
    const text = await callOpenAi(options)
    const match = text.match(/\{[\s\S]*\}/)
    if (!match) {
      notes?.push("Could not find JSON object in OpenAI response.")
      return null
    }
    try {
      return JSON.parse(match[0])
    } catch {
      notes?.push("Failed to parse JSON from OpenAI response.")
      return null
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    notes?.push(`OpenAI call failed: ${message}`)
    return null
  }
}
