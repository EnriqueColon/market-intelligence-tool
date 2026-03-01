"use client"

import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card"
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table"
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"
import { Button } from "@/components/ui/button"
import { useEffect, useState, useMemo } from "react"
import { fetchFDICFinancialsCached } from "@/lib/fdic-client-cache"
import { BankFinancialData } from "@/lib/fdic-data-transformer"
import { Download, ArrowUpDown } from "lucide-react"
import { Skeleton } from "@/components/ui/skeleton"

interface CRELoanTrackerProps {
  defaultState?: string
}

type SortField = keyof BankFinancialData | 'creConcentration'
type SortDirection = 'asc' | 'desc'

export function CRELoanTracker({ defaultState = "Florida" }: CRELoanTrackerProps) {
  const [loading, setLoading] = useState(true)
  const [data, setData] = useState<BankFinancialData[]>([])
  const [selectedState, setSelectedState] = useState(defaultState)
  const [sortField, setSortField] = useState<SortField>('totalAssets')
  const [sortDirection, setSortDirection] = useState<SortDirection>('desc')
  const [pageSize, setPageSize] = useState(25)
  const [currentPage, setCurrentPage] = useState(1)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function loadData() {
      setLoading(true)
      setError(null)
      try {
        const result = await fetchFDICFinancialsCached(selectedState, 100)
        if (result.error) {
          setError(result.error)
        } else {
          setData(result.data)
        }
      } catch (err) {
        setError(err instanceof Error ? err.message : "Failed to load data")
      } finally {
        setLoading(false)
      }
    }
    loadData()
  }, [selectedState])

  const sortedData = useMemo(() => {
    const sorted = [...data].sort((a, b) => {
      let aVal: any = a[sortField]
      let bVal: any = b[sortField]
      
      if (sortField === 'creConcentration') {
        aVal = a.creConcentration
        bVal = b.creConcentration
      }
      
      if (typeof aVal === 'string') {
        return sortDirection === 'asc'
          ? aVal.localeCompare(bVal as string)
          : (bVal as string).localeCompare(aVal)
      }
      
      if (sortDirection === 'asc') {
        return (aVal || 0) - (bVal || 0)
      }
      return (bVal || 0) - (aVal || 0)
    })
    return sorted
  }, [data, sortField, sortDirection])

  const paginatedData = useMemo(() => {
    const start = (currentPage - 1) * pageSize
    return sortedData.slice(start, start + pageSize)
  }, [sortedData, currentPage, pageSize])

  const totalPages = Math.ceil(sortedData.length / pageSize)

  const handleSort = (field: SortField) => {
    if (sortField === field) {
      setSortDirection(sortDirection === 'asc' ? 'desc' : 'asc')
    } else {
      setSortField(field)
      setSortDirection('desc')
    }
    setCurrentPage(1)
  }

  const formatCurrency = (value: number) => {
    if (value >= 1e9) return `$${(value / 1e9).toFixed(2)}B`
    if (value >= 1e6) return `$${(value / 1e6).toFixed(2)}M`
    if (value >= 1e3) return `$${(value / 1e3).toFixed(2)}K`
    return `$${value.toLocaleString()}`
  }

  const exportToCSV = () => {
    const headers = ['Bank Name', 'City', 'State', 'Total Assets', 'CRE Loans', 'CRE/Loans %', 'NPL Ratio', 'Noncurrent/Loans %', 'Noncurrent/Assets %', 'ROA']
    const rows = sortedData.map(bank => [
      bank.name,
      bank.city || '',
      bank.state || '',
      bank.totalAssets.toLocaleString(),
      bank.creLoans.toLocaleString(),
      bank.creConcentration.toFixed(2),
      ((bank.nplRatio ?? 0) * 100).toFixed(2),
      ((bank.noncurrent_to_loans_ratio ?? 0) * 100).toFixed(2),
      ((bank.noncurrent_to_assets_ratio ?? 0) * 100).toFixed(2),
      bank.roa.toFixed(2),
    ])
    
    const csvContent = [
      headers.join(','),
      ...rows.map(row => row.map(cell => `"${cell}"`).join(','))
    ].join('\n')
    
    const blob = new Blob([csvContent], { type: 'text/csv' })
    const url = window.URL.createObjectURL(blob)
    const a = document.createElement('a')
    a.href = url
    a.download = `fdic-cre-loans-${selectedState}-${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    window.URL.revokeObjectURL(url)
  }

  const SortButton = ({ field, children }: { field: SortField; children: React.ReactNode }) => (
    <button
      onClick={() => handleSort(field)}
      className="flex items-center gap-1 hover:text-primary transition-colors"
    >
      {children}
      <ArrowUpDown className="h-3 w-3" />
    </button>
  )

  if (loading) {
    return (
      <Card>
        <CardHeader>
          <Skeleton className="h-6 w-48" />
          <Skeleton className="h-4 w-64 mt-2" />
        </CardHeader>
        <CardContent>
          <div className="space-y-2">
            {[...Array(5)].map((_, i) => (
              <Skeleton key={i} className="h-12 w-full" />
            ))}
          </div>
        </CardContent>
      </Card>
    )
  }

  if (error) {
    return (
      <Card>
        <CardContent className="pt-6">
          <div className="text-center text-muted-foreground">
            {error}
          </div>
        </CardContent>
      </Card>
    )
  }

  return (
    <Card>
      <CardHeader>
        <div className="flex items-start justify-between">
          <div>
            <CardTitle>CRE Loan Performance Tracker</CardTitle>
            <CardDescription>
              Commercial real estate loan data for {selectedState} banks
            </CardDescription>
          </div>
          <div className="flex items-center gap-2">
            <Select value={selectedState} onValueChange={setSelectedState}>
              <SelectTrigger className="w-[140px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="Florida">Florida</SelectItem>
                <SelectItem value="Georgia">Georgia</SelectItem>
                <SelectItem value="Texas">Texas</SelectItem>
                <SelectItem value="California">California</SelectItem>
                <SelectItem value="New York">New York</SelectItem>
              </SelectContent>
            </Select>
            <Button variant="outline" size="sm" onClick={exportToCSV}>
              <Download className="h-4 w-4 mr-2" />
              Export CSV
            </Button>
          </div>
        </div>
      </CardHeader>
      <CardContent>
        <div className="rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>
                  <SortButton field="name">Bank Name</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="totalAssets">Total Assets</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="creLoans">CRE Loans</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="creConcentration">CRE/Loans %</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="nplRatio">NPL Ratio</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="noncurrent_to_loans_ratio">Noncurrent/Loans</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="noncurrent_to_assets_ratio">Noncurrent/Assets</SortButton>
                </TableHead>
                <TableHead>
                  <SortButton field="roa">ROA</SortButton>
                </TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {paginatedData.length === 0 ? (
                <TableRow>
                  <TableCell colSpan={9} className="text-center text-muted-foreground py-8">
                    No data available
                  </TableCell>
                </TableRow>
              ) : (
                paginatedData.map((bank) => (
                  <TableRow key={bank.id}>
                    <TableCell className="font-medium">{bank.name}</TableCell>
                    <TableCell>{formatCurrency(bank.totalAssets)}</TableCell>
                    <TableCell>{formatCurrency(bank.creLoans)}</TableCell>
                    <TableCell>
                      <span
                        className={
                          bank.creConcentration > 300
                            ? "text-red-500 font-medium"
                            : bank.creConcentration > 200
                            ? "text-yellow-500"
                            : "text-foreground"
                        }
                      >
                        {bank.creConcentration.toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell>
                      <span
                        className={
                          (bank.nplRatio ?? 0) * 100 > 3
                            ? "text-red-500 font-medium"
                            : (bank.nplRatio ?? 0) * 100 > 1.5
                            ? "text-yellow-500"
                            : "text-foreground"
                        }
                      >
                        {((bank.nplRatio ?? 0) * 100).toFixed(2)}%
                      </span>
                    </TableCell>
                    <TableCell>{((bank.noncurrent_to_loans_ratio ?? 0) * 100).toFixed(2)}%</TableCell>
                    <TableCell>{((bank.noncurrent_to_assets_ratio ?? 0) * 100).toFixed(2)}%</TableCell>
                    <TableCell
                      className={
                        bank.roa > 1
                          ? "text-green-500"
                          : bank.roa > 0
                          ? "text-yellow-500"
                          : "text-red-500"
                      }
                    >
                      {bank.roa.toFixed(2)}%
                    </TableCell>
                  </TableRow>
                ))
              )}
            </TableBody>
          </Table>
        </div>
        
        <div className="flex items-center justify-between mt-4">
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted-foreground">Rows per page:</span>
            <Select
              value={pageSize.toString()}
              onValueChange={(value) => {
                setPageSize(Number(value))
                setCurrentPage(1)
              }}
            >
              <SelectTrigger className="w-[80px]">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="25">25</SelectItem>
                <SelectItem value="50">50</SelectItem>
                <SelectItem value="100">100</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="flex items-center gap-2">
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.max(1, p - 1))}
              disabled={currentPage === 1}
            >
              Previous
            </Button>
            <span className="text-sm text-muted-foreground">
              Page {currentPage} of {totalPages}
            </span>
            <Button
              variant="outline"
              size="sm"
              onClick={() => setCurrentPage(p => Math.min(totalPages, p + 1))}
              disabled={currentPage === totalPages}
            >
              Next
            </Button>
          </div>
        </div>
      </CardContent>
    </Card>
  )
}

