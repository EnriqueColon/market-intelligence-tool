# News tab — subscriber sources: status and open items

*As of 2026-10-28: **The Real Deal is in production (`8b54ec3`, released 00:45 UTC, after `d21f4c6`
the evening before).** Its top ten articles of the week sit above the feed list in Industry-Specific
News under a "Subscriber sources" header, each with a Read button that opens the full text in the
tool, and both post-deploy warm runs confirmed TRD's API accepts the request from Vercel.
**South Florida Business Journal is being decided** by the user ("we will continue to brain storm
on the SFBJ"). Nothing for it is built; §3 records what was found and what has been discussed.*

The running list of what is still open. Update it at the end of every session alongside
`SESSION.md`, `ROLLBACK.md`, `README.md` and `confluence.md`.

---

## 1. What the user asked for

The firm's users read two subscription sites every day, South Florida Business Journal and The
Real Deal. The tool should pull the most important and pertinent articles from both, put them at
the top of the News tab, top five from each, and list the RSS items after them. Ranking reuses the
tool's existing relevance rules. The user offered the two logins; neither is stored, for the
reasons in §2 and §3.

## 2. The Real Deal — built

| | |
| --- | --- |
| Source | `https://therealdeal.com/wp-json/wp/v2/posts`, the site's public WordPress REST API |
| Credentials | **None.** Posts carry their full body, standfirst and taxonomy terms without a login; nothing on a post marks it subscriber-only. The metered paywall is applied in the reader's browser, so the firm's subscriptions matter when a user opens a link, not here |
| Requests | Two a day: `market=9574` (Miami, TRD's South Florida desk) and `sector=27942` (commercial), each `after=` seven days plus a day of slack, `per_page=100`. 49 and 97 posts on 2026-10-27 |
| Ranking | `lib/news/trd.ts`: the topic rules Industry-Specific News applies to feed items, on the headline and standfirst, distress before residential (6/4/3/2/1); +2 for a distress term only the body carries; sector +2 commercial, +2 finance, +1 development, −2 residential only; market +3 Miami, +1 national; +1 original reporting (news, breaking, data, reports), nothing for a blurb; promo and celebrity story types excluded; ties to the newer post. Every rule applied is recorded on the pick and shown in its hover card |
| Cache | `subscriber-sources-v2` + ET day (v1 held five picks), 25 hours, warmed at 05:00 UTC by `warm-cache` (`subscriberSources`); read server-side into the page with the rest of the News tab. A build whose requests all fail throws inside the cache, so no blank day is stored; the panel shows "Subscriber sources unavailable today: …" |
| Panel | `components/public-mentions.tsx`: a "Subscriber sources" header row, **ten** rows with a Subscriber badge (five until the user asked for ten on 2026-10-27), then a "From the feeds" row and the feed list as before. A feed item whose URL is pinned is not listed twice. Topic chips count both |
| Read | A **Read** button on each pinned row opens the article's full text in a dialog — title, published and updated dates, word count, the paragraphs, headings, quotes and lists, and a link to the article's page. `fetchTrdArticle(postId)` reads the post from the same API on demand, cached by post id for a day (`trd-article-v1`), never warmed; `articleBlocks` in `lib/news/trd.ts` strips the related-story cards, images, embeds and scripts and keeps the article's own text. Built at the user's request so anyone at the firm can read the piece without being signed in to the publisher; the View link still opens the publisher's page. Images, charts and embedded media are not shown, and the footer says so |
| Tests | `npm run test:news-trd` — 16 tests over a 24-post fixture captured 2026-10-27, including the Read view on every fixture post. `npm run verify:news-trd` — the live build from a laptop, printing each request's status, every pick's reasons, and the first pick's Read view |

**Verified 2026-10-27, locally:** tests pass, the live run returned 110 candidates and five picks
(a discounted Fort Lauderdale office purchase, a $500M Miami refinance, a suit over a $47M debt
fund, an $18M Deerfield Beach site, a Palm Beach County portfolio map), `next build` clean.

**Verified on Vercel, 2026-10-27 evening:** production built `d52fc1a` on Node 24.22.1 and the
post-deploy warm run (GitHub Actions 40577872730) reported `subscriberSources: ok`, which the action
returns only when at least one TRD request succeeded and the picks were cached. So Cloudflare, which
fronts the site and answers 403 to any user agent it does not take for a browser, accepts the
service's Chrome string from Vercel's egress. The warm-cache cron's `subscriber_sources: trd` log
line carries each request's status on every run, which is where a future refusal would first show.

**Known limits.**
- The API is public but unofficial; TRD can close or change it without notice. The verify script
  fails on a refused request, the panel degrades to a note rather than a blank, and the Read dialog
  shows the error with the link to the publisher's page.
- The Read view shows the publisher's full text inside the tool. The user chose this knowing it
  sits closer to the subscription's terms than a link does (2026-10-27: "Add the Read button").
  The firm holds a subscription; the text is shown to its own staff behind the tool's login.
- The Brief button fetches the article URL with the feed user agent, which Cloudflare refuses, so
  a pinned article's brief is built from its standfirst (the "intelligence brief" mode) rather than
  its body, which the Read view now has. Passing the API text into the brief is an open item.
- The TRD RSS entries in the feed list (`therealdeal.com/feed/`, `/miami/feed/`) still return 403
  on the feed user agent and now carry no text even when they load; they are harmless and redundant
  with the pinned block. Removing them is housekeeping.
- Topic matching is by word on the headline and standfirst; "default" in "by default" or "finance"
  in a mapping piece can score. The reasons on each pick make such a match visible.

## 3. South Florida Business Journal — held

What was established on 2026-10-27 from this laptop, before the user held the work:

- **The feed is gone.** `https://feeds.bizjournals.com/bizj_southflorida`, the URL the feed list
  still carries, returns an S3/CloudFront `AccessDenied` 403 for every user agent. SFBJ contributes
  nothing to the tool today.
- **The site cannot be read by a server.** Every `www.bizjournals.com` page, article pages and the
  `/syndication` page included, serves a Cloudflare JavaScript challenge ("Just a moment… Enable
  JavaScript and cookies"); `login.bizjournals.com` did not answer a plain request at all. A server
  cannot solve the challenge, and a `cf_clearance` cookie copied from a browser is bound to the
  browser and address that solved it. **A stored SFBJ password would therefore buy nothing**, and
  automated login would in any case sit outside the subscription's terms.
- **What works without credentials:** Google News RSS with `site:bizjournals.com/southflorida
  when:7d` returns SFBJ's headlines of the week with Google redirect links (verified: the Soffer
  Broward casino, a 56-storey tower, a $33M Edgewater site). Headlines only, no body.
- **What works with the subscription:** SFBJ's subscriber newsletters (Morning Edition, Afternoon
  Edition) by email. The tool has a Resend account (`RESEND_API_KEY`); Resend receives inbound
  email on its free plan (counted against the 3,000/month transactional quota), fires an
  `email.received` webhook carrying metadata only, and the body is fetched with its
  retrieve-received-email endpoint; webhook signatures are Svix-style and verified from the raw
  body. The firm would auto-forward the newsletters from a subscriber mailbox to an address the
  tool owns; the tool parses headlines, links and blurbs and stores them (Postgres is available in
  production). This needs one sample newsletter from the user to write the parser against.

Proposed when the user returns to it: Google News headlines first (immediate), the newsletter
route second, both ranked by the same rules as TRD and pinned beside it, five each.

**Discussed with the user on 2026-10-27, after the TRD release**, so the next conversation does
not repeat it:
- *What is needed to start:* route 1 needs nothing from the user; route 2 needs one sample
  newsletter (forwarded or pasted), the choice of newsletters (Morning Edition, Afternoon Edition,
  topic letters), and a forwarding rule in the subscriber mailbox to an address the tool owns.
- *Other ways round Cloudflare:* a licensed feed from the publisher (clean, paid); a paid news API
  (headlines only, tidier than Google); a robot browser logging in with the password, or a scraping
  service that "solves Cloudflare" — **declined**: outside the subscription's terms, risks the
  account, breaks whenever the challenge changes; a browser extension on a team member's machine
  (legitimate, manual, fragile); forwarding the weekly digital-edition PDF (weekly, same mechanism
  as the newsletter).
- *Does the newsletter carry all the data:* no — headlines, a sentence or two and a link, an
  editor's selection of ten to fifteen stories, sent morning and afternoon; enough to rank and pin,
  not enough for a full-text Brief. Full text only comes from a licensed feed.
- *The licensed-feed process:* ACBJ publishes no licensing programme, pricing or feed documentation
  (checked 2026-10-27); it is a sales conversation — ask the SFBJ rep, who routes it to corporate;
  specify South Florida, headline/summary/full text/link, daily, RSS/JSON/email, internal users;
  expect an annual fee, a user cap, internal-use-only and takedown clauses; it may be refused or
  priced for data vendors, or answered with a group subscription rather than a feed.
- *Recommendation given:* Google News headlines now, the newsletter forward when the sample and the
  rule are in place, an email to the SFBJ rep about a licence in parallel.

## 4. Open items

| Item | State |
| --- | --- |
| Verify TRD from Vercel (Cloudflare and the egress) | **Done** — `subscriberSources: ok` on the post-deploy warm run |
| Release to production | **Done** — `d21f4c6`, 2026-10-27 20:26 UTC |
| SFBJ | Being decided by the user; §3 has the routes and what has been discussed |
| Read button and ten picks | **In production** — `8b54ec3`, 2026-10-28 00:45 UTC; see §2 |
| Feed the API body into a pinned article's Brief | Open — the Read view's blocks are the text to pass |
| Remove the dead TRD RSS entries from the feed list | Housekeeping |
| Refresh the test fixture when the ranking rules change | As needed (`lib/news/fixtures/trd-posts.json`, captured 2026-10-27) |
