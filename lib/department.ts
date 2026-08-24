/**
 * Department preference.
 *
 * The tool serves four groups who arrive with different questions, and the
 * department shapes what it puts in front of them. This deliberately is *not*
 * user identity: there are no accounts, only a single shared password, so a
 * department is all the tool knows and all it needs to know. Anything persisted
 * against a department is therefore shared by everyone in it, which is intended
 * — the team's context survives any one person being away.
 *
 * Read server-side in `app/page.tsx` so the correct view renders immediately.
 * That is why the cookie is not httpOnly: the header selector writes it from
 * the browser, while the server reads it during render.
 */

export const DEPARTMENTS = [
  "underwriting",
  "origination",
  "finance",
  "executive",
] as const

export type Department = (typeof DEPARTMENTS)[number]

/** What each department is called in the interface, and what it is there for. */
export const DEPARTMENT_LABELS: Record<Department, { label: string; blurb: string }> = {
  underwriting: {
    label: "Underwriting",
    blurb: "Institution-level credit analysis and peer comparison",
  },
  origination: {
    label: "Investor Relations & BD",
    blurb: "Who to approach, and why now",
  },
  finance: {
    label: "Accounting & Finance",
    blurb: "Exposure aggregation with traceable sources",
  },
  executive: {
    label: "Executive",
    blurb: "What moved, and what needs a decision",
  },
}

export const DEPARTMENT_COOKIE_NAME = "department"

/**
 * A year, matching the auth cookie, so a choice made once survives.
 *
 * `secure` follows `NODE_ENV` rather than `isProductionDeployment()`. The two
 * differ elsewhere in this codebase for good reason, but the distinction there
 * is about guarding writes to production *data*; here it is about transport,
 * and every deployed environment including preview is HTTPS while local
 * development is not. `NODE_ENV` is the right signal for this one.
 */
export const DEPARTMENT_COOKIE_OPTIONS = {
  httpOnly: false,
  secure: process.env.NODE_ENV === "production",
  sameSite: "lax" as const,
  path: "/",
  maxAge: 60 * 60 * 24 * 365,
}

/**
 * Narrow an untrusted cookie value to a Department.
 *
 * Returns null rather than defaulting to one, because "not chosen" is a real
 * state and guessing would silently put someone in the wrong view.
 */
export function parseDepartment(value: string | undefined | null): Department | null {
  if (!value) return null
  return (DEPARTMENTS as readonly string[]).includes(value) ? (value as Department) : null
}
