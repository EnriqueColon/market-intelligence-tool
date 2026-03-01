# Aligning Find on CBRE with CBRE's Live Filters

This guide explains how to inspect CBRE's Insights and Market Reports pages and update `lib/cbre-options.ts` to match their actual filter options.

---

## Option 1: Manual Inspection (Recommended)

### Step 1: Open CBRE and Load the Page

1. Go to **https://www.cbre.com/insights**
2. Wait for the page to fully load (filters are rendered by JavaScript)
3. Click **"Market Reports"** in the top nav to view that section
4. Click **"Insights"** to view that section

### Step 2: Open Browser DevTools

- **Mac:** `Cmd + Option + I` or right-click → Inspect
- **Windows:** `F12` or right-click → Inspect

### Step 3: Find Filter Elements

In the **Elements** tab, search for:

- `<select>` elements (native dropdowns)
- `[role="combobox"]` (custom dropdowns)
- Elements with labels like "Property Type", "Region", "Country", "Market", "Topic"

Or run in the **Console**:

```javascript
// Find all potential filter controls
document.querySelectorAll('select, [role="combobox"], [data-filter], [aria-label*="filter" i]')
```

### Step 4: Extract Options from Each Filter

**For native `<select>` elements:**

1. In Elements, right-click the `<select>` → Copy → Copy selector
2. In Console, run (replace `YOUR_SELECTOR` with the copied selector):

```javascript
const select = document.querySelector('YOUR_SELECTOR');
Array.from(select.options).map(o => ({ value: o.value, label: o.text.trim() }))
```

**For custom dropdowns (combobox):**

1. Click the filter to open it
2. Inspect the option elements (often `[role="option"]` or list items)
3. Document the text/value of each option

### Step 5: Document Differences

Create a table for each filter:

| Filter        | CBRE Value | CBRE Label | Our Value | Our Label | Match? |
|---------------|------------|------------|-----------|-----------|--------|
| Property Type | ...        | ...        | ...       | ...       | ✓/✗     |

### Step 6: Update `lib/cbre-options.ts`

Edit the constants (`PROPERTY_TYPES`, `REGIONS`, `COUNTRIES`, `MARKET_OPTIONS`, `INSIGHTS_TOPICS`) to match CBRE's values and labels. Use the exact `value` strings CBRE uses in their URLs or DOM—that ensures links and automation work correctly.

---

## Option 2: Browser Console Extraction Script

Paste this into the **Console** on https://www.cbre.com/insights (after the page loads):

```javascript
(function extractCbreFilters() {
  const result = { selects: [], comboboxes: [] };
  
  // Native selects
  document.querySelectorAll('select').forEach((sel, i) => {
    const label = sel.closest('label')?.textContent?.trim() 
      || sel.getAttribute('aria-label') 
      || sel.id 
      || `select-${i}`;
    const options = Array.from(sel.options).map(o => ({ value: o.value, label: o.text.trim() }));
    result.selects.push({ label, options });
  });
  
  // Comboboxes (custom dropdowns)
  document.querySelectorAll('[role="combobox"]').forEach((cb, i) => {
    const label = cb.getAttribute('aria-label') || cb.getAttribute('aria-labelledby') || `combobox-${i}`;
    result.comboboxes.push({ label, element: cb.outerHTML.substring(0, 200) });
  });
  
  console.table(result.selects.flatMap(s => s.options));
  console.log('Full result:', result);
  return result;
})();
```

This logs the options to the console. Copy the output and compare with `lib/cbre-options.ts`.

---

## Option 3: Use Cursor in Agent Mode with Browser MCP

If the **cursor-ide-browser** MCP is enabled in Cursor:

1. Switch to **Agent mode** (not Ask mode)
2. Ask: *"Navigate to https://www.cbre.com/insights, take a browser snapshot, and document all filter options for Market Reports and Insights"*
3. The AI can use `browser_navigate`, `browser_snapshot`, and `browser_click` to inspect the page and return the filter structure

---

## Option 4: URL Parameter Testing

CBRE may support URL query params for pre-filtering. Test by manually editing the URL:

```
https://www.cbre.com/insights?propertyType=office&region=americas&country=united-states&market=miami#market-reports
```

1. Open that URL
2. Check if the filters are pre-selected
3. If yes, note the exact param names and values CBRE uses
4. Update `lib/cbre-link-builder.ts` to use those param names/values

---

## Files to Update After Inspection

| File | What to update |
|------|----------------|
| `lib/cbre-options.ts` | `PROPERTY_TYPES`, `REGIONS`, `COUNTRIES`, `MARKET_OPTIONS`, `INSIGHTS_TOPICS` |
| `lib/cbre-link-builder.ts` | Query param names if CBRE uses different ones |
| `scripts/cbre-automate.ts` | Selectors in `tryApplyFilters()` if DOM structure differs |

---

## Checklist

- [ ] Inspected Market Reports section filters
- [ ] Inspected Insights section filters (including Topic)
- [ ] Documented option values and labels for each filter
- [ ] Noted any filters present on one section but not the other
- [ ] Tested URL params (if applicable)
- [ ] Updated `lib/cbre-options.ts` with CBRE's exact values
- [ ] Re-tested Find on CBRE dialog and generated links
