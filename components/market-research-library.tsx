"use client"

import { useCallback, useEffect, useMemo, useState } from "react"
import { upload } from "@vercel/blob/client"

type LibraryItem = {
  id: number
  producer: string
  title: string
  document_url: string
  published_date: string | null
  tags: unknown
  has_summary: boolean
}

type UploadResult = {
  ok: boolean
  uploaded?: Array<{ title: string; url: string; id?: number }>
  failed?: Array<{ filename: string; error: string }>
  error?: string
}

type FileProgress = {
  filename: string
  status:
    | "queued"
    | "requesting_token"
    | "uploading_blob"
    | "registering"
    | "registered"
    | "failed"
  message?: string
}

const STATUS_LABEL: Record<FileProgress["status"], string> = {
  queued: "queued",
  requesting_token: "requesting upload token",
  uploading_blob: "uploading bytes to Blob",
  registering: "registering metadata in database",
  registered: "done",
  failed: "failed",
}

export function MarketResearchLibrary() {
  const [q, setQ] = useState("")
  const [producer, setProducer] = useState("manual")
  const [loading, setLoading] = useState(false)
  const [items, setItems] = useState<LibraryItem[]>([])
  const [error, setError] = useState<string | null>(null)

  const [uploadToken, setUploadToken] = useState("")
  const [files, setFiles] = useState<File[]>([])
  const [uploading, setUploading] = useState(false)
  const [uploadStatus, setUploadStatus] = useState<string>("")
  const [uploadResult, setUploadResult] = useState<UploadResult | null>(null)
  const [progress, setProgress] = useState<FileProgress[]>([])
  const [preflightStatus, setPreflightStatus] = useState<string>("")
  const [transferDiagStatus, setTransferDiagStatus] = useState<string>("")

  useEffect(() => {
    if (typeof window === "undefined") return
    const saved = window.sessionStorage.getItem("adminUploadToken")
    if (saved) setUploadToken(saved)
  }, [])

  useEffect(() => {
    if (typeof window === "undefined") return
    window.sessionStorage.setItem("adminUploadToken", uploadToken)
  }, [uploadToken])

  const readJsonSafe = useCallback(async <T,>(res: Response): Promise<T> => {
    const raw = await res.text()
    try {
      return JSON.parse(raw) as T
    } catch {
      throw new Error(raw.slice(0, 300) || "Non-JSON response from server.")
    }
  }, [])

  const loadLibrary = useCallback(async () => {
    setLoading(true)
    setError(null)
    const params = new URLSearchParams()
    if (q.trim()) params.set("q", q.trim())
    if (producer !== "all") params.set("producer", producer)
    try {
      const res = await fetch(`/api/research/reports?${params.toString()}`, {
        cache: "no-store",
      })
      const data = await readJsonSafe<{
        ok: boolean
        items?: LibraryItem[]
        error?: string
      }>(res)
      if (!res.ok || !data.ok) {
        setError(data.error || "Failed to load report library.")
        setItems([])
      } else {
        setItems(data.items || [])
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load report library.")
      setItems([])
    } finally {
      setLoading(false)
    }
  }, [q, producer, readJsonSafe])

  useEffect(() => {
    loadLibrary()
  }, [loadLibrary])

  const producerOptions = useMemo(() => {
    const unique = new Set(items.map((i) => i.producer))
    unique.add("manual")
    return ["all", ...Array.from(unique).sort((a, b) => a.localeCompare(b))]
  }, [items])

  const runTokenPreflight = useCallback(async (): Promise<void> => {
    const token = uploadToken.trim()
    if (!token) {
      throw new Error("Admin token is required.")
    }

    const res = await fetch("/api/blob/token-preflight", {
      method: "POST",
      headers: {
        "x-admin-upload-token": token,
      },
      cache: "no-store",
    })
    const data = await readJsonSafe<{ ok: boolean; error?: string; message?: string }>(res)
    if (!res.ok || !data.ok) {
      throw new Error(data.error || "Blob token preflight failed.")
    }
  }, [readJsonSafe, uploadToken])

  const handlePreflight = useCallback(async () => {
    setPreflightStatus("Checking token handshake...")
    try {
      await runTokenPreflight()
      setPreflightStatus("Preflight OK: token + Blob runtime config are valid.")
    } catch (err) {
      setPreflightStatus(err instanceof Error ? err.message : "Preflight failed.")
    }
  }, [runTokenPreflight])

  const handleTransferDiagnostics = useCallback(async () => {
    setTransferDiagStatus("Running transfer diagnostics...")
    try {
      const token = uploadToken.trim()
      if (!token) {
        throw new Error("Admin token is required.")
      }
      const res = await fetch("/api/blob/transfer-diagnostics", {
        method: "POST",
        headers: {
          "x-admin-upload-token": token,
        },
        cache: "no-store",
      })
      const data = await readJsonSafe<{
        ok: boolean
        error?: string
        region?: string
        timings?: { putMs?: number; totalMs?: number }
      }>(res)
      if (!res.ok || !data.ok) {
        throw new Error(data.error || "Transfer diagnostics failed.")
      }
      setTransferDiagStatus(
        `Transfer diagnostics OK (${String(data.region || "unknown")}): Blob PUT ${String(
          data.timings?.putMs ?? "n/a"
        )}ms, total ${String(data.timings?.totalMs ?? "n/a")}ms.`
      )
    } catch (err) {
      setTransferDiagStatus(err instanceof Error ? err.message : "Transfer diagnostics failed.")
    }
  }, [readJsonSafe, uploadToken])

  const handleUpload = useCallback(async () => {
    if (!uploadToken.trim()) {
      setUploadResult({ ok: false, error: "Admin token is required." })
      return
    }
    if (files.length === 0) {
      setUploadResult({ ok: false, error: "Select at least one PDF file." })
      return
    }

    const MAX_FILE_SIZE = 25 * 1024 * 1024
    const MAX_FILES = 15
    if (files.length > MAX_FILES) {
      setUploadResult({ ok: false, error: `Too many files. Max ${MAX_FILES} per request.` })
      return
    }

    setUploading(true)
    setUploadStatus("Starting upload...")
    setUploadResult(null)
    setProgress(files.map((f) => ({ filename: f.name || "unnamed.pdf", status: "queued" })))
    const uploaded: Array<{ title: string; url: string }> = []
    const failed: Array<{ filename: string; error: string }> = []

    const now = new Date()
    const yyyy = String(now.getUTCFullYear())
    const mm = String(now.getUTCMonth() + 1).padStart(2, "0")

    const humanizeFilename = (name: string) =>
      name.replace(/\.pdf$/i, "").replace(/[-_]+/g, " ").replace(/\s+/g, " ").trim()

    const safeFilename = (name: string) => {
      const lower = name.toLowerCase().trim().replace(/\s+/g, "-")
      const cleaned = lower.replace(/[^a-z0-9._-]/g, "")
      return cleaned || `report-${Date.now()}.pdf`
    }

    try {
      setUploadStatus("Running token preflight...")
      await runTokenPreflight()

      const withTimeout = async <T,>(
        task: Promise<T>,
        timeoutMs: number,
        message: string
      ): Promise<T> => {
        return await Promise.race([
          task,
          new Promise<T>((_, reject) =>
            setTimeout(() => reject(new Error(message)), timeoutMs)
          ),
        ])
      }

      const setFileProgress = (
        filename: string,
        status: FileProgress["status"],
        message?: string
      ) => {
        setProgress((prev) =>
          prev.map((p) => (p.filename === filename ? { ...p, status, message } : p))
        )
      }

      for (const file of files) {
        const filename = file.name || "unnamed.pdf"
        setUploadStatus(`${filename}: requesting upload token...`)
        setFileProgress(filename, "requesting_token", "Calling /api/blob/handle-upload")
        const lower = filename.toLowerCase()
        if (!(file.type === "application/pdf" || lower.endsWith(".pdf"))) {
          failed.push({ filename, error: "Only PDF files are allowed." })
          setFileProgress(filename, "failed", "Only PDF files are allowed.")
          continue
        }
        if (file.size > MAX_FILE_SIZE) {
          failed.push({ filename, error: "File exceeds 25MB limit." })
          setFileProgress(filename, "failed", "File exceeds 25MB limit.")
          continue
        }

        const pathname = `market-research/${yyyy}/${mm}/${Date.now()}-${safeFilename(filename)}`
        try {
          const fileStartedAt = Date.now()
          let waitingHintTimer: ReturnType<typeof setTimeout> | null = null
          waitingHintTimer = setTimeout(() => {
            setFileProgress(
              filename,
              "uploading_blob",
              "Still waiting on Blob upload token/transfer..."
            )
            setUploadStatus(`${filename}: still waiting on Blob token or transfer...`)
          }, 8000)

          setFileProgress(filename, "uploading_blob", "Uploading file bytes to Vercel Blob")
          setUploadStatus(`${filename}: uploading bytes to Blob...`)
          const blob = await withTimeout(
            upload(pathname, file, {
              access: "private",
              handleUploadUrl: "/api/blob/handle-upload",
              headers: {
                "x-admin-upload-token": uploadToken.trim(),
              },
              clientPayload: JSON.stringify({
                originalFilename: filename,
                title: humanizeFilename(filename) || "Untitled Report",
              }),
            }),
            120000,
            "Upload timed out after 120 seconds."
          )
          if (waitingHintTimer) clearTimeout(waitingHintTimer)
          setFileProgress(filename, "registering", "Upload complete, saving metadata record")
          setUploadStatus(`${filename}: registering metadata in database...`)
          const registerStartedAt = Date.now()
          const registerRes = await withTimeout(
            fetch("/api/research/register-upload", {
              method: "POST",
              headers: {
                "content-type": "application/json",
                "x-admin-upload-token": uploadToken.trim(),
              },
              body: JSON.stringify({
                blobUrl: blob.url,
                blobPath: blob.pathname,
                originalFilename: filename,
                title: humanizeFilename(filename) || "Untitled Report",
              }),
            }),
            20000,
            "Registration timed out after 20 seconds."
          )
          const registerJson = await readJsonSafe<{
            ok: boolean
            id?: number
            error?: string
          }>(registerRes)
          if (!registerRes.ok || !registerJson.ok) {
            throw new Error(registerJson.error || "Uploaded blob but failed to register report.")
          }
          uploaded.push({
            title: humanizeFilename(filename) || "Untitled Report",
            url: blob.url,
            id: registerJson.id,
          })
          const totalMs = Date.now() - fileStartedAt
          const registerMs = Date.now() - registerStartedAt
          setFileProgress(
            filename,
            "registered",
            `Upload + registration complete (id ${String(registerJson.id ?? "n/a")}, total ${totalMs}ms, register ${registerMs}ms)`
          )
          setUploadStatus(`${filename}: complete`)
        } catch (err) {
          let msg = err instanceof Error ? err.message : "Upload failed."
          if (msg.includes("Failed to retrieve the client token")) {
            msg =
              "Blob token handshake failed. Check /api/blob/handle-upload auth/runtime logs."
          }
          if (msg.includes("timed out")) {
            msg = `${msg} Likely token handshake or Blob transfer issue. Check /api/blob/handle-upload logs.`
          }
          failed.push({
            filename,
            error: msg,
          })
          setFileProgress(filename, "failed", msg)
          setUploadStatus(`${filename}: failed`)
        }
      }

      setUploadResult({ ok: failed.length === 0, uploaded, failed })
      setFiles([])
      setUploadStatus("Refreshing library...")
      void loadLibrary()
    } catch (err) {
      setUploadResult({
        ok: false,
        error: err instanceof Error ? err.message : "Upload failed.",
      })
    } finally {
      setUploadStatus("")
      setUploading(false)
    }
  }, [files, loadLibrary, readJsonSafe, uploadToken])

  return (
    <div className="space-y-6">
      <section className="rounded-lg border border-slate-200 bg-white p-6 shadow-sm">
        <h3 className="text-base font-semibold text-slate-800">Report Library</h3>
        <p className="mt-1 text-sm text-slate-600">
          Search and review uploaded institutional research PDFs.
        </p>

        <div className="mt-4 grid gap-3 sm:grid-cols-[1fr_180px_auto]">
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder="Search by title or URL"
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          />
          <select
            value={producer}
            onChange={(e) => setProducer(e.target.value)}
            className="rounded-md border border-slate-300 px-3 py-2 text-sm"
          >
            {producerOptions.map((p) => (
              <option key={p} value={p}>
                {p === "all" ? "All Producers" : p}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={loadLibrary}
            className="rounded-md bg-[#006D95] px-4 py-2 text-sm font-medium text-white"
          >
            Refresh
          </button>
        </div>

        {error && (
          <div className="mt-3 rounded-md border border-red-200 bg-red-50 px-3 py-2 text-sm text-red-700">
            {error}
          </div>
        )}

        <div className="mt-4 overflow-x-auto">
          <table className="w-full border-collapse text-sm">
            <thead>
              <tr className="border-b border-slate-200 text-left text-slate-600">
                <th className="py-2 pr-4 font-medium">Title</th>
                <th className="py-2 pr-4 font-medium">Producer</th>
                <th className="py-2 pr-4 font-medium">Published</th>
                <th className="py-2 pr-4 font-medium">Summary</th>
                <th className="py-2 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {loading ? (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    Loading reports...
                  </td>
                </tr>
              ) : items.length === 0 ? (
                <tr>
                  <td colSpan={5} className="py-4 text-slate-500">
                    No reports found.
                  </td>
                </tr>
              ) : (
                items.map((item) => (
                  <tr key={item.id} className="border-b border-slate-100">
                    <td className="py-3 pr-4 text-slate-800">{item.title}</td>
                    <td className="py-3 pr-4 text-slate-600">{item.producer}</td>
                    <td className="py-3 pr-4 text-slate-600">
                      {item.published_date ? new Date(item.published_date).toLocaleDateString() : "—"}
                    </td>
                    <td className="py-3 pr-4">
                      {item.has_summary ? (
                        <span className="rounded bg-green-100 px-2 py-1 text-xs text-green-700">Summarized</span>
                      ) : (
                        <span className="rounded bg-slate-100 px-2 py-1 text-xs text-slate-600">Pending</span>
                      )}
                    </td>
                    <td className="py-3">
                      <div className="flex gap-3">
                        <a
                          href={item.document_url}
                          target="_blank"
                          rel="noreferrer"
                          className="text-[#006D95] underline"
                        >
                          Open PDF
                        </a>
                        <a href={item.document_url} target="_blank" rel="noreferrer" download className="text-slate-700 underline">
                          Download
                        </a>
                      </div>
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </section>

      <details className="rounded-lg border border-slate-200 bg-slate-50 p-6">
        <summary className="cursor-pointer text-base font-semibold text-slate-800">
          Admin Upload
        </summary>
        <p className="mt-2 text-sm text-slate-600">
          Upload one or more PDF reports into the library.
        </p>

        <div className="mt-4 space-y-3">
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">Admin token</label>
            <input
              type="password"
              value={uploadToken}
              onChange={(e) => setUploadToken(e.target.value)}
              placeholder="x-admin-upload-token"
              className="w-full rounded-md border border-slate-300 px-3 py-2 text-sm"
            />
          </div>
          <div>
            <label className="mb-1 block text-xs font-medium text-slate-600">PDF files</label>
            <input
              type="file"
              accept="application/pdf"
              multiple
              onChange={(e) => setFiles(Array.from(e.target.files || []))}
              className="w-full rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
            />
            {files.length > 0 && (
              <p className="mt-1 text-xs text-slate-500">{files.length} file(s) selected</p>
            )}
          </div>
          <button
            type="button"
            onClick={handlePreflight}
            disabled={uploading}
            className="rounded-md border border-[#006D95] bg-white px-4 py-2 text-sm font-medium text-[#006D95] disabled:opacity-60"
          >
            Test Token Handshake
          </button>
          <button
            type="button"
            onClick={handleTransferDiagnostics}
            disabled={uploading}
            className="rounded-md border border-[#006D95] bg-white px-4 py-2 text-sm font-medium text-[#006D95] disabled:opacity-60"
          >
            Run Transfer Diagnostics
          </button>
          <button
            type="button"
            onClick={handleUpload}
            disabled={uploading}
            className="rounded-md bg-[#006D95] px-4 py-2 text-sm font-medium text-white disabled:opacity-60"
          >
            {uploading ? "Uploading..." : "Upload PDFs"}
          </button>
          {preflightStatus && <p className="text-xs text-slate-500">{preflightStatus}</p>}
          {transferDiagStatus && <p className="text-xs text-slate-500">{transferDiagStatus}</p>}
          {uploading && uploadStatus && (
            <p className="text-xs text-slate-500">{uploadStatus}</p>
          )}
          {progress.length > 0 && (
            <div className="rounded-md border border-slate-200 bg-white p-2 text-xs">
              {progress.map((p) => (
                <p key={p.filename} className="text-slate-600">
                  {p.filename}: {STATUS_LABEL[p.status]}
                  {p.message ? ` - ${p.message}` : ""}
                </p>
              ))}
            </div>
          )}
        </div>

        {uploadResult && (
          <div className="mt-4 rounded-md border border-slate-200 bg-white p-3 text-sm">
            {uploadResult.error && <p className="text-red-700">{uploadResult.error}</p>}
            {!!uploadResult.uploaded?.length && (
              <div>
                <p className="font-medium text-green-700">Uploaded</p>
                <ul className="mt-1 list-disc pl-5 text-slate-700">
                  {uploadResult.uploaded.map((u) => (
                    <li key={`${u.id}-${u.url}`}>{u.title}</li>
                  ))}
                </ul>
              </div>
            )}
            {!!uploadResult.failed?.length && (
              <div className="mt-2">
                <p className="font-medium text-amber-700">Failed</p>
                <ul className="mt-1 list-disc pl-5 text-slate-700">
                  {uploadResult.failed.map((f) => (
                    <li key={`${f.filename}-${f.error}`}>
                      {f.filename}: {f.error}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </div>
        )}
      </details>
    </div>
  )
}
