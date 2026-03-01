import { createHash } from "crypto"

/** Report ID used for searched reports: sha256(url) truncated. */
export function reportIdFromUrl(url: string): string {
  return createHash("sha256").update(url).digest("hex").slice(0, 32)
}
