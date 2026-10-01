import { createRoot } from 'react-dom/client'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import './index.css'
import App from './App.jsx'
import { PreferencesProvider } from './context/PreferencesContext.jsx'
import ErrorBoundary from './components/common/ErrorBoundary.jsx'
import { installRuntimeGuards } from './utils/runtimeGuards.js'

// Absorb the known non-fatal third-party `startTime` crash before it can bubble
// up and white-screen the app during a state transition.
installRuntimeGuards()

// Maglagay ng kaunting default options para maiwasan ang sobrang refetching
const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      refetchOnWindowFocus: false, // Opsyonal: Pigilan ang auto-refetch paglipat ng tab
      retry: 1,                    // Bilang ng beses na mag-a-attempt ulit kapag nag-fail
      staleTime: 1000 * 60 * 5,    // Mapananatili ang data na"fresh" sa loob ng 5 minuto
    },
  },
})

createRoot(document.getElementById('root')).render(
  <ErrorBoundary>
    <PreferencesProvider>
      <QueryClientProvider client={queryClient}>
        <App />
      </QueryClientProvider>
    </PreferencesProvider>
  </ErrorBoundary>,
)