const test = require("node:test")
const assert = require("node:assert/strict")

const { jsPDF } = require("jspdf")
const { extractTextWithFallbacks } = require("../app/actions/pdf-text-extraction.js")

function makeTextPdf(repeat = 50) {
  const doc = new jsPDF()
  const line = "Commercial real estate delinquent loans sent to special servicing. "
  const text = line.repeat(repeat)
  doc.text(text.slice(0, 200), 10, 10)
  doc.text(text.slice(200, 400), 10, 20)
  doc.text(text.slice(400, 600), 10, 30)
  doc.text(text.slice(600, 800), 10, 40)
  doc.text(text.slice(800, 1000), 10, 50)
  const ab = doc.output("arraybuffer")
  return Buffer.from(ab)
}

test("text-based PDF should extract without OCR", async () => {
  process.env.MI_PDF_EXTRACTOR_TEST_MODE = "1"
  delete process.env.MI_PDF_EXTRACTOR_SIMULATE_ENGINEA_CRASH
  delete process.env.MI_PDF_EXTRACTOR_SIMULATE_ENGINEB_CRASH
  delete process.env.MI_PDF_EXTRACTOR_FAKE_OCR_TEXT

  const buf = makeTextPdf(120)
  const result = await extractTextWithFallbacks(buf, { maxPages: 10, ocrPages: 2 })
  assert.ok(result)
  assert.equal(typeof result.text, "string")
  assert.ok(result.coverage.total_chars > 50, "expected some extracted chars")
  assert.equal(result.coverage.used_ocr, false)
})

test("parser crash should still return a structured result via fallback", async () => {
  process.env.MI_PDF_EXTRACTOR_TEST_MODE = "1"
  process.env.MI_PDF_EXTRACTOR_SIMULATE_ENGINEA_CRASH = "1"
  delete process.env.MI_PDF_EXTRACTOR_SIMULATE_ENGINEB_CRASH
  delete process.env.MI_PDF_EXTRACTOR_FAKE_OCR_TEXT

  const buf = makeTextPdf(120)
  const result = await extractTextWithFallbacks(buf, { maxPages: 10, ocrPages: 2 })
  assert.ok(result)
  assert.ok(Array.isArray(result.errors))
  assert.ok(result.errors.find((e) => e.stage === "engineA"), "expected engineA error recorded")
  // Either engineB succeeds or OCR/fallback keeps pipeline alive; but should not throw.
  assert.equal(typeof result.text, "string")
})

test("scanned-like PDF path triggers OCR fallback in test mode", async () => {
  process.env.MI_PDF_EXTRACTOR_TEST_MODE = "1"
  process.env.MI_PDF_EXTRACTOR_SIMULATE_ENGINEA_CRASH = "1"
  process.env.MI_PDF_EXTRACTOR_SIMULATE_ENGINEB_CRASH = "1"
  process.env.MI_PDF_EXTRACTOR_FAKE_OCR_TEXT = "OCR extracted text about special servicing and delinquent CRE loans."

  const buf = Buffer.from("%PDF-1.4\n%Fake\n") // doesn't need to be a valid pdf for the test hook
  const result = await extractTextWithFallbacks(buf, { maxPages: 3, ocrPages: 1 })
  assert.ok(result.coverage.used_ocr, "expected OCR used in test mode")
  assert.ok(result.text.includes("OCR extracted text"), "expected OCR text used")
})

