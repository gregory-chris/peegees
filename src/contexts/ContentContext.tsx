import React, { createContext, useContext, useEffect, useState, useCallback } from 'react'
import type { ContentContextType, ContentManifest } from '../types/content'
import { fetchContentManifest, createAbortController } from '../lib/content'

const ContentContext = createContext<ContentContextType | undefined>(undefined)

export function useContent() {
  const context = useContext(ContentContext)
  if (!context) {
    throw new Error('useContent must be used within a ContentProvider')
  }
  return context
}

interface ContentProviderProps {
  children: React.ReactNode
}

export function ContentProvider({ children }: ContentProviderProps) {
  const [manifest, setManifest] = useState<ContentManifest | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const refetch = useCallback(async () => {
    const controller = createAbortController()
    
    try {
      setLoading(true)
      setError(null)
      
      const manifestData = await fetchContentManifest(controller.signal)
      setManifest(manifestData)
    } catch (err) {
      if (err instanceof Error && err.name !== 'AbortError') {
        const errorMessage = err.message || 'Failed to load content'
        setError(errorMessage)
        console.error('Failed to fetch content manifest:', err)
      }
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    const controller = createAbortController()
    
    const loadContent = async () => {
      try {
        setLoading(true)
        setError(null)
        
        const manifestData = await fetchContentManifest(controller.signal)
        setManifest(manifestData)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          const errorMessage = err.message || 'Failed to load content'
          setError(errorMessage)
          console.error('Failed to fetch content manifest:', err)
        }
      } finally {
        setLoading(false)
      }
    }
    
    loadContent()
    
    return () => {
      controller.abort()
    }
  }, [])

  const contextValue: ContentContextType = {
    manifest,
    loading,
    error,
    refetch,
  }

  return (
    <ContentContext.Provider value={contextValue}>
      {children}
    </ContentContext.Provider>
  )
}
