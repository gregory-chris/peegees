import { ExclamationTriangleIcon, ArrowPathIcon } from '@heroicons/react/24/outline'
import { cn } from '../lib/utils'
import type { ErrorMessageProps } from '../types/content'

export default function ErrorMessage({ 
  error, 
  onRetry, 
  className 
}: ErrorMessageProps) {
  const errorMessage = error instanceof Error ? error.message : error || 'An unexpected error occurred'

  return (
    <div className={cn(
      'flex flex-col items-center justify-center p-8 text-center bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg',
      className
    )}>
      <div className="flex items-center justify-center w-12 h-12 mx-auto bg-red-100 dark:bg-red-900/40 rounded-full mb-4">
        <ExclamationTriangleIcon className="w-6 h-6 text-red-600 dark:text-red-400" />
      </div>
      
      <h3 className="text-lg font-semibold text-red-900 dark:text-red-100 mb-2">
        Something went wrong
      </h3>
      
      <p className="text-sm text-red-700 dark:text-red-300 mb-6 max-w-md">
        {errorMessage}
      </p>

      {onRetry && (
        <button
          onClick={onRetry}
          className="inline-flex items-center gap-2 px-4 py-2 bg-red-600 hover:bg-red-700 text-white text-sm font-medium rounded-md transition-colors focus:outline-none focus:ring-2 focus:ring-red-500 focus:ring-offset-2"
        >
          <ArrowPathIcon className="w-4 h-4" />
          Try Again
        </button>
      )}
    </div>
  )
}
