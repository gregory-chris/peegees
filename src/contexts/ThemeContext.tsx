import React, { createContext, useContext, useEffect, useState } from 'react'
import type { ThemeContextType, Theme } from '../types/content'
import { trackThemeToggle } from '../lib/analytics'

const ThemeContext = createContext<ThemeContextType | undefined>(undefined)

export function useTheme() {
  const context = useContext(ThemeContext)
  if (!context) {
    throw new Error('useTheme must be used within a ThemeProvider')
  }
  return context
}

interface ThemeProviderProps {
  children: React.ReactNode
}

function getSystemTheme(): 'light' | 'dark' {
  if (typeof window === 'undefined') return 'light'
  return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light'
}

function getStoredTheme(): Theme {
  if (typeof window === 'undefined') return 'system'
  try {
    const stored = localStorage.getItem('theme') as Theme
    if (stored && ['light', 'dark', 'system'].includes(stored)) {
      return stored
    }
  } catch {
    // Ignore localStorage errors
  }
  return 'system'
}

function applyTheme(resolvedTheme: 'light' | 'dark') {
  const root = document.documentElement
  
  if (resolvedTheme === 'dark') {
    root.setAttribute('data-theme', 'dark')
    root.classList.add('dark')
  } else {
    root.setAttribute('data-theme', 'light')
    root.classList.remove('dark')
  }
}

export function ThemeProvider({ children }: ThemeProviderProps) {
  const [theme, setThemeState] = useState<Theme>(() => getStoredTheme())
  const [resolvedTheme, setResolvedTheme] = useState<'light' | 'dark'>(() => {
    const stored = getStoredTheme()
    return stored === 'system' ? getSystemTheme() : stored
  })

  const setTheme = (newTheme: Theme) => {
    setThemeState(newTheme)
    
    // Store in localStorage
    try {
      localStorage.setItem('theme', newTheme)
    } catch {
      // Ignore localStorage errors
    }

    // Resolve the actual theme to apply
    const resolved = newTheme === 'system' ? getSystemTheme() : newTheme
    setResolvedTheme(resolved)
    applyTheme(resolved)

    // Track theme change
    trackThemeToggle(resolved)
  }

  useEffect(() => {
    // Apply initial theme
    applyTheme(resolvedTheme)
  }, [resolvedTheme])

  useEffect(() => {
    // Listen for system theme changes when using system theme
    if (theme !== 'system') return

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
    
    const handleChange = (e: MediaQueryListEvent) => {
      const newSystemTheme = e.matches ? 'dark' : 'light'
      setResolvedTheme(newSystemTheme)
      applyTheme(newSystemTheme)
    }

    mediaQuery.addEventListener('change', handleChange)
    return () => mediaQuery.removeEventListener('change', handleChange)
  }, [theme])

  const contextValue: ThemeContextType = {
    theme,
    setTheme,
    resolvedTheme,
  }

  return (
    <ThemeContext.Provider value={contextValue}>
      {children}
    </ThemeContext.Provider>
  )
}
