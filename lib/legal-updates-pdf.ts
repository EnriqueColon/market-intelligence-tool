/**
 * PDF to text for the legal feed, kept apart from the modules that need it.
 *
 * `legal-updates-florida.ts` reads the legislature's staff analyses, which are PDFs, and stays
 * import-free so the test runner can load it without a build. This is the one file that imports
 * the parser, and it is passed in as a function. `pdf-parse` is already a dependency of the
 * research summariser; its v2 API is a class, not the v1 default export.
 */

export async function pdfToText(bytes: Uint8Array, timeoutMs = 15_000): Promise<string> {
  const { PDFParse } = await import("pdf-parse")
  const parser = new PDFParse({ data: bytes })
  try {
    const result = await Promise.race([
      parser.getText(),
      new Promise<never>((_, reject) => setTimeout(() => reject(new Error("pdf-parse timed out")), timeoutMs)),
    ])
    return String(result?.text ?? "")
  } finally {
    await parser.destroy().catch(() => undefined)
  }
}
