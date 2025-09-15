import { Helmet } from 'react-helmet-async'
import { useContent } from '../contexts/ContentContext'
import { generateHomeSEO, generateMetaTags, generateLinkTags } from '../lib/seo'
import Container from '../components/Layout/Container'
import LoadingSpinner from '../components/LoadingSpinner'
import ErrorMessage from '../components/ErrorMessage'

export default function Home() {
  const { manifest, loading, error, refetch } = useContent()

  // Generate SEO metadata
  const seo = manifest ? generateHomeSEO(manifest) : null
  const metaTags = seo ? generateMetaTags(seo) : []
  const linkTags = seo ? generateLinkTags(seo) : []

  if (loading) {
    return (
      <Container className="py-12">
        <div className="flex justify-center">
          <LoadingSpinner size="lg" />
        </div>
      </Container>
    )
  }

  if (error || !manifest) {
    return (
      <Container className="py-12">
        <ErrorMessage 
          error={error || 'Failed to load course content'} 
          onRetry={refetch}
        />
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

      {/* Hero Section */}
      <section className="bg-gradient-to-b from-blue-50 to-white dark:from-gray-900 dark:to-gray-800 py-16 lg:py-24">
        <Container>
          <div className="text-center max-w-4xl mx-auto">
            <h1 className="text-4xl lg:text-6xl font-bold text-gray-900 dark:text-white mb-6">
              {manifest.course.title}
            </h1>
            
            <p className="text-xl lg:text-2xl text-gray-600 dark:text-gray-300 mb-8 leading-relaxed">
              {manifest.course.tagline}
            </p>
            
            <p className="text-lg text-gray-700 dark:text-gray-400 mb-12 max-w-3xl mx-auto">
              {manifest.course.description}
            </p>

            <div className="flex flex-col sm:flex-row gap-4 justify-center">
              <a
                href="#lessons"
                className="inline-flex items-center justify-center px-8 py-3 border border-transparent text-base font-medium rounded-md text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
              >
                Start Learning
              </a>
              
              <div className="flex items-center justify-center text-sm text-gray-600 dark:text-gray-400">
                <span>{manifest.lessons.length} lessons</span>
                <span className="mx-2">•</span>
                <span>
                  {manifest.lessons.reduce((total, lesson) => total + (lesson.estReadMinutes || 0), 0)} min total
                </span>
              </div>
            </div>
          </div>
        </Container>
      </section>

      {/* Lessons Section */}
      <section id="lessons" className="py-16 lg:py-24">
        <Container>
          <div className="text-center mb-12">
            <h2 className="text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white mb-4">
              Course Lessons
            </h2>
            <p className="text-lg text-gray-600 dark:text-gray-400 max-w-2xl mx-auto">
              Master PostgreSQL through hands-on lessons covering everything from architecture to production best practices.
            </p>
          </div>

          <div className="grid gap-6 md:gap-8">
            {manifest.lessons.map((lesson) => (
              <div
                key={lesson.slug}
                className="bg-white dark:bg-gray-800 rounded-lg shadow-sm border border-gray-200 dark:border-gray-700 p-6 hover:shadow-md transition-shadow"
              >
                <div className="flex items-start gap-6">
                  <div className="flex-shrink-0 w-12 h-12 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                    <span className="text-lg font-bold text-blue-600 dark:text-blue-400">
                      {lesson.order}
                    </span>
                  </div>
                  
                  <div className="flex-1 min-w-0">
                    <h3 className="text-xl font-semibold text-gray-900 dark:text-white mb-2">
                      {lesson.title}
                    </h3>
                    
                    <p className="text-gray-600 dark:text-gray-400 mb-4 leading-relaxed">
                      {lesson.description}
                    </p>
                    
                    <div className="flex flex-wrap items-center gap-4 text-sm text-gray-500 dark:text-gray-400">
                      {lesson.estReadMinutes && (
                        <span>
                          {lesson.estReadMinutes} min read
                        </span>
                      )}
                      
                      {lesson.tags && lesson.tags.length > 0 && (
                        <div className="flex flex-wrap gap-2">
                          {lesson.tags.slice(0, 3).map(tag => (
                            <span
                              key={tag}
                              className="px-2 py-1 bg-gray-100 dark:bg-gray-700 rounded text-xs"
                            >
                              {tag}
                            </span>
                          ))}
                          {lesson.tags.length > 3 && (
                            <span className="text-xs">
                              +{lesson.tags.length - 3} more
                            </span>
                          )}
                        </div>
                      )}
                    </div>
                  </div>
                  
                  <div className="flex-shrink-0">
                    <a
                      href={`/lesson/${lesson.slug}`}
                      className="inline-flex items-center px-4 py-2 border border-gray-300 dark:border-gray-600 rounded-md text-sm font-medium text-gray-700 dark:text-gray-300 bg-white dark:bg-gray-800 hover:bg-gray-50 dark:hover:bg-gray-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 transition-colors"
                    >
                      Read Lesson
                    </a>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </Container>
      </section>
    </>
  )
}
