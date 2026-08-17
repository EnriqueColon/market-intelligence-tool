"use client"

import { useState } from "react"
import { sendNewsEmail } from "@/app/actions/send-news-email"
import { Button } from "@/components/ui/button"

export function SendNewsEmailButton() {
  const [sending, setSending] = useState(false)
  const [status, setStatus] = useState<string | null>(null)

  const handleSend = async () => {
    setSending(true)
    setStatus(null)
    try {
      const res = await sendNewsEmail()
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
      <Button
        size="sm"
        onClick={handleSend}
        disabled={sending}
        className="bg-[#006D95] text-[#FFFFFF] hover:bg-[#005a7a] border-[#006D95]"
      >
        {sending ? "Sending..." : "Send News Email"}
      </Button>
      {status ? <span className="text-xs text-[#006D95]">{status}</span> : null}
    </div>
  )
}
