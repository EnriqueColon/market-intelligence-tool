# News access status (paywall handling)

The News tab classifies each article URL **before** producing a summary so we never imply we read full content when access is limited.

## Status values

- **open**: We could fetch the page and extract a substantial amount of readable text.
- **partial**: We could fetch the page but extracted text was limited (preview/snippet only).
- **paywalled**: The page appears blocked by subscription/login/bot checks, or fetch/extraction failed. We do not summarize article content.

## What the UI does

- List view shows a status indicator:
  - 🟢 open (full summary)
  - 🟡 partial (brief uses publicly available info only)
  - 🔒 paywalled (signal summary only)
- Detail view shows a banner for partial/paywalled sources:
  - “This source is paywalled or limited-access. This brief uses only publicly available information.”

## Classification heuristics (high level)

We fetch the article HTML (no cookies, no credentials) and classify using multiple checks:

- **Known paywall domains**: some publishers are paywalled by default (still attempt extraction).
- **Login/subscription markers**: “subscribe to continue”, “sign in to continue”, metered paywall language, etc.
- **Login form detection**: password fields / sign-in forms.
- **Bot challenge detection**: “verify you are human”, “enable cookies”, Cloudflare challenge hints.
- **Extracted text length**: if extracted text is below a threshold, it is treated as partial or paywalled.

## How to tune

These values live in `app/actions/news-access.ts`:

- `ACCESS_TEXT_MIN_CHARS` (default: 1200): minimum extracted characters to consider the source “open”.
- `ACCESS_TEXT_TINY_CHARS` (default: 200): below this, we treat as likely paywalled/blocked.
- `KNOWN_PAYWALL_DOMAINS`: small list of commonly paywalled publishers.

## Important policy note

This system **does not bypass paywalls**, does not use credentials, and is designed to be transparent about what content was actually accessible.

