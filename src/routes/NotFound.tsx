import { Link } from 'react-router-dom'
import * as ReactHelmetAsync from 'react-helmet-async'
const { Helmet } = ReactHelmetAsync
import { HomeIcon } from '@heroicons/react/24/outline'
import Container from '../components/Layout/Container'
import { useContent } from '../contexts/ContentContext'
import { generate404SEO, generateMetaTags, generateLinkTags } from '../lib/seo'

export default function NotFound() {
  const { manifest } = useContent()
  
  // Generate SEO metadata
  const seo = manifest ? generate404SEO(manifest) : null
  const metaTags = seo ? generateMetaTags(seo) : []
  const linkTags = seo ? generateLinkTags(seo) : []

  return (
    <>
      {/* SEO Head Tags */}
      <Helmet>
        <title>{seo?.title || 'Page Not Found'}</title>
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

      <Container className="py-16 lg:py-24">
        <div className="max-w-md mx-auto text-center">
          <div className="flex items-center justify-center w-20 h-20 mx-auto bg-gray-100 dark:bg-gray-800 rounded-full mb-8">
            <span className="text-3xl font-bold text-gray-400 dark:text-gray-600">
              404
            </span>
          </div>
          
          <h1 className="text-3xl lg:text-4xl font-bold text-gray-900 dark:text-white mb-4">
            Page Not Found
          </h1>
          
          <p className="text-lg text-gray-600 dark:text-gray-400 mb-8 leading-relaxed">
            The page you're looking for doesn't exist or has been moved. 
            Let's get you back to learning PostgreSQL!
          </p>

          <div className="flex flex-col sm:flex-row gap-4 justify-center">
            <Link
              to="/"
              className="inline-flex items-center justify-center gap-2 px-6 py-3 bg-blue-600 hover:bg-blue-700 text-white font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
            >
              <HomeIcon className="w-5 h-5" />
              Back to Home
            </Link>
            
            {manifest?.lessons && manifest.lessons.length > 0 && (
              <Link
                to={`/lesson/${manifest.lessons[0].slug}`}
                className="inline-flex items-center justify-center px-6 py-3 border border-gray-300 dark:border-gray-600 text-gray-700 dark:text-gray-300 font-medium rounded-md hover:bg-gray-50 dark:hover:bg-gray-800 transition-colors focus:outline-none focus:ring-2 focus:ring-gray-500 focus:ring-offset-2"
              >
                Start First Lesson
              </Link>
            )}
          </div>

          {manifest?.lessons && manifest.lessons.length > 0 && (
            <div className="mt-12">
              <h2 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Popular Lessons
              </h2>
              <div className="space-y-3">
                {manifest.lessons.slice(0, 3).map(lesson => (
                  <Link
                    key={lesson.slug}
                    to={`/lesson/${lesson.slug}`}
                    className="block p-4 bg-white dark:bg-gray-800 border border-gray-200 dark:border-gray-700 rounded-lg hover:shadow-md transition-shadow focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2"
                  >
                    <div className="flex items-center gap-3">
                      <div className="flex-shrink-0 w-8 h-8 bg-blue-100 dark:bg-blue-900/20 rounded-lg flex items-center justify-center">
                        <span className="text-sm font-bold text-blue-600 dark:text-blue-400">
                          {lesson.order}
                        </span>
                      </div>
                      <div className="text-left">
                        <h3 className="font-medium text-gray-900 dark:text-white">
                          {lesson.title}
                        </h3>
                        <p className="text-sm text-gray-600 dark:text-gray-400 line-clamp-1">
                          {lesson.description}
                        </p>
                      </div>
                    </div>
                  </Link>
                ))}
              </div>
            </div>
          )}
        </div>
      </Container>
    </>
  )
}
