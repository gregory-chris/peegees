import { useState, useEffect } from 'react'
import { unified } from 'unified'
import remarkParse from 'remark-parse'
import remarkGfm from 'remark-gfm'
import remarkRehype from 'remark-rehype'
import rehypeSlug from 'rehype-slug'
import rehypeAutolinkHeadings from 'rehype-autolink-headings'
import rehypePrettyCode from 'rehype-pretty-code'
import rehypeStringify from 'rehype-stringify'
import { copyToClipboard, cn } from '../lib/utils'
import { trackCodeCopy } from '../lib/analytics'
import type { MarkdownRendererProps } from '../types/content'


export default function MarkdownRenderer({ markdown, className }: MarkdownRendererProps) {
  const [processedHtml, setProcessedHtml] = useState<string>('')
  const [isLoading, setIsLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    async function processMarkdown() {
      try {
        setIsLoading(true)
        setError(null)

        const file = await unified()
          .use(remarkParse)
          .use(remarkGfm)
          .use(remarkRehype, { allowDangerousHtml: true })
          .use(rehypeSlug)
          .use(rehypeAutolinkHeadings, {
            behavior: 'append',
            properties: {
              className: ['anchor', 'opacity-0', 'group-hover:opacity-100', 'ml-2', 'text-blue-600', 'dark:text-blue-400', 'no-underline'],
              ariaLabel: 'Link to heading'
            },
            content: {
              type: 'text',
              value: '#'
            }
          })
          .use(rehypePrettyCode, {
            theme: {
              dark: 'github-dark',
              light: 'github-light',
            },
            keepBackground: false,
            defaultLang: 'text',
          })
          .use(rehypeStringify, { allowDangerousHtml: true })
          .process(markdown)

        let html = String(file)
        
        // Add copy buttons to code blocks
        html = html.replace(
          /<pre[^>]*><code[^>]*>([\s\S]*?)<\/code><\/pre>/g,
          (match, codeContent) => {
            return match.replace(
              /<pre([^>]*)>/,
              `<pre$1><button class="copy-button" type="button" title="Copy to clipboard" aria-label="Copy code to clipboard"><svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M8 16H6a2 2 0 01-2-2V6a2 2 0 012-2h8a2 2 0 012 2v2m-6 12h8a2 2 0 002-2v-8a2 2 0 00-2-2h-8a2 2 0 00-2 2v8a2 2 0 002 2z"></path></svg></button>`
            )
          }
        )
        
        setProcessedHtml(html)
      } catch (err) {
        console.error('Error processing markdown:', err)
        setError('Failed to process markdown content')
      } finally {
        setIsLoading(false)
      }
    }

    if (markdown) {
      processMarkdown()
    }
  }, [markdown])

  const handleCodeCopy = async (event: React.MouseEvent<HTMLDivElement>) => {
    const target = event.target as HTMLElement
    
    // Check if the clicked element is a copy button or within one
    const button = target.closest('.copy-button') as HTMLButtonElement
    if (!button) return
    
    event.preventDefault()
    event.stopPropagation()
    
    const preElement = button.parentElement
    const codeElement = preElement?.querySelector('code')
    if (!codeElement) return

    const code = codeElement.textContent || ''
    const success = await copyToClipboard(code)
    
    if (success) {
      const language = codeElement.className.match(/language-(\w+)/)?.[1]
      trackCodeCopy(language)
      
      // Update button state
      const originalHTML = button.innerHTML
      button.innerHTML = '<svg class="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M5 13l4 4L19 7"></path></svg>'
      setTimeout(() => {
        button.innerHTML = originalHTML
      }, 2000)
    }
  }

  if (isLoading) {
    return (
      <div className={cn('prose prose-lg dark:prose-invert max-w-none', className)}>
        <div className="flex items-center justify-center py-8">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-blue-600"></div>
          <span className="ml-3 text-gray-600 dark:text-gray-400">Loading content...</span>
        </div>
      </div>
    )
  }

  if (error) {
    return (
      <div className={cn('prose prose-lg dark:prose-invert max-w-none', className)}>
        <div className="bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-800 rounded-lg p-4">
          <p className="text-red-800 dark:text-red-200 m-0">Error: {error}</p>
        </div>
      </div>
    )
  }

  return (
    <div 
      className={cn('prose prose-lg dark:prose-invert max-w-none markdown-content', className)}
      dangerouslySetInnerHTML={{ __html: processedHtml }}
      onClick={handleCodeCopy}
    />
  )
}
