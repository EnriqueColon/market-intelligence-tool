"use client"

import { useMemo } from "react"
import type { ManagerRaises } from "@/lib/peer-intel/cohort"
import { money, percent } from "@/lib/peer-intel/panel"
import { buildPeopleIndex, managerPeople, sharedPeople, type ManagerPerson } from "@/lib/peer-intel/people"
import { formationLine, structureRows, type StructureRow } from "@/lib/peer-intel/structure"

/**
 * One fund's structure, terms and people, opened in place from its row in the
 * drawer's Raises table — so a reader who clicks a fund sees what sits behind
 * it without scrolling to another card.
 *
 * Everything comes from the parts of Form D the raise figures do not use. Each
 * line is a field as filed or a stated derivation, all catalogued in
 * `lib/peer-intel/catalog.ts`, and the filer's own notes are quoted rather than
 * paraphrased, because that is where the useful detail sits: a placement agent
 * dropped, a minimum the GP may waive, how the management fee is charged.
 */

function Line({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="grid grid-cols-[8.5rem_1fr] gap-x-3 py-0.5 text-xs">
      <div className="text-slate-500">{label}</div>
      <div className="text-slate-700">{children}</div>
    </div>
  )
}

function Quote({ children }: { children: React.ReactNode }) {
  return <span className="text-slate-500">&ldquo;{children}&rdquo;</span>
}

function Heading({ children }: { children: React.ReactNode }) {
  return <div className="mb-1 text-[10px] font-semibold uppercase tracking-wide text-slate-500">{children}</div>
}

function fee(amount: number | null, estimate: boolean): string {
  if (amount == null) return "not reported"
  if (amount === 0) return "none"
  return `${money(amount)}${estimate ? " (estimate)" : ""}`
}

function Structure({ row, target }: { row: StructureRow; target: number | "indefinite" | null }) {
  const t = row.terms
  return (
    <div>
      <div className="mb-1 text-[11px] text-slate-500">
        {formationLine(t, row.jurisdiction)}
        {t.moreThanOneYear != null && ` · offering expected to run ${t.moreThanOneYear ? "more" : "less"} than a year`}
      </div>

      <Line label="Exemptions">
        {row.exemptions.length === 0
          ? "not reported"
          : row.exemptions.map((e, i) => (
              <span key={e.code}>
                {i > 0 && "; "}
                <strong className="font-medium">{e.label}</strong> — {e.meaning}
              </span>
            ))}
        {row.exemptionChanges.map((ch) => (
          <div key={ch.filedAt} className="text-amber-800">
            Changed {ch.filedAt}:{ch.added.length > 0 && ` added ${ch.added.map((e) => e.label).join(", ")}`}
            {ch.added.length > 0 && ch.removed.length > 0 && ";"}
            {ch.removed.length > 0 && ` dropped ${ch.removed.map((e) => e.label).join(", ")}`}
          </div>
        ))}
      </Line>

      <Line label="Securities">
        {row.securities.length ? row.securities.join(", ") : "not reported"}
        {t.securitiesOther && (
          <div>
            <Quote>{t.securitiesOther}</Quote>
          </div>
        )}
      </Line>

      <Line label="Minimum">
        {row.minimum == null ? "not reported" : row.minimum === 0 ? "none stated" : money(row.minimum)}
        {row.minimumChanges.map((c) => (
          <div key={c.filedAt} className="text-amber-800">
            {c.from != null && c.to != null && c.to < c.from ? "Lowered" : "Changed"} from{" "}
            {c.from === 0 ? "none stated" : money(c.from)} to {c.to === 0 ? "none stated" : money(c.to)} on {c.filedAt}
          </div>
        ))}
      </Line>

      <Line label="Sales commissions">
        {fee(t.salesCommissions.amount, t.salesCommissions.estimate)}
        {row.commissionShare != null && typeof target === "number" && (
          <span className="text-slate-500"> — {percent(row.commissionShare, 2)} of the {money(target)} offering</span>
        )}
        {(t.findersFees.amount ?? 0) > 0 && <div>Finder&apos;s fees {fee(t.findersFees.amount, t.findersFees.estimate)}</div>}
        {t.feesClarification && (
          <div>
            <Quote>{t.feesClarification}</Quote>
          </div>
        )}
      </Line>

      {((t.proceedsToInsiders.amount ?? 0) > 0 || t.proceedsClarification) && (
        <Line label="Paid to insiders">
          {fee(t.proceedsToInsiders.amount, t.proceedsToInsiders.estimate)}
          {t.proceedsClarification && (
            <div>
              <Quote>{t.proceedsClarification}</Quote>
            </div>
          )}
        </Line>
      )}

      {row.coIssuers.length > 0 && (
        <Line label="Files jointly with">
          {row.coIssuers.map((c) => (
            <div key={c.cik}>
              {c.name}
              <span className="text-slate-500">
                {" "}
                — {formationLine({ ...t, entityType: c.entityType, yearOfInc: c.yearOfInc, formedOverFiveYearsAgo: false }, c.jurisdiction)}
                {c.firstSeen && ` · first listed ${c.firstSeen}`}
                {c.tracking === "untracked" ? " · not tracked separately" : ` · also tracked as ${c.trackedAs}`}
              </span>
              {c.doubleCounted && (
                <div className="text-amber-800">
                  Its own trail carries this same filing, so its capital is counted twice in the manager&apos;s total.
                </div>
              )}
            </div>
          ))}
        </Line>
      )}
    </div>
  )
}

function PeopleList({ people }: { people: ManagerPerson[] }) {
  if (people.length === 0) return <p className="text-xs text-slate-600">No related persons are listed on this fund&apos;s filing.</p>
  return (
    <ul className="space-y-1">
      {people.map((p) => (
        <li key={`${p.kind}:${p.name}`} className="text-xs text-slate-700">
          <span className="font-medium text-slate-800">{p.name}</span>
          {p.kind === "entity" && (
            <span className="ml-1.5 rounded border border-slate-200 bg-white px-1 py-px text-[10px] text-slate-500">entity</span>
          )}
          <span className="text-slate-500"> — {p.roles.join(", ") || "role not stated"}</span>
          {p.clarifications.map((c) => (
            <div key={c} className="pl-3">
              <Quote>{c}</Quote>
            </div>
          ))}
          {p.elsewhere.map((o) => (
            <div key={o.peerId} className="pl-3 text-[#006D95]">
              Same name at {o.manager} — {o.roles.join(", ") || "role not stated"} · {o.vehicles.join(", ")}{" "}
              <span className="text-slate-400">(name match)</span>
            </div>
          ))}
        </li>
      ))}
    </ul>
  )
}

/**
 * The expanded content of one fund's row: structure and terms beside its
 * people. People are this fund's only, with any same-name match elsewhere in
 * the layer; the manager-wide list is the union of its rows.
 */
export function FundDetail({
  manager,
  cik,
  allManagers,
}: {
  manager: ManagerRaises
  cik: string
  allManagers: readonly ManagerRaises[]
}) {
  const vehicle = manager.raises.find((r) => r.cik === cik)
  const index = useMemo(() => buildPeopleIndex(allManagers), [allManagers])
  const row = useMemo(
    () => (vehicle ? structureRows({ ...manager, raises: [vehicle] }, allManagers)[0] ?? null : null),
    [manager, vehicle, allManagers]
  )
  const people = useMemo(
    () => (vehicle ? managerPeople({ ...manager, raises: [vehicle] }, index) : []),
    [manager, vehicle, index]
  )
  if (!vehicle) return null

  return (
    <div className="grid gap-4 md:grid-cols-[3fr_2fr]">
      <div>
        <Heading>Structure &amp; terms</Heading>
        {row ? (
          <Structure row={row} target={vehicle.raise.target} />
        ) : (
          <p className="text-xs text-slate-600">
            Not yet read for this fund — it appears after the next refresh of this layer.
          </p>
        )}
      </div>
      <div>
        <Heading>People</Heading>
        <PeopleList people={people} />
      </div>
    </div>
  )
}

/** The explanation for every expanded row, said once under the table. */
export function FundDetailNote({ allManagers }: { allManagers: readonly ManagerRaises[] }) {
  const shared = useMemo(() => sharedPeople(buildPeopleIndex(allManagers)).length, [allManagers])
  return (
    <p className="mt-2 text-[11px] leading-snug text-slate-500">
      Click a fund for its structure, terms and people, from its newest Form D, self-reported. A filing made jointly
      with other issuers reports the offering as a whole, so a co-issuer&apos;s capital is already inside the figures
      above; commissions are paid or expected for the whole offering. People are the issuer&apos;s executive officers,
      directors and promoters — usually the GP&apos;s principals and the GP and manager entities, not the whole team and
      never investors. Names are compared across managers by exact match only, because Form D carries no identifier for
      a person, and a person filed under two forms of their name is not merged.{" "}
      {shared === 0
        ? "No name in this layer appears at more than one manager."
        : `${shared} ${shared === 1 ? "name appears" : "names appear"} at more than one manager in this layer.`}
    </p>
  )
}
