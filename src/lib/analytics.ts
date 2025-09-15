import type { AnalyticsEvent, AnalyticsProvider } from '../types/content'

// Get analytics provider from environment
function getAnalyticsProvider(): AnalyticsProvider {
  return (import.meta.env.VITE_ANALYTICS as AnalyticsProvider) || 'none'
}

// Initialize analytics based on provider
export function initializeAnalytics(): void {
  const provider = getAnalyticsProvider()
  
  switch (provider) {
    case 'plausible':
      initializePlausible()
      break
    case 'ga4':
      initializeGA4()
      break
    case 'none':
    default:
      // No analytics
      break
  }
}

// Initialize Plausible Analytics
function initializePlausible(): void {
  const domain = import.meta.env.VITE_PLAUSIBLE_DOMAIN
  if (!domain) {
    console.warn('VITE_PLAUSIBLE_DOMAIN is required for Plausible analytics')
    return
  }

  // Load Plausible script
  const script = document.createElement('script')
  script.async = true
  script.defer = true
  script.src = 'https://plausible.io/js/script.js'
  script.setAttribute('data-domain', domain)
  document.head.appendChild(script)

  // Initialize plausible function
  window.plausible = window.plausible || function(...args: unknown[]) {
    (window.plausible!.q = window.plausible!.q || []).push(args)
  }
}

// Initialize Google Analytics 4
function initializeGA4(): void {
  const measurementId = import.meta.env.VITE_GA4_MEASUREMENT_ID
  if (!measurementId) {
    console.warn('VITE_GA4_MEASUREMENT_ID is required for GA4 analytics')
    return
  }

  // Load gtag script
  const script = document.createElement('script')
  script.async = true
  script.src = `https://www.googletagmanager.com/gtag/js?id=${measurementId}`
  document.head.appendChild(script)

  // Initialize gtag
  window.dataLayer = window.dataLayer || []
  window.gtag = function(...args: unknown[]) {
    window.dataLayer!.push(args)
  }
  
  window.gtag('js', new Date())
  window.gtag('config', measurementId, {
    // Privacy-focused configuration
    anonymize_ip: true,
    allow_google_signals: false,
    allow_ad_personalization_signals: false,
  })
}

// Track page view
export function trackPageView(path: string, title?: string): void {
  const provider = getAnalyticsProvider()
  
  switch (provider) {
    case 'plausible':
      if (window.plausible) {
        window.plausible('pageview', { 
          u: `${window.location.origin}${path}`,
          ...(title && { props: { title } })
        })
      }
      break
    case 'ga4':
      if (window.gtag) {
        window.gtag('config', import.meta.env.VITE_GA4_MEASUREMENT_ID, {
          page_path: path,
          ...(title && { page_title: title })
        })
      }
      break
  }
}

// Track custom event
export function trackEvent(event: AnalyticsEvent): void {
  const provider = getAnalyticsProvider()
  
  switch (provider) {
    case 'plausible':
      if (window.plausible) {
        window.plausible(event.name, { 
          props: event.properties 
        })
      }
      break
    case 'ga4':
      if (window.gtag) {
        window.gtag('event', event.name, event.properties)
      }
      break
  }
}

// Track lesson view
export function trackLessonView(lessonSlug: string, lessonTitle: string): void {
  trackEvent({
    name: 'lesson_view',
    properties: {
      lesson_slug: lessonSlug,
      lesson_title: lessonTitle,
    }
  })
}

// Track lesson completion (scroll to bottom)
export function trackLessonCompletion(lessonSlug: string, readingTime: number): void {
  trackEvent({
    name: 'lesson_complete',
    properties: {
      lesson_slug: lessonSlug,
      reading_time_seconds: readingTime,
    }
  })
}

// Track search usage
export function trackSearch(query: string, resultsCount: number): void {
  trackEvent({
    name: 'search',
    properties: {
      search_term: query,
      results_count: resultsCount,
    }
  })
}

// Track filter usage
export function trackFilter(filterType: string, filterValue: string): void {
  trackEvent({
    name: 'filter_used',
    properties: {
      filter_type: filterType,
      filter_value: filterValue,
    }
  })
}

// Track share action
export function trackShare(platform: string, lessonSlug?: string): void {
  trackEvent({
    name: 'content_share',
    properties: {
      platform,
      ...(lessonSlug && { lesson_slug: lessonSlug }),
    }
  })
}

// Track copy code action
export function trackCodeCopy(language?: string): void {
  trackEvent({
    name: 'code_copy',
    properties: {
      ...(language && { language }),
    }
  })
}

// Track external link clicks
export function trackExternalLink(url: string): void {
  trackEvent({
    name: 'external_link_click',
    properties: {
      url,
    }
  })
}

// Track theme toggle
export function trackThemeToggle(theme: 'light' | 'dark'): void {
  trackEvent({
    name: 'theme_toggle',
    properties: {
      theme,
    }
  })
}

// Track errors
export function trackError(error: string, context?: string): void {
  trackEvent({
    name: 'error',
    properties: {
      error_message: error,
      ...(context && { context }),
    }
  })
}

// Track performance metrics
export function trackPerformance(): void {
  // Only track performance in production
  if (import.meta.env.DEV) return

  // Wait for page to load completely
  window.addEventListener('load', () => {
    // Use requestIdleCallback if available, otherwise setTimeout
    const scheduleTracking = window.requestIdleCallback || 
      ((callback: () => void) => setTimeout(callback, 0))

    scheduleTracking(() => {
      const navigation = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming
      if (navigation) {
        trackEvent({
          name: 'performance',
          properties: {
            dom_content_loaded: Math.round(navigation.domContentLoadedEventEnd - navigation.domContentLoadedEventStart),
            load_complete: Math.round(navigation.loadEventEnd - navigation.loadEventStart),
            first_byte: Math.round(navigation.responseStart - navigation.requestStart),
          }
        })
      }

      // Track Core Web Vitals if available
      if ('web-vitals' in window) {
        // This would require installing web-vitals package
        // For now, we'll skip this implementation
      }
    })
  })
}

// Privacy-compliant consent management
export function hasAnalyticsConsent(): boolean {
  // For privacy compliance, you might want to implement consent management
  // For now, we'll assume consent is given for essential analytics
  const consent = localStorage.getItem('analytics-consent')
  return consent !== 'false'
}

export function setAnalyticsConsent(consent: boolean): void {
  localStorage.setItem('analytics-consent', consent.toString())
  
  if (!consent) {
    // If consent is revoked, you might want to disable tracking
    // Implementation depends on your privacy requirements
  }
}

// Declare global types for analytics
declare global {
  interface Window {
    plausible?: {
      (...args: unknown[]): void
      q?: unknown[]
    }
    gtag?: (...args: unknown[]) => void
    dataLayer?: unknown[]
    requestIdleCallback?: (callback: () => void) => number
  }
}

export type { AnalyticsEvent, AnalyticsProvider }
