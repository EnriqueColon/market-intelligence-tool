// Where uploaded market-research PDFs live.
//
// On Vercel they are private Blobs: the browser uploads straight to Blob after
// a token handshake (/api/blob/handle-upload) and the server reads them back
// with BLOB_READ_WRITE_TOKEN. On the droplet there is no Blob store, so
// REPORT_STORAGE=disk keeps them in a folder (REPORT_STORAGE_DIR) and the
// browser posts the file to /api/research/upload-file instead. A report's
// document_url records which it is: Blob URLs are https://...vercel-storage.com,
// disk files are "local-report://<relative path>". Everything that needs the
// bytes goes through readReportPdf(), which handles both.
import { promises as fs } from "fs"
import path from "path"

export const LOCAL_REPORT_URL_PREFIX = "local-report://"

export type ReportStorageDriver = "disk" | "blob"

export function reportStorageDriver(): ReportStorageDriver {
  return process.env.REPORT_STORAGE?.trim().toLowerCase() === "disk" ? "disk" : "blob"
}

export function isLocalReportUrl(url: string): boolean {
  return url.startsWith(LOCAL_REPORT_URL_PREFIX)
}

export function isVercelBlobUrl(url: string): boolean {
  return /blob\.vercel-storage\.com/i.test(url)
}

function storageDir(): string {
  const configured = process.env.REPORT_STORAGE_DIR?.trim()
  return path.resolve(configured || path.join(process.cwd(), "uploads", "market-research"))
}

// One path segment: lower-case, no separators, nothing that could escape the folder.
function safeSegment(segment: string): string {
  const cleaned = segment
    .toLowerCase()
    .trim()
    .replace(/\s+/g, "-")
    .replace(/[^a-z0-9._-]/g, "")
    .replace(/^\.+/, "")
  return cleaned
}

// "market-research/2026/10/1730000000-foo.pdf" → the same shape, every segment sanitised.
export function safeRelativePath(pathname: string): string {
  const segments = pathname
    .split(/[\\/]+/)
    .map(safeSegment)
    .filter((s) => s && s !== "." && s !== "..")
  if (segments.length === 0) return `report-${Date.now()}.pdf`
  const last = segments[segments.length - 1]
  if (!last.endsWith(".pdf")) segments[segments.length - 1] = `${last}.pdf`
  return segments.join("/")
}

function absolutePathFor(relative: string): string {
  const root = storageDir()
  const abs = path.resolve(root, relative)
  if (abs !== root && !abs.startsWith(root + path.sep)) {
    throw new Error("Report path escapes the storage folder.")
  }
  return abs
}

function relativeFromUrl(url: string): string {
  return url.slice(LOCAL_REPORT_URL_PREFIX.length)
}

export async function saveReportToDisk(
  pathname: string,
  bytes: Buffer
): Promise<{ url: string; pathname: string }> {
  const relative = safeRelativePath(pathname)
  const abs = absolutePathFor(relative)
  await fs.mkdir(path.dirname(abs), { recursive: true })
  await fs.writeFile(abs, bytes)
  return { url: `${LOCAL_REPORT_URL_PREFIX}${relative}`, pathname: relative }
}

export async function readLocalReport(url: string): Promise<Buffer | null> {
  if (!isLocalReportUrl(url)) return null
  try {
    return await fs.readFile(absolutePathFor(relativeFromUrl(url)))
  } catch {
    return null
  }
}

export async function deleteLocalReport(url: string): Promise<boolean> {
  if (!isLocalReportUrl(url)) return false
  try {
    await fs.unlink(absolutePathFor(relativeFromUrl(url)))
    return true
  } catch {
    return false
  }
}

async function readPrivateBlob(url: string): Promise<Buffer | null> {
  const blobToken = process.env.BLOB_READ_WRITE_TOKEN?.trim() || ""
  if (!blobToken) return null
  const response = await fetch(url, {
    method: "GET",
    headers: { Authorization: `Bearer ${blobToken}` },
    cache: "no-store",
  })
  if (!response.ok) return null
  const contentType = (response.headers.get("content-type") || "").toLowerCase()
  if (!contentType.includes("pdf")) return null
  return Buffer.from(await response.arrayBuffer())
}

// Bytes of an uploaded PDF wherever it is stored; null when it cannot be read.
export async function readReportPdf(url: string): Promise<Buffer | null> {
  if (isLocalReportUrl(url)) return readLocalReport(url)
  if (isVercelBlobUrl(url)) return readPrivateBlob(url)
  return null
}

// True for a document_url that is an upload of ours (as opposed to a producer's public page).
export function isPrivateReportUrl(url: string): boolean {
  return isLocalReportUrl(url) || isVercelBlobUrl(url)
}

// A probe write + delete, used by transfer-diagnostics in disk mode.
export async function probeDiskStorage(): Promise<{ dir: string; ms: number }> {
  const started = Date.now()
  const saved = await saveReportToDisk(
    `diagnostics/${Date.now()}-${Math.random().toString(36).slice(2, 10)}.pdf`,
    Buffer.from("%PDF-1.4 diagnostics probe")
  )
  await deleteLocalReport(saved.url)
  return { dir: storageDir(), ms: Date.now() - started }
}
