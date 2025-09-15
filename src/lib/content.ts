import type { 
  ContentManifest, 
  Lesson, 
  LessonContent, 
  TOCHeading, 
  LessonCacheEntry,
  FetchStatus 
} from '../types/content'

// Cache keys
const MANIFEST_CACHE_KEY = 'content-manifest'
const LESSON_CACHE_PREFIX = 'lesson-content-'
const CACHE_EXPIRY = 1000 * 60 * 30 // 30 minutes

// Fetch the content manifest
export async function fetchContentManifest(signal?: AbortSignal): Promise<ContentManifest> {
  try {
    // Try to get from session storage first
    const cached = sessionStorage.getItem(MANIFEST_CACHE_KEY)
    if (cached) {
      const parsedCache = JSON.parse(cached)
      if (parsedCache.timestamp && Date.now() - parsedCache.timestamp < CACHE_EXPIRY) {
        return parsedCache.data
      }
    }

    // Fetch from server
    const response = await fetch('/content-manifest.json', { signal })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch manifest: ${response.status} ${response.statusText}`)
    }

    const manifest: ContentManifest = await response.json()
    
    // Cache in session storage
    sessionStorage.setItem(MANIFEST_CACHE_KEY, JSON.stringify({
      data: manifest,
      timestamp: Date.now()
    }))

    return manifest
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    throw new Error(`Failed to load content manifest: ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Fetch lesson markdown content
export async function fetchLessonContent(
  lesson: Lesson, 
  signal?: AbortSignal
): Promise<LessonContent> {
  const cacheKey = `${LESSON_CACHE_PREFIX}${lesson.slug}`
  
  try {
    // Try to get from session storage first
    const cached = sessionStorage.getItem(cacheKey)
    if (cached) {
      const parsedCache: LessonCacheEntry = JSON.parse(cached)
      if (parsedCache.timestamp && Date.now() - parsedCache.timestamp < CACHE_EXPIRY) {
        return {
          markdown: parsedCache.content,
          headings: parsedCache.headings,
        }
      }
    }

    // Fetch from server
    const response = await fetch(lesson.mdPath, { signal })
    
    if (!response.ok) {
      throw new Error(`Failed to fetch lesson content: ${response.status} ${response.statusText}`)
    }

    const markdown = await response.text()
    const headings = extractHeadings(markdown)
    
    // Cache in session storage
    const cacheEntry: LessonCacheEntry = {
      content: markdown,
      timestamp: Date.now(),
      headings
    }
    sessionStorage.setItem(cacheKey, JSON.stringify(cacheEntry))

    return { markdown, headings }
  } catch (error) {
    if (error instanceof Error && error.name === 'AbortError') {
      throw error
    }
    throw new Error(`Failed to load lesson "${lesson.title}": ${error instanceof Error ? error.message : 'Unknown error'}`)
  }
}

// Extract headings from markdown content for TOC
export function extractHeadings(markdown: string): TOCHeading[] {
  const headingRegex = /^(#{2,4})\s+(.+)$/gm
  const headings: TOCHeading[] = []
  let match

  while ((match = headingRegex.exec(markdown)) !== null) {
    const level = match[1].length as 2 | 3 | 4
    const text = match[2].trim()
    const id = generateHeadingId(text)

    headings.push({
      id,
      depth: level,
      text,
    })
  }

  return buildHeadingTree(headings)
}

// Generate heading IDs (similar to what rehype-slug does)
export function generateHeadingId(text: string): string {
  return text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '') // Remove special characters
    .replace(/\s+/g, '-') // Replace spaces with hyphens
    .replace(/-+/g, '-') // Replace multiple hyphens with single
    .replace(/^-|-$/g, '') // Remove leading/trailing hyphens
}

// Build hierarchical heading tree
function buildHeadingTree(headings: TOCHeading[]): TOCHeading[] {
  const root: TOCHeading[] = []
  const stack: TOCHeading[] = []

  for (const heading of headings) {
    // Find the correct parent level
    while (stack.length > 0 && stack[stack.length - 1].depth >= heading.depth) {
      stack.pop()
    }

    if (stack.length === 0) {
      // Top level heading
      root.push(heading)
    } else {
      // Child heading
      const parent = stack[stack.length - 1]
      if (!parent.children) {
        parent.children = []
      }
      parent.children.push(heading)
    }

    stack.push(heading)
  }

  return root
}

// Find lesson by slug
export function findLessonBySlug(manifest: ContentManifest, slug: string): Lesson | undefined {
  return manifest.lessons.find(lesson => lesson.slug === slug)
}

// Get lesson navigation (previous/next)
export function getLessonNavigation(manifest: ContentManifest, currentSlug: string) {
  const currentIndex = manifest.lessons.findIndex(lesson => lesson.slug === currentSlug)
  
  if (currentIndex === -1) {
    return { previous: undefined, next: undefined }
  }

  const previous = currentIndex > 0 
    ? {
        slug: manifest.lessons[currentIndex - 1].slug,
        title: manifest.lessons[currentIndex - 1].title
      }
    : undefined

  const next = currentIndex < manifest.lessons.length - 1
    ? {
        slug: manifest.lessons[currentIndex + 1].slug,
        title: manifest.lessons[currentIndex + 1].title
      }
    : undefined

  return { previous, next }
}

// Clear all cached content
export function clearContentCache(): void {
  const keys = Object.keys(sessionStorage)
  keys.forEach(key => {
    if (key === MANIFEST_CACHE_KEY || key.startsWith(LESSON_CACHE_PREFIX)) {
      sessionStorage.removeItem(key)
    }
  })
}

// Search lessons by title and description
export function searchLessons(lessons: Lesson[], query: string): Lesson[] {
  if (!query.trim()) {
    return lessons
  }

  const searchTerm = query.toLowerCase()
  return lessons.filter(lesson => 
    lesson.title.toLowerCase().includes(searchTerm) ||
    lesson.description.toLowerCase().includes(searchTerm) ||
    lesson.tags?.some(tag => tag.toLowerCase().includes(searchTerm))
  )
}

// Filter lessons by tags
export function filterLessonsByTags(lessons: Lesson[], selectedTags: string[]): Lesson[] {
  if (selectedTags.length === 0) {
    return lessons
  }

  return lessons.filter(lesson => 
    lesson.tags?.some(tag => selectedTags.includes(tag))
  )
}

// Get all unique tags from lessons
export function getAllTags(lessons: Lesson[]): string[] {
  const tags = new Set<string>()
  lessons.forEach(lesson => {
    lesson.tags?.forEach(tag => tags.add(tag))
  })
  return Array.from(tags).sort()
}

// Create abort controller for fetch operations
export function createAbortController(): AbortController {
  const controller = new AbortController()
  
  // Auto-abort after 30 seconds
  setTimeout(() => {
    if (!controller.signal.aborted) {
      controller.abort('Request timeout')
    }
  }, 30000)

  return controller
}

// Custom hook-like function for managing fetch state
export function createFetchState<T>() {
  return {
    data: null as T | null,
    status: 'idle' as FetchStatus,
    error: null as string | null,
  }
}
