"use client"

import { useEffect } from "react"

/**
 * Normalizes unhandled promise rejections where the reason is an Event.
 * Prevents Next.js from displaying "Error: [object Event]" by intercepting
 * in the capture phase and converting to a proper Error before other handlers run.
 */
export function RejectionHandler() {
  useEffect(() => {
    const handler = (ev: PromiseRejectionEvent) => {
      const reason = ev?.reason
      if (reason instanceof Event) {
        ev.stopImmediatePropagation()
        ev.preventDefault()
        const err = new Error(`Request failed (${reason.type})`)
        console.error("Unhandled rejection (normalized from Event):", err.message)
      }
    }
    window.addEventListener("unhandledrejection", handler, { capture: true })
    return () => window.removeEventListener("unhandledrejection", handler, { capture: true })
  }, [])
  return null
}
