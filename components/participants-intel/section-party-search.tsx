"use client"

import { useMemo } from "react"
import { Card } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import type { AssignmentRecord, MortgageRecord, PreforeclosureRecord, SearchEntityResult } from "@/lib/participants-intel/types"

type Props = {
  query: string
  onQueryChange: (q: string) => void
  results: SearchEntityResult[]
  selectedEntity: SearchEntityResult | null
  onSelectEntity: (e: SearchEntityResult) => void
  assignments: AssignmentRecord[]
  mortgages: MortgageRecord[]
  preforeclosures: PreforeclosureRecord[]
}

function money(n?: number) {
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 }).format(n || 0)
}

export function SectionPartySearch({
  query,
  onQueryChange,
  results,
  selectedEntity,
  onSelectEntity,
  assignments,
  mortgages,
  preforeclosures,
}: Props) {
  const profile = useMemo(() => {
    if (!selectedEntity) return null
    const n = selectedEntity.name.toLowerCase()
    const recentAssignments = assignments
      .filter((a) => a.assignor.toLowerCase().includes(n) || a.assignee.toLowerCase().includes(n))
      .slice(0, 20)
    const linkedMortgages = mortgages.filter((m) => m.lender.toLowerCase().includes(n) || m.borrower.toLowerCase().includes(n)).slice(0, 20)
    const linkedPreforeclosures = preforeclosures
      .filter((p) => p.plaintiff.toLowerCase().includes(n) || p.defendant.toLowerCase().includes(n) || (p.lender || "").toLowerCase().includes(n))
      .slice(0, 20)

    const linkedLenders = Array.from(
      new Set([
        ...linkedMortgages.map((m) => m.lender).filter(Boolean),
        ...linkedPreforeclosures.map((p) => p.lender || p.plaintiff).filter(Boolean),
      ])
    ).slice(0, 15)

    const associatedEntities = Array.from(
      new Set(
        recentAssignments.flatMap((a) => [a.assignor, a.assignee]).filter((x) => x && !x.toLowerCase().includes(n))
      )
    ).slice(0, 20)

    return {
      recentAssignments,
      linkedMortgages,
      linkedPreforeclosures,
      linkedLenders,
      associatedEntities,
    }
  }, [selectedEntity, assignments, mortgages, preforeclosures])

  return (
    <Card className="p-6 border-slate-200/80 bg-slate-50/30">
      <h3 className="text-base font-semibold text-slate-800">4) Party Search + Lookup / Profile</h3>
      <div className="mt-3 flex gap-2">
        <input
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          className="w-full max-w-md rounded-md border border-slate-300 bg-white px-3 py-2 text-sm"
          placeholder="Search firms, people, lenders…"
        />
      </div>

      <div className="mt-4 grid gap-6 xl:grid-cols-2">
        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Results</h4>
          <Table>
            <TableHeader><TableRow><TableHead>Name</TableHead><TableHead>Type</TableHead><TableHead>Location</TableHead></TableRow></TableHeader>
            <TableBody>
              {results.slice(0, 25).map((r) => (
                <TableRow key={r.id} className="cursor-pointer" onClick={() => onSelectEntity(r)}>
                  <TableCell>{r.name}</TableCell>
                  <TableCell className="uppercase text-xs">{r.type}</TableCell>
                  <TableCell>{r.location || "—"}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
        </div>

        <div>
          <h4 className="text-sm font-semibold text-slate-800 mb-2">Profile Panel</h4>
          {!selectedEntity || !profile ? (
            <p className="text-sm text-slate-600">Select a result to view profile.</p>
          ) : (
            <div className="space-y-4 rounded border border-slate-200 bg-white p-3">
              <div>
                <div className="text-sm font-semibold text-slate-800">{selectedEntity.name}</div>
                <div className="text-xs text-slate-600 uppercase">{selectedEntity.type}</div>
                {selectedEntity.location ? <div className="text-xs text-slate-600">{selectedEntity.location}</div> : null}
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-600">Associated Entities / People</div>
                <div className="text-sm text-slate-700">{profile.associatedEntities.join(", ") || "—"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-600">Linked Lenders</div>
                <div className="text-sm text-slate-700">{profile.linkedLenders.join(", ") || "—"}</div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-600">Recent Transactions</div>
                <div className="space-y-1">
                  {profile.recentAssignments.slice(0, 5).map((a) => (
                    <div key={a.id} className="text-xs text-slate-700">
                      {a.recordingDate}: {a.assignor} → {a.assignee} ({money(a.loanAmount)})
                    </div>
                  ))}
                  {profile.recentAssignments.length === 0 && <div className="text-xs text-slate-600">—</div>}
                </div>
              </div>
              <div>
                <div className="text-xs font-semibold uppercase text-slate-600">Mortgage Activity</div>
                <div className="text-xs text-slate-700">Records: {profile.linkedMortgages.length}</div>
              </div>
            </div>
          )}
        </div>
      </div>
    </Card>
  )
}

