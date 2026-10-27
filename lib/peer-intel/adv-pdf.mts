/**
 * Form ADV PDF → ordered lines with their checkbox marks.
 *
 * IAPD serves an adviser's current Form ADV as a generated PDF. Its text
 * extracts cleanly, but **every yes/no answer is a drawn image, not text**:
 * each question paints one small image under the "Yes" column and one under
 * the "No" column, and each option in a checkbox list paints one image per
 * option. There are no form fields and no tick glyphs. The ticked image has
 * more ink than the empty one — 83% against 79% of dark pixels for the 13×16
 * yes/no boxes, 37% against 22% for the 9×9 list boxes, measured on Safe
 * Harbor's and BH3's filings on 2026-10-26 — and every page carries both kinds,
 * so the two can be told apart by clustering within the page rather than by a
 * fixed threshold that a new report generator could move.
 *
 * This module is the only Node-and-pdf.js-dependent step. It runs in the
 * refresh script, never on Vercel: the PDFs run to 165 MB for an umbrella
 * filer, and a function would neither hold them nor finish in time. Its output
 * is plain data that `adv.ts` parses without any PDF library.
 */

import { readFile } from "node:fs/promises"
import type { AdvLine, AdvMark } from "./adv"

export type { AdvLine, AdvMark }

export type AdvPdf = {
  pages: number
  lines: AdvLine[]
}

type PdfJs = typeof import("pdfjs-dist/legacy/build/pdf.mjs")

async function pdfjs(): Promise<PdfJs> {
  // pdf.js is pdf-parse's own dependency; importing it directly gives the
  // operator list and image data that pdf-parse's text API does not expose.
  return (await import("pdfjs-dist/legacy/build/pdf.mjs")) as PdfJs
}

/** Dark-pixel fraction of a decoded image, over any channel layout. */
export function inkFraction(data: Uint8Array | Uint8ClampedArray, width: number, height: number): number {
  const n = width * height
  if (!n) return 0
  const channels = Math.max(1, Math.round(data.length / n))
  let dark = 0
  for (let i = 0; i < n; i++) {
    const v = channels >= 3 ? (data[i * channels] + data[i * channels + 1] + data[i * channels + 2]) / 3 : data[i * channels]
    if (v < 128) dark++
  }
  return dark / n
}

/**
 * Which marks are ticked, decided per size class by splitting the ink values
 * at the widest gap. One mark alone, or marks all within two points of each
 * other, cannot be split and are left unticked — a question with no answer
 * drawn is reported as unanswered rather than guessed.
 */
export function classifyTicks(marks: Array<Pick<AdvMark, "width" | "height" | "ink">>): boolean[] {
  const result = new Array<boolean>(marks.length).fill(false)
  const groups = new Map<string, number[]>()
  marks.forEach((m, i) => {
    const key = `${Math.round(m.width)}x${Math.round(m.height)}`
    groups.set(key, [...(groups.get(key) ?? []), i])
  })
  for (const idx of groups.values()) {
    const sorted = [...idx].sort((a, b) => marks[a].ink - marks[b].ink)
    if (sorted.length < 2) continue
    let gapAt = -1
    let gap = 0
    for (let k = 1; k < sorted.length; k++) {
      const g = marks[sorted[k]].ink - marks[sorted[k - 1]].ink
      if (g > gap) {
        gap = g
        gapAt = k
      }
    }
    if (gap < 0.02) continue
    for (let k = gapAt; k < sorted.length; k++) result[sorted[k]] = true
  }
  return result
}

/**
 * Extract every page's text lines and checkbox images.
 *
 * Lines are text items grouped by baseline (within 3 pt) and ordered top to
 * bottom; a mark belongs to the line whose baseline is nearest its own bottom
 * edge, within 8 pt. Ticks are classified per page.
 */
export async function readAdvPdf(path: string): Promise<AdvPdf> {
  const lib = await pdfjs()
  const data = new Uint8Array(await readFile(path))
  // `useSystemFonts` only. With `disableFontFace` added, image objects never
  // resolved and every checkbox timed out; without it they resolve at once.
  // Errors only: the generator leaves empty FlateDecode streams on every
  // page, and pdf.js would otherwise print a warning for each of them.
  const doc = await lib.getDocument({ data, useSystemFonts: true, verbosity: lib.VerbosityLevel.ERRORS }).promise
  const lines: AdvLine[] = []
  try {
    for (let pageNo = 1; pageNo <= doc.numPages; pageNo++) {
      const page = await doc.getPage(pageNo)
      const ops = await page.getOperatorList()
      const images: Array<Omit<AdvMark, "ticked"> & { y: number }> = []
      let ctm = [1, 0, 0, 1, 0, 0]
      const stack: number[][] = []
      for (let i = 0; i < ops.fnArray.length; i++) {
        const fn = ops.fnArray[i]
        const args = ops.argsArray[i]
        if (fn === lib.OPS.save) stack.push(ctm)
        else if (fn === lib.OPS.restore) ctm = stack.pop() ?? ctm
        else if (fn === lib.OPS.transform) {
          const [a, b, c, d, e, f] = args as number[]
          ctm = [
            ctm[0] * a + ctm[2] * b,
            ctm[1] * a + ctm[3] * b,
            ctm[0] * c + ctm[2] * d,
            ctm[1] * c + ctm[3] * d,
            ctm[0] * e + ctm[2] * f + ctm[4],
            ctm[1] * e + ctm[3] * f + ctm[5],
          ]
        } else if (fn === lib.OPS.paintImageXObject) {
          const name = (args as [string])[0]
          const width = Math.abs(ctm[0])
          const height = Math.abs(ctm[3])
          // Checkboxes are small; anything larger is a logo or a rule.
          if (width > 20 || height > 20 || width < 5 || height < 5) continue
          // Two stores: an image named `g_…` is shared across pages and lives
          // in the document's `commonObjs`; any other lives in the page's
          // `objs`. Asking the wrong store waits forever, and a wait with
          // nothing else on the event loop exits the process silently with
          // code 0 — so the lookup is also bounded, and an image that has not
          // resolved in a second yields no mark rather than a hung run.
          const store = name.startsWith("g_") ? page.commonObjs : page.objs
          const obj = await new Promise<{ data?: Uint8Array; width: number; height: number } | null>((resolve) => {
            let settled = false
            const timer = setTimeout(() => {
              if (!settled) {
                settled = true
                resolve(null)
              }
            }, 1000)
            try {
              store.get(name, (o: { data?: Uint8Array; width: number; height: number }) => {
                if (!settled) {
                  settled = true
                  clearTimeout(timer)
                  resolve(o)
                }
              })
            } catch {
              clearTimeout(timer)
              resolve(null)
            }
          })
          if (!obj?.data) continue
          images.push({ x: ctm[4], y: ctm[5], width, height, ink: inkFraction(obj.data, obj.width, obj.height) })
        }
      }
      const ticks = classifyTicks(images)

      const content = await page.getTextContent()
      const items = content.items
        .filter((it): it is { str: string; transform: number[] } => "str" in it && typeof it.str === "string" && it.str.trim().length > 0)
        .map((it) => ({ str: it.str, x: it.transform[4], y: it.transform[5] }))
        .sort((a, b) => b.y - a.y || a.x - b.x)
      const pageLines: AdvLine[] = []
      for (const it of items) {
        const last = pageLines[pageLines.length - 1]
        if (last && Math.abs(last.y - it.y) <= 3) last.text += (last.text.endsWith(" ") || it.str.startsWith(" ") ? "" : " ") + it.str
        else pageLines.push({ page: pageNo, y: it.y, text: it.str, marks: [] })
      }
      images.forEach((im, i) => {
        let best: AdvLine | null = null
        let bestDist = 9
        for (const line of pageLines) {
          const d = Math.abs(line.y - im.y)
          if (d < bestDist) {
            bestDist = d
            best = line
          }
        }
        if (best) best.marks.push({ x: im.x, width: im.width, height: im.height, ink: im.ink, ticked: ticks[i] })
      })
      for (const line of pageLines) {
        line.text = line.text.replace(/\s+/g, " ").trim()
        line.marks.sort((a, b) => a.x - b.x)
      }
      lines.push(...pageLines)
    }
    return { pages: doc.numPages, lines }
  } finally {
    await doc.destroy()
  }
}
