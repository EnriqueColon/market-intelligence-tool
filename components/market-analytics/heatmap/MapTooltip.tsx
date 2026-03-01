"use client"

type StateTooltipProps = {
  state: string
  stressAvg: number
  stressP90: number
  highStressCount: number
  bankCount: number
  highStressShare?: number
  topBanks: Array<{ name: string; stressScore: number }>
}

export function StateTooltip({
  state,
  stressAvg,
  stressP90,
  highStressCount,
  bankCount,
  highStressShare,
  topBanks,
}: StateTooltipProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-lg text-sm max-w-[280px]">
      <p className="font-semibold text-slate-900">{state}</p>
      <div className="mt-1 space-y-0.5 text-slate-600">
        <p>Avg stress: {stressAvg.toFixed(1)} | P90: {stressP90.toFixed(1)}</p>
        <p>
          High-stress banks: {highStressCount} / {bankCount}
          {highStressShare != null && (
            <> ({(highStressShare * 100).toFixed(1)}%)</>
          )}
        </p>
      </div>
      {topBanks.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-1">Top 5 stressed</p>
          <ul className="text-xs text-slate-600 space-y-0.5">
            {topBanks.map((b, i) => (
              <li key={i}>
                {b.name}: {b.stressScore.toFixed(1)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

type MetroTooltipProps = {
  cbsaName: string
  stressAvg: number
  stressP90: number
  highStressCount: number
  bankCount: number
  highStressShare?: number
  topBanks: Array<{ name: string; stressScore: number }>
}

export function MetroTooltip({
  cbsaName,
  stressAvg,
  stressP90,
  highStressCount,
  bankCount,
  highStressShare,
  topBanks,
}: MetroTooltipProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-lg text-sm max-w-[280px]">
      <p className="font-semibold text-slate-900">{cbsaName}</p>
      <div className="mt-1 space-y-0.5 text-slate-600">
        <p>Avg stress: {stressAvg.toFixed(1)} | P90: {stressP90.toFixed(1)}</p>
        <p>
          High-stress banks: {highStressCount} / {bankCount}
          {highStressShare != null && (
            <> ({(highStressShare * 100).toFixed(1)}%)</>
          )}
        </p>
      </div>
      {topBanks.length > 0 && (
        <div className="mt-2 pt-2 border-t border-slate-100">
          <p className="text-xs font-medium text-slate-500 mb-1">Top 5 stressed</p>
          <ul className="text-xs text-slate-600 space-y-0.5">
            {topBanks.map((b, i) => (
              <li key={i}>
                {b.name}: {b.stressScore.toFixed(1)}
              </li>
            ))}
          </ul>
        </div>
      )}
    </div>
  )
}

type BankTooltipProps = {
  name: string
  stressScore: number
  creToCapital?: number
  nplRatio: number
  loanLossReserve: number
}

export function BankTooltip({
  name,
  stressScore,
  creToCapital,
  nplRatio,
  loanLossReserve,
}: BankTooltipProps) {
  return (
    <div className="rounded-md border border-slate-200 bg-white px-3 py-2 shadow-lg text-sm max-w-[260px]">
      <p className="font-semibold text-slate-900">{name}</p>
      <p className="text-slate-600 mt-1">Stress score: {stressScore.toFixed(1)}</p>
      <div className="mt-2 pt-2 border-t border-slate-100 text-xs text-slate-600 space-y-0.5">
        <p>CRE/Capital: {creToCapital != null ? `${creToCapital.toFixed(1)}%` : "—"}</p>
        <p>NPL: {((nplRatio ?? 0) * 100).toFixed(2)}%</p>
        <p>Reserve: {((loanLossReserve ?? 0) * 100).toFixed(2)}%</p>
      </div>
    </div>
  )
}
