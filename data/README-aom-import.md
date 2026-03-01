## AOM (Assignments of Mortgage) import

This project can consolidate your Miami-Dade AOM files into a single SQLite database.

### Option A (recommended): export the 13 Numbers files to CSV

In Numbers, open each sheet and export as **CSV**.

Place the exported files into:

- `data/aom-source/`

### Option B: batch-convert Numbers -> CSV (script)

If your files in `data/aom-source/` are iWork/Numbers documents (often misnamed as `.csv` but actually zip-based),
run:

```bash
python3 scripts/convert_numbers_to_csv.py --input "data/aom-source" --output "data/aom-csv"
```

Then move (or point the importer) to `data/aom-csv/`.

### 2) Build the SQLite database

Run:

```bash
python3 scripts/import_aom_to_sqlite.py --input "data/aom-csv"
```

This creates/updates:

- `data/aom.sqlite`

### Notes

- CSV/TSV only (no direct `.numbers` parsing).
- The importer is resilient to missing columns; it stores every raw row in `raw_json`.
- Core table name: `aom_events`

