import { Link } from 'react-router-dom'
import { HeartIcon } from '@heroicons/react/24/outline'
import Container from './Container'
import { useContent } from '../../contexts/ContentContext'
import type { SiteFooterProps } from '../../types/content'

export default function SiteFooter({ className }: SiteFooterProps) {
  const { manifest } = useContent()
  const currentYear = new Date().getFullYear()

  return (
    <footer className={`bg-gray-50 dark:bg-gray-800 border-t border-gray-200 dark:border-gray-700 ${className || ''}`}>
      <Container>
        <div className="py-12">
          <div className="grid grid-cols-1 md:grid-cols-3 gap-8">
            {/* About Section */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                About This Course
              </h3>
              <p className="text-sm text-gray-600 dark:text-gray-400 leading-relaxed">
                {manifest?.course.description || 'A comprehensive PostgreSQL course.'}
              </p>
            </div>

            {/* Quick Links */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Quick Links
              </h3>
              <nav className="space-y-3">
                <div>
                  <Link
                    to="/"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:underline"
                  >
                    All Lessons
                  </Link>
                </div>
                
                {manifest?.lessons && manifest.lessons.length > 0 && (
                  <>
                    <div>
                      <Link
                        to={`/lesson/${manifest.lessons[0].slug}`}
                        className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:underline"
                      >
                        Start Learning
                      </Link>
                    </div>
                    
                    <div>
                      <Link
                        to={`/lesson/${manifest.lessons[manifest.lessons.length - 1].slug}`}
                        className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:underline"
                      >
                        Latest Lesson
                      </Link>
                    </div>
                  </>
                )}
              </nav>
            </div>

            {/* Resources */}
            <div>
              <h3 className="text-lg font-semibold text-gray-900 dark:text-white mb-4">
                Resources
              </h3>
              <nav className="space-y-3">
                <div>
                  <a
                    href="https://www.postgresql.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:underline"
                  >
                    PostgreSQL Official Documentation
                  </a>
                </div>
                
                <div>
                  <a
                    href="https://www.postgresql.org/download/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:underline"
                  >
                    Download PostgreSQL
                  </a>
                </div>
                
                <div>
                  <a
                    href="https://wiki.postgresql.org/"
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-gray-600 dark:text-gray-400 hover:text-blue-600 dark:hover:text-blue-400 transition-colors focus:outline-none focus:underline"
                  >
                    PostgreSQL Wiki
                  </a>
                </div>
              </nav>
            </div>
          </div>

          {/* Bottom Section */}
          <div className="mt-12 pt-8 border-t border-gray-200 dark:border-gray-700">
            <div className="flex flex-col sm:flex-row items-center justify-between gap-4">
              <div className="flex items-center space-x-2 text-sm text-gray-600 dark:text-gray-400">
                <span>Made with</span>
                <HeartIcon className="w-4 h-4 text-red-500" />
                <span>for PostgreSQL developers</span>
              </div>
              
              <div className="text-sm text-gray-600 dark:text-gray-400">
                © {currentYear} PeeGees. All rights reserved.
              </div>
            </div>
            
            <div className="mt-4 text-center">
              <p className="text-xs text-gray-500 dark:text-gray-500">
                This course is designed for educational purposes. 
                Always test queries in a safe environment before applying them to production databases.
              </p>
            </div>
          </div>
        </div>
      </Container>
    </footer>
  )
}
