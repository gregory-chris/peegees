import type { LayoutProps } from '../../types/content'
import SiteHeader from './SiteHeader'
import SiteFooter from './SiteFooter'

export default function Layout({ children }: LayoutProps) {
  return (
    <div className="min-h-screen flex flex-col bg-white dark:bg-gray-900 text-gray-900 dark:text-gray-100">
      {/* Skip to content link for accessibility */}
      <a
        href="#main-content"
        className="skip-link sr-only focus:not-sr-only focus:absolute focus:top-6 focus:left-6 bg-blue-600 text-white px-4 py-2 rounded-md z-50 font-medium"
      >
        Skip to main content
      </a>

      <SiteHeader />
      
      <main 
        id="main-content" 
        className="flex-1 focus:outline-none"
        tabIndex={-1}
      >
        {children}
      </main>
      
      <SiteFooter />
    </div>
  )
}
