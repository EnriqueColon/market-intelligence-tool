# CBRE Insights Filter Documentation Report

**Date:** February 23, 2026  
**Source:** Codebase analysis (`lib/cbre-options.ts`, `components/cbre-find-dialog.tsx`, `scripts/cbre-automate.ts`) + web fetch of https://www.cbre.com/insights

---

## Browser MCP Tools Status

**The browser MCP tools are not available** in this session. The `call_mcp_tool` for `cursor-ide-browser` returned: `Tool cursor-ide-browser-browser_tabs not found, available tools: []`. This report is compiled from:

1. Your existing codebase (curated options and automation logic)
2. Web fetch of the CBRE insights page (static HTML only; filters are JS-rendered and not visible in fetch output)

---

## Page Structure (from web fetch)

- **URL:** https://www.cbre.com/insights
- **Main tabs:** Overview | Insights | Market Reports | Research Team
- **Section anchors:** `#market-reports`, `#insights`
- **Direct links:** [See All Insights](https://www.cbre.com/insights#insights), [See All Market Reports](https://www.cbre.com/insights#market-reports)

---

## Filter Names by Section

### Market Reports (`#market-reports`)

| Filter        | Present | Notes                                      |
|---------------|---------|--------------------------------------------|
| Property Type | Yes     |                                            |
| Region        | Yes     |                                            |
| Country       | Yes     |                                            |
| Market        | Yes     |                                            |
| Topic         | No      | Topic filter is **Insights-only**          |

### Insights (`#insights`)

| Filter        | Present | Notes                                      |
|---------------|---------|--------------------------------------------|
| Property Type | Yes     |                                            |
| Region        | Yes     |                                            |
| Country       | Yes     |                                            |
| Market        | Yes     |                                            |
| Topic         | Yes     | Insights-specific thematic filter          |

---

## Exact Option Values and Labels

### 1. Property Type

| Value             | Label                |
|-------------------|----------------------|
| `all`             | All properties       |
| `office`          | Office               |
| `industrial`      | Industrial & Logistics |
| `multifamily`     | Multifamily          |
| `retail`          | Retail               |
| `hotel`           | Hotels               |
| `affordable-housing` | Affordable Housing |
| `mixed-use`       | Mixed-use            |

### 2. Region

| Value               | Label                  |
|---------------------|------------------------|
| `""` (empty)        | All regions            |
| `americas`          | Americas               |
| `europe`            | Europe                 |
| `asia-pacific`      | Asia Pacific           |
| `middle-east-africa`| Middle East and Africa |

### 3. Country

| Value             | Label              |
|-------------------|--------------------|
| `""`              | All countries      |
| `united-states`   | United States      |
| `canada`          | Canada             |
| `mexico`          | Mexico             |
| `brazil`          | Brazil             |
| `united-kingdom`  | United Kingdom     |
| `germany`         | Germany            |
| `france`          | France             |
| `spain`           | Spain              |
| `italy`           | Italy              |
| `netherlands`     | Netherlands        |
| `australia`       | Australia          |
| `japan`           | Japan              |
| `china`           | China              |
| `india`           | India              |
| `singapore`       | Singapore          |
| `hong-kong`       | Hong Kong          |
| `uae`             | United Arab Emirates|
| `south-africa`    | South Africa       |

### 4. Market (metros)

| Value           | Label          |
|-----------------|----------------|
| `""`            | All markets    |
| `new-york`      | New York       |
| `los-angeles`   | Los Angeles    |
| `chicago`       | Chicago        |
| `houston`       | Houston        |
| `phoenix`       | Phoenix        |
| `philadelphia`  | Philadelphia   |
| `san-antonio`   | San Antonio    |
| `san-diego`     | San Diego      |
| `dallas`        | Dallas         |
| `san-jose`      | San Jose       |
| `austin`        | Austin         |
| `jacksonville`  | Jacksonville   |
| `fort-worth`    | Fort Worth     |
| `columbus`      | Columbus       |
| `charlotte`     | Charlotte      |
| `san-francisco` | San Francisco  |
| `indianapolis`  | Indianapolis   |
| `seattle`       | Seattle        |
| `denver`        | Denver         |
| `boston`        | Boston         |
| `miami`         | Miami          |
| `nashville`     | Nashville      |
| `detroit`       | Detroit        |
| `portland`      | Portland       |
| `las-vegas`     | Las Vegas      |
| `atlanta`       | Atlanta        |
| `tampa`         | Tampa          |
| `orlando`       | Orlando        |
| `minneapolis`   | Minneapolis    |
| `cleveland`     | Cleveland      |
| `raleigh`       | Raleigh        |
| `sacramento`    | Sacramento     |
| `st-louis`      | St. Louis      |
| `pittsburgh`    | Pittsburgh     |
| `cincinnati`    | Cincinnati     |
| `kansas-city`   | Kansas City    |
| `milwaukee`     | Milwaukee      |
| `baltimore`     | Baltimore      |
| `salt-lake-city`| Salt Lake City |

### 5. Topic (Insights only)

| Value                 | Label                |
|-----------------------|----------------------|
| `""`                  | All topics           |
| `intelligent-investment` | Intelligent Investment |
| `future-cities`       | Future Cities        |
| `adaptive-spaces`     | Adaptive Spaces      |
| `evolving-workforces` | Evolving Workforces  |
| `creating-resilience` | Creating Resilience  |
| `workplace-occupancy` | Workplace & Occupancy|

---

## Differences: Market Reports vs Insights

| Aspect        | Market Reports      | Insights             |
|---------------|---------------------|----------------------|
| Filters       | 4 filters           | 5 filters            |
| Topic filter  | Not present         | Present              |
| URL hash      | `#market-reports`   | `#insights`          |
| Query param   | `topic` not used    | `topic` used in URL  |

**URL format (from `lib/cbre-link-builder.ts`):**

```
https://www.cbre.com/insights?propertyType=office&region=americas&country=united-states&market=miami&topic=intelligent-investment#insights
```

- `topic` is only appended when `tab === "insights"`.

---

## DOM Selectors for Automation

From `scripts/cbre-automate.ts`, the automation script tries these strategies in order:

### 1. By accessible label (Playwright)

```ts
page.getByLabel("Property Type", { exact: false })
page.getByLabel("Region", { exact: false })
page.getByLabel("Country", { exact: false })
page.getByLabel("Market", { exact: false })
page.getByLabel("Topic", { exact: false })
```

### 2. By `name` attribute (partial match)

```ts
page.locator('select[name*="property" i]')
page.locator('select[name*="region" i]')
page.locator('select[name*="country" i]')
page.locator('select[name*="market" i]')
page.locator('select[name*="topic" i]')
```

### 3. By ARIA role (combobox)

```ts
page.getByRole("combobox", { name: /Property Type/i })
page.getByRole("combobox", { name: /Region/i })
// ... etc
// Then: page.getByRole("option", { name: /value with spaces/i })
```

### 4. URL query parameters

Filters can be pre-applied via URL:

- `?propertyType=office`
- `?region=americas`
- `?country=united-states`
- `?market=miami`
- `?topic=intelligent-investment` (Insights only)

---

## Manual Steps to Inspect CBRE Filters

If you need to verify or extend the options directly on CBRE:

1. **Open the page**
   - Go to https://www.cbre.com/insights
   - Wait for the page to fully load (filters are JS-rendered)

2. **Open DevTools**
   - Right-click → Inspect, or `Cmd+Option+I` (Mac) / `F12` (Windows)

3. **Find filter elements**
   - Elements tab → search for `select`, `[role="combobox"]`, or filter-related `button`/`div`
   - Or use Console: `document.querySelectorAll('select, [role="combobox"]')`

4. **Document options**
   - For `<select>`: `Array.from(select.options).map(o => ({ value: o.value, label: o.text }))`
   - For custom dropdowns: expand each filter and inspect the option elements (e.g. `[role="option"]`)

5. **Check URL behavior**
   - Apply filters and observe the URL (query params and hash)
   - Example: `?propertyType=office&region=americas#market-reports`

6. **Compare sections**
   - Click "Market Reports" tab → document filters
   - Click "Insights" tab → document filters (including Topic)

---

## Source Files in This Project

| File                         | Purpose                                      |
|------------------------------|----------------------------------------------|
| `lib/cbre-options.ts`        | Curated filter options (values/labels)       |
| `components/cbre-find-dialog.tsx` | UI for Market Reports vs Insights filters |
| `lib/cbre-link-builder.ts`   | URL construction with query params           |
| `scripts/cbre-automate.ts`   | Playwright automation and selector strategies|

---

## Note on Option Accuracy

The comment in `lib/cbre-options.ts` states: *"Options curated from CRE taxonomy (CBRE does not expose filter API)."* The values above are from your curated set. CBRE may add or change options over time; manual inspection or periodic checks are recommended to keep them in sync.
