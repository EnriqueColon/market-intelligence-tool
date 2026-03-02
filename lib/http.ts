type FetchWithTimeoutOptions = RequestInit & {
  timeoutMs?: number
}

export async function fetchWithTimeout(
  url: string,
  options: FetchWithTimeoutOptions = {}
): Promise<Response> {
  const { timeoutMs = 8000, signal, ...rest } = options
  const controller = new AbortController()
  const timer = setTimeout(() => controller.abort(), timeoutMs)

  if (signal) {
    if (signal.aborted) controller.abort()
    signal.addEventListener("abort", () => controller.abort(), { once: true })
  }

  try {
    return await fetch(url, {
      ...rest,
      signal: controller.signal,
    })
  } finally {
    clearTimeout(timer)
  }
}
