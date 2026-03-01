/**
 * Institutional report layout: serif typography, navy/charcoal color scheme.
 * Used for printable Executive Report.
 */
export default function ReportLayout({
  children,
}: {
  children: React.ReactNode
}) {
  return (
    <div
      className="report-mode min-h-screen bg-white"
      style={{
        fontFamily: "Georgia, 'Times New Roman', Times, serif",
        color: "#1e293b",
      }}
    >
      <style>{`
        .report-mode {
          --report-nav: #0f172a;
          --report-charcoal: #334155;
          --report-border: #cbd5e1;
        }
        .report-mode h1, .report-mode h2, .report-mode h3, .report-mode h4 {
          color: var(--report-nav);
          font-weight: 600;
        }
        .report-mode [data-slot="card"],
        .report-mode .border-slate-200 {
          border-color: var(--report-border) !important;
        }
        .report-mode .text-slate-600,
        .report-mode .text-slate-700,
        .report-mode .text-muted-foreground {
          color: var(--report-charcoal) !important;
        }
        .report-mode .text-slate-800 {
          color: var(--report-nav) !important;
        }
        .report-mode table th {
          color: var(--report-nav) !important;
          font-weight: 600;
        }
        .report-mode table td {
          text-align: left;
        }
        .report-mode .text-right {
          text-align: right;
        }
        @media print {
          .report-mode { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
          .break-inside-avoid { break-inside: avoid; page-break-inside: avoid; }
          .report-mode svg.recharts-surface { overflow: visible !important; }
        }
      `}</style>
      {children}
    </div>
  )
}
