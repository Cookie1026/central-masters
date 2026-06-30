import type { Metadata } from 'next'
import { Geist } from 'next/font/google'
import './globals.css'

const geist = Geist({ variable: '--font-geist-sans', subsets: ['latin'] })

export const metadata: Metadata = {
  title: 'セントラルマスターズ 記録検索',
  description: 'セントラルスポーツマスターズフェスティバル水泳大会の記録検索サイト',
}

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="ja" className={`${geist.variable} h-full`}>
      <body className="h-full bg-slate-900 text-slate-100 flex flex-col antialiased">
        <header className="hidden md:block bg-gradient-to-r from-slate-900 via-slate-800 to-slate-900 border-b border-sky-900/50 shadow-lg shrink-0">
          <div className="px-4 py-3 flex items-center min-w-0">
            <span className="font-bold tracking-wide text-sm sm:text-base whitespace-nowrap overflow-hidden text-ellipsis shrink-1 bg-gradient-to-r from-sky-400 via-cyan-300 to-blue-400 bg-clip-text text-transparent">
              セントラルマスターズ 記録検索
            </span>
          </div>
        </header>
        <main className="flex-1 overflow-hidden min-h-0">{children}</main>
        <footer className="shrink-0 text-center text-xs text-slate-600 py-3 border-t border-slate-800">
          セントラルスポーツマスターズフェスティバル水泳大会
        </footer>
      </body>
    </html>
  )
}
