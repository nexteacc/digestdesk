import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { ClerkProvider } from '@clerk/react'
import { shadcn } from '@clerk/themes'
import './index.css'
import App from './App.tsx'

const publishableKey = import.meta.env.VITE_CLERK_PUBLISHABLE_KEY

if (!publishableKey) {
  throw new Error('Missing VITE_CLERK_PUBLISHABLE_KEY')
}

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ClerkProvider
      publishableKey={publishableKey}
      afterSignOutUrl="/"
      appearance={{
        theme: shadcn,
        variables: {
          colorPrimary: '#FF6719',
          colorBackground: 'oklch(0.99 0.008 95)',
          colorForeground: 'oklch(0.16 0 0)',
          colorBorder: 'oklch(0.84 0.01 95)',
          colorInput: 'oklch(0.84 0.01 95)',
          colorMutedForeground: 'oklch(0.46 0 0)',
          fontFamily: "'Newsreader', ui-serif, Georgia, Cambria, 'Times New Roman', Times, serif",
          borderRadius: '0.25rem',
        },
      }}
    >
      <App />
    </ClerkProvider>
  </StrictMode>,
)
