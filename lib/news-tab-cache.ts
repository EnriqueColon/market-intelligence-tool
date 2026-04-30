/** Shared calendar day (US Eastern) for News tab data cache keys — all users get the same bucket per day. */
export function newsCalendarDayET(): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/New_York",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date())
}

/** How long Next.js Data Cache keeps News tab fetches; still scoped by calendar day in cache tags. */
export const NEWS_TAB_REVALIDATE_SECONDS = 3600
