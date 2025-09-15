import { useParams, Link } from 'react-router-dom'
import { useEffect, useState } from 'react'
import * as ReactHelmetAsync from 'react-helmet-async'
const { Helmet } = ReactHelmetAsync
import { ChevronLeftIcon, ChevronRightIcon } from '@heroicons/react/24/outline'
import Container from '../components/Layout/Container'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'
import MarkdownRenderer from '../components/MarkdownRenderer'
import TOC from '../components/TOC'
import { useContent } from '../contexts/ContentContext'
import { fetchLessonContent, getLessonNavigation, createAbortController } from '../lib/content'
import { generateLessonSEO, generateMetaTags, generateLinkTags } from '../lib/seo'
import { trackLessonView } from '../lib/analytics'
import type { LessonContent } from '../types/content'

export default function Lesson() {
  const { slug } = useParams<{ slug: string }>()
  const { manifest, loading: manifestLoading, error: manifestError } = useContent()
  
  const [lessonContent, setLessonContent] = useState<LessonContent | null>(null)
  const [contentLoading, setContentLoading] = useState(false)
  const [contentError, setContentError] = useState<string | null>(null)

  const lesson = manifest?.lessons.find(l => l.slug === slug)
  const navigation = manifest && lesson ? getLessonNavigation(manifest, lesson.slug) : { previous: undefined, next: undefined }

  // Generate SEO metadata
  const seo = lesson && manifest ? generateLessonSEO(lesson, manifest) : null
  const metaTags = seo ? generateMetaTags(seo) : []
  const linkTags = seo ? generateLinkTags(seo) : []

  useEffect(() => {
    if (!lesson) return

    const controller = createAbortController()
    
    const loadContent = async () => {
      try {
        setContentLoading(true)
        setContentError(null)
        
        const content = await fetchLessonContent(lesson, controller.signal)
        setLessonContent(content)
        
        // Track lesson view
        trackLessonView(lesson.slug, lesson.title)
      } catch (err) {
        if (err instanceof Error && err.name !== 'AbortError') {
          setContentError(err.message || 'Failed to load lesson content')
        }
      } finally {
        setContentLoading(false)
      }
    }

    loadContent()

    return () => {
      controller.abort()
    }
  }, [lesson])

  if (manifestLoading) {
    return (
      <Container className="py-12">
        <div className="flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </Container>
    )
  }

  if (manifestError || !manifest) {
    return (
      <Container className="py-12">
        <ErrorMessage error={manifestError || 'Failed to load lesson'} />
      </Container>
    )
  }

  if (!lesson) {
    return (
      <Container className="py-12">
        <ErrorMessage error="Lesson not found" />
      </Container>
    )
  }

  return (
    <>
      {/* SEO Head Tags */}
      <Helmet>
        <title>{seo?.title}</title>
        {metaTags.map((tag, index) => {
          if ('name' in tag) {
            return <meta key={index} name={tag.name} content={tag.content} />
          } else {
            return <meta key={index} property={tag.property} content={tag.content} />
          }
        })}
        {linkTags.map((link, index) => (
          <link key={index} {...link} />
        ))}
      </Helmet>

      <Container className="py-12">
        <div className="lg:grid lg:grid-cols-12 lg:gap-8">
          {/* Main Content */}
          <div className="lg:col-span-8">
            {/* Lesson Meta Info */}
            <div className="mb-8">
              <div className="flex items-center gap-2 text-sm text-gray-600 dark:text-gray-400 mb-4">
                <span>Lesson {lesson.order}</span>
                {lesson.estReadMinutes && (
                  <>
                    <span>•</span>
                    <span>{lesson.estReadMinutes} min read</span>
                  </>
                )}
              </div>
            </div>

            {/* Content */}
            {contentLoading && (
              <div className="flex justify-center py-12">
                <LoadingSpinner size="lg" />
              </div>
            )}

            {contentError && (
              <ErrorMessage 
                error={contentError} 
                onRetry={() => window.location.reload()}
              />
            )}

            {lessonContent && (
              <MarkdownRenderer 
                markdown={lessonContent.markdown}
                className="mb-12"
              />
            )}

            {/* Tags */}
            {lesson.tags && lesson.tags.length > 0 && (
              <div className="mb-8 p-6 bg-gray-50 dark:bg-gray-800 rounded-lg">
                <h3 className="text-sm font-medium text-gray-900 dark:text-white mb-3">
                  Topics covered:
                </h3>
                <div className="flex flex-wrap gap-2">
                  {lesson.tags.map(tag => (
                    <span
                      key={tag}
                      className="px-3 py-1 bg-blue-100 dark:bg-blue-900/20 text-blue-800 dark:text-blue-200 text-sm rounded-full"
                    >
                      {tag}
                    </span>
                  ))}
                </div>
              </div>
            )}

            {/* Navigation */}
            <div className="flex flex-col sm:flex-row justify-between gap-4 pt-8 border-t border-gray-200 dark:border-gray-700">
              <div className="flex-1">
                {navigation.previous && (
                  <Link
                    to={`/lesson/${navigation.previous.slug}`}
                    className="group flex items-center gap-3 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-shadow"
                  >
                    <ChevronLeftIcon className="w-5 h-5 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Previous</div>
                      <div className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {navigation.previous.title}
                      </div>
                    </div>
                  </Link>
                )}
              </div>
              
              <div className="flex-1">
                {navigation.next && (
                  <Link
                    to={`/lesson/${navigation.next.slug}`}
                    className="group flex items-center gap-3 p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-shadow justify-end text-right"
                  >
                    <div>
                      <div className="text-sm text-gray-500 dark:text-gray-400">Next</div>
                      <div className="font-medium text-gray-900 dark:text-white group-hover:text-blue-600 dark:group-hover:text-blue-400">
                        {navigation.next.title}
                      </div>
                    </div>
                    <ChevronRightIcon className="w-5 h-5 text-gray-400 group-hover:text-blue-600 dark:group-hover:text-blue-400" />
                  </Link>
                )}
              </div>
            </div>
          </div>

          {/* Table of Contents - Desktop */}
          <div className="hidden lg:block lg:col-span-4">
            <div className="sticky top-24">
              {lessonContent && lessonContent.headings.length > 0 && (
                <div className="bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg p-6">
                  <TOC headings={lessonContent.headings} />
                </div>
              )}
            </div>
          </div>
        </div>
      </Container>
    </>
  )
}
