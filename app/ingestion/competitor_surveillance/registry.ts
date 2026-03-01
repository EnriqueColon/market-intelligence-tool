import type { Connector } from "./base"
import { secEdgarConnector } from "./connectors/sec_edgar"
import { rssNewsConnector } from "./connectors/rss_news"
import { manualCsvConnector } from "./connectors/manual_csv"
import { aomSyncConnector } from "./connectors/aom_sync"
import { uccSyncConnector } from "./connectors/ucc_sync"
import { foreclosureSyncConnector } from "./connectors/foreclosure_sync"
import { hiringRssConnector } from "./connectors/hiring_rss"

const connectors: Connector[] = [
  secEdgarConnector,
  rssNewsConnector,
  manualCsvConnector,
  aomSyncConnector,
  uccSyncConnector,
  foreclosureSyncConnector,
  hiringRssConnector,
]

export function getConnectors(): Connector[] {
  return connectors
}

export function getConnector(key: string): Connector | undefined {
  return connectors.find((c) => c.key === key)
}
