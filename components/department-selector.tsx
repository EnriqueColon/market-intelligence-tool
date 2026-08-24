"use client"

import { useState } from "react"
import { useRouter } from "next/navigation"
import { Users } from "lucide-react"
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select"
import {
  DEPARTMENTS,
  DEPARTMENT_COOKIE_NAME,
  DEPARTMENT_COOKIE_OPTIONS,
  DEPARTMENT_LABELS,
  type Department,
} from "@/lib/department"

/**
 * Chooses which department the tool is presenting itself to.
 *
 * The value round-trips through a cookie rather than component state so the
 * server can read it during render, which is what keeps the first paint correct
 * instead of flashing one view and replacing it. `router.refresh()` re-runs the
 * server components so the choice takes effect without a full reload.
 */
export function DepartmentSelector({ initial }: { initial: Department | null }) {
  const router = useRouter()
  const [department, setDepartment] = useState<Department | null>(initial)

  const handleChange = (next: string) => {
    const value = next as Department
    setDepartment(value)

    const { maxAge, sameSite, path, secure } = DEPARTMENT_COOKIE_OPTIONS
    const parts = [
      `${DEPARTMENT_COOKIE_NAME}=${encodeURIComponent(value)}`,
      `path=${path}`,
      `max-age=${maxAge}`,
      `samesite=${sameSite}`,
    ]
    if (secure) parts.push("secure")
    document.cookie = parts.join("; ")

    router.refresh()
  }

  return (
    <div className="flex items-center gap-2">
      <Users className="h-4 w-4 text-[#006D95]/70" aria-hidden="true" />
      <Select value={department ?? undefined} onValueChange={handleChange}>
        <SelectTrigger
          className="h-9 w-[220px] border-[#006D95]/30 text-sm"
          aria-label="Select your department"
        >
          <SelectValue placeholder="Choose your department" />
        </SelectTrigger>
        <SelectContent>
          {DEPARTMENTS.map((value) => (
            <SelectItem key={value} value={value}>
              <span className="flex flex-col items-start">
                <span>{DEPARTMENT_LABELS[value].label}</span>
                <span className="text-xs text-slate-500">{DEPARTMENT_LABELS[value].blurb}</span>
              </span>
            </SelectItem>
          ))}
        </SelectContent>
      </Select>
    </div>
  )
}
