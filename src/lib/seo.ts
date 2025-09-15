import type { SEOMetadata, ContentManifest, Lesson } from '../types/content'

// Get site URL from environment or fallback
function getSiteUrl(): string {
  return import.meta.env.VITE_SITE_URL || 'http://localhost:5173'
}

// Generate canonical URL
export function generateCanonicalUrl(path: string): string {
  const siteUrl = getSiteUrl()
  return `${siteUrl}${path.startsWith('/') ? path : `/${path}`}`
}

// Generate SEO metadata for the home page
export function generateHomeSEO(manifest: ContentManifest): SEOMetadata {
  const siteUrl = getSiteUrl()
  
  return {
    title: manifest.course.title,
    description: manifest.course.description,
    canonicalUrl: generateCanonicalUrl('/'),
    ogImage: `${siteUrl}${manifest.course.coverImage}`,
    ogType: 'website',
    twitterCard: 'summary_large_image',
  }
}

// Generate SEO metadata for a lesson page
export function generateLessonSEO(lesson: Lesson, manifest: ContentManifest): SEOMetadata {
  const siteUrl = getSiteUrl()
  const title = `${lesson.title} – ${manifest.course.title}`
  
  return {
    title,
    description: lesson.description,
    canonicalUrl: generateCanonicalUrl(`/lesson/${lesson.slug}`),
    ogImage: lesson.ogImage 
      ? `${siteUrl}${lesson.ogImage}` 
      : `${siteUrl}${manifest.course.coverImage}`,
    ogType: 'article',
    twitterCard: 'summary_large_image',
    tags: lesson.tags,
  }
}

// Generate SEO metadata for 404 page
export function generate404SEO(manifest: ContentManifest): SEOMetadata {
  return {
    title: `Page Not Found – ${manifest.course.title}`,
    description: 'The page you are looking for could not be found.',
    canonicalUrl: generateCanonicalUrl('/404'),
    ogImage: `${getSiteUrl()}${manifest.course.coverImage}`,
    ogType: 'website',
    twitterCard: 'summary_large_image',
  }
}

// Format title for social sharing
export function formatSocialTitle(title: string, siteName: string): string {
  if (title.includes(siteName)) {
    return title
  }
  return `${title} | ${siteName}`
}

// Generate JSON-LD structured data for the course
export function generateCourseStructuredData(manifest: ContentManifest) {
  const siteUrl = getSiteUrl()
  
  return {
    '@context': 'https://schema.org',
    '@type': 'Course',
    name: manifest.course.title,
    description: manifest.course.description,
    provider: {
      '@type': 'Organization',
      name: 'PeeGees',
      url: siteUrl,
    },
    educationalLevel: 'Advanced',
    teaches: [
      'PostgreSQL',
      'Database Administration',
      'Performance Optimization',
      'Database Architecture',
    ],
    coursePrerequisites: 'Experience with SQL and database concepts',
    numberOfCredits: manifest.lessons.length,
    hasCourseInstance: {
      '@type': 'CourseInstance',
      courseMode: 'online',
      instructor: {
        '@type': 'Organization',
        name: 'PeeGees',
      },
    },
  }
}

// Generate JSON-LD structured data for a lesson
export function generateLessonStructuredData(lesson: Lesson, manifest: ContentManifest) {
  const siteUrl = getSiteUrl()
  
  return {
    '@context': 'https://schema.org',
    '@type': 'LearningResource',
    name: lesson.title,
    description: lesson.description,
    learningResourceType: 'Lesson',
    educationalLevel: 'Advanced',
    teaches: lesson.tags,
    timeRequired: lesson.estReadMinutes ? `PT${lesson.estReadMinutes}M` : undefined,
    isPartOf: {
      '@type': 'Course',
      name: manifest.course.title,
      url: siteUrl,
    },
    position: lesson.order,
    url: generateCanonicalUrl(`/lesson/${lesson.slug}`),
  }
}

// Generate breadcrumb structured data
export function generateBreadcrumbStructuredData(
  items: Array<{ name: string; url: string }>
) {
  return {
    '@context': 'https://schema.org',
    '@type': 'BreadcrumbList',
    itemListElement: items.map((item, index) => ({
      '@type': 'ListItem',
      position: index + 1,
      name: item.name,
      item: item.url,
    })),
  }
}

// Generate meta tags for React Helmet
export function generateMetaTags(seo: SEOMetadata) {
  const tags = [
    // Basic meta tags
    { name: 'description', content: seo.description },
    { name: 'keywords', content: seo.tags?.join(', ') || '' },
    
    // Open Graph
    { property: 'og:title', content: seo.title },
    { property: 'og:description', content: seo.description },
    { property: 'og:image', content: seo.ogImage },
    { property: 'og:url', content: seo.canonicalUrl },
    { property: 'og:type', content: seo.ogType || 'website' },
    { property: 'og:site_name', content: 'PostgreSQL Course' },
    
    // Twitter Card
    { name: 'twitter:card', content: seo.twitterCard || 'summary_large_image' },
    { name: 'twitter:title', content: seo.title },
    { name: 'twitter:description', content: seo.description },
    { name: 'twitter:image', content: seo.ogImage },
    
    // Additional meta tags
    { name: 'robots', content: 'index, follow' },
    { name: 'author', content: 'PeeGees' },
    { name: 'theme-color', content: '#0ea5e9' },
  ]

  // Add timestamp meta tags if available
  if (seo.publishedTime) {
    tags.push({ property: 'article:published_time', content: seo.publishedTime })
  }
  if (seo.modifiedTime) {
    tags.push({ property: 'article:modified_time', content: seo.modifiedTime })
  }
  if (seo.tags) {
    seo.tags.forEach(tag => {
      tags.push({ property: 'article:tag', content: tag })
    })
  }

  return tags.filter(tag => tag.content) // Remove empty content
}

// Generate link tags for React Helmet
export function generateLinkTags(seo: SEOMetadata) {
  return [
    { rel: 'canonical', href: seo.canonicalUrl },
    { rel: 'icon', type: 'image/x-icon', href: '/favicon.ico' },
    { rel: 'apple-touch-icon', href: '/apple-touch-icon.png' },
    { rel: 'manifest', href: '/manifest.webmanifest' },
  ]
}

// Extract reading time estimate from content length
export function estimateReadingTime(content: string): number {
  const wordsPerMinute = 200 // Average reading speed
  const wordCount = content.trim().split(/\s+/).length
  return Math.ceil(wordCount / wordsPerMinute)
}

// Generate sitemap entries
export function generateSitemapEntries(manifest: ContentManifest) {
  const siteUrl = getSiteUrl()
  const entries = [
    {
      url: siteUrl,
      changefreq: 'weekly',
      priority: 1.0,
      lastmod: new Date().toISOString(),
    },
  ]

  // Add lesson pages
  manifest.lessons.forEach(lesson => {
    entries.push({
      url: `${siteUrl}/lesson/${lesson.slug}`,
      changefreq: 'monthly',
      priority: 0.8,
      lastmod: new Date().toISOString(),
    })
  })

  return entries
}

// Validate and sanitize URL
export function sanitizeUrl(url: string): string {
  try {
    const parsed = new URL(url)
    // Only allow http and https protocols
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return '#'
    }
    return parsed.toString()
  } catch {
    return '#'
  }
}
