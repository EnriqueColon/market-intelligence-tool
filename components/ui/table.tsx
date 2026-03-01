'use client'

import * as React from 'react'

import { cn } from '@/lib/utils'

function Table({
  className,
  stickyHeaders,
  ...props
}: React.ComponentProps<'table'> & { stickyHeaders?: boolean }) {
  const scrollRef = React.useRef<HTMLDivElement>(null)
  const [isDragging, setIsDragging] = React.useState(false)
  const startX = React.useRef(0)
  const scrollLeft = React.useRef(0)

  const handleMouseDown = React.useCallback((e: React.MouseEvent) => {
    if (e.button !== 0) return
    // Don't initiate drag when clicking on a row marked as clickable (e.g. institution profile)
    if (e.target instanceof HTMLElement && e.target.closest('[data-clickable-row]')) return
    const el = scrollRef.current
    if (!el || el.scrollWidth <= el.clientWidth) return
    const rect = el.getBoundingClientRect()
    startX.current = e.clientX - rect.left
    scrollLeft.current = el.scrollLeft
    setIsDragging(true)
  }, [])

  React.useEffect(() => {
    if (!isDragging) return
    const onMove = (e: MouseEvent) => {
      e.preventDefault()
      const el = scrollRef.current
      if (!el) return
      const rect = el.getBoundingClientRect()
      const x = e.clientX - rect.left
      const walk = (x - startX.current) * 1.2
      el.scrollLeft = scrollLeft.current - walk
    }
    const onUp = () => setIsDragging(false)
    window.addEventListener('mousemove', onMove, { passive: false })
    window.addEventListener('mouseup', onUp)
    return () => {
      window.removeEventListener('mousemove', onMove)
      window.removeEventListener('mouseup', onUp)
    }
  }, [isDragging])

  return (
    <div
      ref={scrollRef}
      data-slot="table-container"
      className={cn(
        'relative w-full overflow-x-auto',
        stickyHeaders && 'max-h-[60vh] overflow-y-auto',
        isDragging ? 'cursor-grabbing select-none' : 'cursor-grab'
      )}
      onMouseDown={handleMouseDown}
      style={{ scrollBehavior: isDragging ? 'auto' : undefined }}
    >
      <table
        data-slot="table"
        data-sticky-headers={stickyHeaders ? '' : undefined}
        className={cn('w-full caption-bottom text-sm', className)}
        {...props}
      />
    </div>
  )
}

function TableHeader({ className, ...props }: React.ComponentProps<'thead'>) {
  return (
    <thead
      data-slot="table-header"
      className={cn('[&_tr]:border-b', className)}
      {...props}
    />
  )
}

function TableBody({ className, ...props }: React.ComponentProps<'tbody'>) {
  return (
    <tbody
      data-slot="table-body"
      className={cn('[&_tr:last-child]:border-0', className)}
      {...props}
    />
  )
}

function TableFooter({ className, ...props }: React.ComponentProps<'tfoot'>) {
  return (
    <tfoot
      data-slot="table-footer"
      className={cn(
        'bg-muted/50 border-t font-medium [&>tr]:last:border-b-0',
        className,
      )}
      {...props}
    />
  )
}

function TableRow({ className, ...props }: React.ComponentProps<'tr'>) {
  return (
    <tr
      data-slot="table-row"
      className={cn(
        'hover:bg-muted/50 data-[state=selected]:bg-muted border-b transition-colors',
        className,
      )}
      {...props}
    />
  )
}

function TableHead({ className, ...props }: React.ComponentProps<'th'>) {
  return (
    <th
      data-slot="table-head"
      className={cn(
        'text-foreground h-10 px-2 text-left align-middle font-medium whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCell({ className, ...props }: React.ComponentProps<'td'>) {
  return (
    <td
      data-slot="table-cell"
      className={cn(
        'p-2 align-middle whitespace-nowrap [&:has([role=checkbox])]:pr-0 [&>[role=checkbox]]:translate-y-[2px]',
        className,
      )}
      {...props}
    />
  )
}

function TableCaption({
  className,
  ...props
}: React.ComponentProps<'caption'>) {
  return (
    <caption
      data-slot="table-caption"
      className={cn('text-muted-foreground mt-4 text-sm', className)}
      {...props}
    />
  )
}

export {
  Table,
  TableHeader,
  TableBody,
  TableFooter,
  TableHead,
  TableRow,
  TableCell,
  TableCaption,
}
