"use client"

import { useState } from "react"
import { sendNewsEmail } from "@/app/actions/send-news-email"
import { Button } from "@/components/ui/button"

export function SendNewsEmailButton() {
  const [token, setToken] = useState("")
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSend = async () => {
    setSending(true)
    setStatus(null)
    try {
      const res = await sendNewsEmail({ token })
      setStatus(`Sent to ${res.sentToCount} recipients.`)
    } catch (err) {
      const message = err instanceof Error ? err.message : "Failed to send email."
      setStatus(message)
    } finally {
      setSending(false)
    }
  }

  return (
    <div className="flex items-center gap-2">
      <label className="text-xs text-[#006D95]">
        Admin token
        <input
          type="password"
          value={token}
          onChange={(event) => setToken(event.target.value)}
          className="ml-2 h-8 w-48 rounded-md border border-[#006D95] bg-background px-2 text-xs text-foreground focus:ring-2 focus:ring-[#006D95]/30 focus:outline-none"
          placeholder="Enter token"
        />
      </label>
      <Button
        size="sm"
        onClick={handleSend}
        disabled={sending || !token}
        className="bg-[#006D95] text-[#FFFFFF] hover:bg-[#005a7a] border-[#006D95]"
      >
        {sending ? "Sending..." : "Send News Email"}
      </Button>
      {status ? <span className="text-xs text-[#006D95]">{status}</span> : null}
    </div>
  )
}
