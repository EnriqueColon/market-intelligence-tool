import type { Metadata } from 'next'
import { Montserrat } from 'next/font/google'
import { Analytics } from '@vercel/analytics/next'
import { RejectionHandler } from '@/components/rejection-handler'
import { Toaster } from '@/components/ui/toaster'
import './globals.css'

const montserrat = Montserrat({
  subsets: ["latin"],
  variable: "--font-montserrat",
  display: "swap",
});

export const metadata: Metadata = {
  title: 'Market Intelligence Tool',
  description: 'Created with v0',
  generator: 'v0.app',
}

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode
}>) {
  return (
    <html lang="en" className={montserrat.variable}>
      <body className="font-sans antialiased">
        <RejectionHandler />
        {children}
        <Toaster />
        <Analytics />
      </body>
    </html>
  )
}
