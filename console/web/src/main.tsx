import './styles.css';

import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { RouterProvider } from '@tanstack/react-router';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';

import { Unauthorized } from './api/client';
import { router } from './router';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: { retry: (n, err) => !(err instanceof Unauthorized) && n < 3, refetchOnWindowFocus: false },
  },
});

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <QueryClientProvider client={queryClient}>
      <RouterProvider router={router} />
    </QueryClientProvider>
  </StrictMode>,
);
