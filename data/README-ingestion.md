# Market Analytics Ingestion (Add-On)

This project includes an additive ingestion subsystem for new Market Analytics signals:
FFIEC call reports, Census residential construction, UCC-1 filings, and foreclosure notices.

## Environment Variables

- `FFIEC_USER_ID` — FFIEC PWS user ID
- `FFIEC_TOKEN` — FFIEC PWS security token (Bearer token)
- `CENSUS_API_KEY` — Census Data API key

## Connector Configuration

Edit `configs/connectors.yaml` to enable connectors and set jurisdictions.
All connectors are disabled by default; the UI will show “Not configured” until enabled and ingested.

## Running Ingestion

Incremental run:

```
python -m app.ingestion.run --mode incremental
```

Backfill run:

```
python -m app.ingestion.run --mode backfill --start YYYY-MM-DD --end YYYY-MM-DD
```

Dry run (no DB writes):

```
python -m app.ingestion.run --mode incremental --dry-run
```

## Data Location

The ingestion subsystem writes to `data/ingestion.sqlite`. Market Analytics reads directly from this
database using server actions.

## UCC & Foreclosures

UCC and foreclosure connectors are scaffolded with Playwright and expected to require manual login.
If blocked, the connector records a “Needs Manual Login” status and exits cleanly.

