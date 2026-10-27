/**
 * The committed Form ADV extract, loaded once.
 *
 * `adv-extract.json` is written by `npm run refresh:peer-adv` and committed;
 * it is a build-time input like the registry, not something fetched. Kept
 * behind a function so a test can pass its own extract and so the JSON's
 * shape is checked at one place rather than trusted wherever it is read.
 */

import extract from "./adv-extract.json"
import type { AdvExtract } from "./adv-link"

export function advExtract(): AdvExtract {
  return extract as AdvExtract
}
