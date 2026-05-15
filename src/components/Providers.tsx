'use client';

import React, { useState } from 'react';
import { ThemeProvider, BaseStyles } from '@primer/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ToastProvider } from '@/lib/toast';
import { useTheme } from '@/lib/theme';

export default function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            refetchOnWindowFocus: false,
            staleTime: 500,
          },
        },
      })
  );
  const { theme } = useTheme();

  return (
    <ThemeProvider colorMode={theme === 'dark' ? 'night' : 'day'} preventSSRMismatch>
      <BaseStyles>
        <QueryClientProvider client={queryClient}>
          <ToastProvider>{children}</ToastProvider>
        </QueryClientProvider>
      </BaseStyles>
    </ThemeProvider>
  );
}
