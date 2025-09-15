import { BrowserRouter as Router, Routes, Route } from 'react-router-dom'
import * as ReactHelmetAsync from 'react-helmet-async'
const { HelmetProvider } = ReactHelmetAsync
import { ContentProvider } from './contexts/ContentContext'
import { ThemeProvider } from './contexts/ThemeContext'
import Layout from './components/Layout/Layout'
import Home from './routes/Home'
import Lesson from './routes/Lesson'
import NotFound from './routes/NotFound'
import ErrorBoundary from './components/ErrorBoundary'

function App() {
  return (
    <ErrorBoundary>
      <HelmetProvider>
        <ThemeProvider>
          <ContentProvider>
            <Router>
              <Layout>
                <Routes>
                  <Route path="/" element={<Home />} />
                  <Route path="/lesson/:slug" element={<Lesson />} />
                  <Route path="*" element={<NotFound />} />
                </Routes>
              </Layout>
            </Router>
          </ContentProvider>
        </ThemeProvider>
      </HelmetProvider>
    </ErrorBoundary>
  )
}

export default App
