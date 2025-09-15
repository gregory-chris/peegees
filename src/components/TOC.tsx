import { useEffect, useState } from 'react'
import { cn, scrollToElement } from '../lib/utils'
import type { TOCProps, TOCHeading } from '../types/content'

export default function TOC({ headings, activeId, className }: TOCProps) {
  const [activeHeading, setActiveHeading] = useState<string>(activeId || '')

  useEffect(() => {
    if (!headings.length) return

    const observerOptions = {
      rootMargin: '-20% 0% -35% 0%',
      threshold: 0
    }

    const headingElements = headings.map(heading => 
      document.getElementById(heading.id)
    ).filter(Boolean) as HTMLElement[]

    if (headingElements.length === 0) return

    const observer = new IntersectionObserver((entries) => {
      const visibleEntries = entries.filter(entry => entry.isIntersecting)
      
      if (visibleEntries.length > 0) {
        // Find the topmost visible heading
        const topEntry = visibleEntries.reduce((top, entry) => {
          return entry.boundingClientRect.top < top.boundingClientRect.top ? entry : top
        })
        
        setActiveHeading(topEntry.target.id)
      }
    }, observerOptions)

    headingElements.forEach(element => {
      observer.observe(element)
    })

    return () => {
      headingElements.forEach(element => {
        observer.unobserve(element)
      })
    }
  }, [headings])

  const handleClick = (headingId: string) => {
    scrollToElement(headingId, 80) // Offset for sticky header
    setActiveHeading(headingId)
    
    // Update URL without triggering navigation
    const url = new URL(window.location.href)
    url.hash = headingId
    window.history.replaceState({}, '', url.toString())
  }

  const renderHeading = (heading: TOCHeading) => {
    const isActive = activeHeading === heading.id
    const depthClasses = {
      2: 'pl-0 text-base font-medium',
      3: 'pl-4 text-sm',
      4: 'pl-8 text-sm',
    }

    return (
      <li key={heading.id}>
        <button
          onClick={() => handleClick(heading.id)}
          className={cn(
            'block w-full text-left py-1 px-2 rounded transition-colors duration-200 hover:bg-gray-100 dark:hover:bg-gray-800 focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2',
            depthClasses[heading.depth],
            isActive 
              ? 'text-blue-600 dark:text-blue-400 bg-blue-50 dark:bg-blue-900/20 font-medium' 
              : 'text-gray-700 dark:text-gray-300'
          )}
          title={heading.text}
        >
          <span className="truncate block">{heading.text}</span>
        </button>
        
        {heading.children && heading.children.length > 0 && (
          <ul className="mt-1">
            {heading.children.map(child => renderHeading(child))}
          </ul>
        )}
      </li>
    )
  }

  if (!headings.length) {
    return (
      <div className={cn('text-sm text-gray-500 dark:text-gray-400 p-4', className)}>
        No headings found in this lesson.
      </div>
    )
  }

  return (
    <nav className={cn('space-y-1', className)} aria-label="Table of contents">
      <div className="text-sm font-semibold text-gray-900 dark:text-white mb-3 px-2">
        Table of Contents
      </div>
      <ul className="space-y-1">
        {headings.map(heading => renderHeading(heading))}
      </ul>
    </nav>
  )
}
