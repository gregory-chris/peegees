// Content types for the PostgreSQL course website

export interface Course {
  title: string
  tagline: string
  description: string
  coverImage: string
}

export interface Lesson {
  order: number
  slug: string
  title: string
  description: string
  mdPath: string
  ogImage?: string
  estReadMinutes?: number
  tags?: string[]
}

export interface ContentManifest {
  course: Course
  lessons: Lesson[]
}

export interface TOCHeading {
  id: string
  depth: 2 | 3 | 4
  text: string
  children?: TOCHeading[]
}

export interface LessonContent {
  markdown: string
  headings: TOCHeading[]
  frontmatter?: Record<string, unknown>
}

export interface LessonNavigation {
  previous?: {
    slug: string
    title: string
  }
  next?: {
    slug: string
    title: string
  }
}

export interface SEOMetadata {
  title: string
  description: string
  canonicalUrl: string
  ogImage: string
  ogType?: 'website' | 'article'
  twitterCard?: 'summary' | 'summary_large_image'
  publishedTime?: string
  modifiedTime?: string
  tags?: string[]
}

export interface ThemeContextType {
  theme: 'light' | 'dark' | 'system'
  setTheme: (theme: 'light' | 'dark' | 'system') => void
  resolvedTheme: 'light' | 'dark'
}

export interface ContentContextType {
  manifest: ContentManifest | null
  loading: boolean
  error: string | null
  refetch: () => Promise<void>
}

export interface LessonCacheEntry {
  content: string
  timestamp: number
  headings: TOCHeading[]
}

export interface AnalyticsEvent {
  name: string
  properties?: Record<string, unknown>
}

export interface ErrorBoundaryState {
  hasError: boolean
  error?: Error
  errorInfo?: import('react').ErrorInfo
}

// Component prop types
export interface LessonCardProps {
  lesson: Lesson
  index: number
}

export interface MarkdownRendererProps {
  markdown: string
  className?: string
}

export interface TOCProps {
  headings: TOCHeading[]
  activeId?: string
  className?: string
}

export interface ShareButtonsProps {
  title: string
  url: string
  description?: string
}

export interface LayoutProps {
  children: import('react').ReactNode
}

export interface SiteHeaderProps {
  className?: string
}

export interface SiteFooterProps {
  className?: string
}

export interface ContainerProps {
  children: import('react').ReactNode
  className?: string
  size?: 'sm' | 'md' | 'lg' | 'xl' | 'full'
}

export interface LoadingSpinnerProps {
  size?: 'sm' | 'md' | 'lg'
  className?: string
}

export interface ErrorMessageProps {
  error?: string | Error
  onRetry?: () => void
  className?: string
}

export interface SearchFiltersProps {
  lessons: Lesson[]
  onFilter: (filtered: Lesson[]) => void
  className?: string
}

// Utility types
export type FetchStatus = 'idle' | 'loading' | 'success' | 'error'

export type Theme = 'light' | 'dark' | 'system'

export type AnalyticsProvider = 'plausible' | 'ga4' | 'none'

// Environment variables
export interface ImportMetaEnv {
  readonly VITE_SITE_URL: string
  readonly VITE_ANALYTICS: AnalyticsProvider
  readonly VITE_PLAUSIBLE_DOMAIN?: string
  readonly VITE_GA4_MEASUREMENT_ID?: string
  readonly VITE_APP_VERSION: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
