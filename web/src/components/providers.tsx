"use client";

import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { httpBatchLink } from "@trpc/client";
import { ThemeProvider } from "next-themes";
import { useState } from "react";
import superjson from "superjson";

import { trpc } from "@/lib/trpc";

export function Providers({ children }: { children: React.ReactNode }) {
  const [queryClient] = useState(
    () =>
      new QueryClient({
        defaultOptions: {
          queries: {
            // React Query retries three times by default, which is right for a
            // dropped connection and wrong for "no such tool" — a 404 or a 403
            // will still be a 404 on the third attempt, and meanwhile the page
            // sits on a spinner instead of saying what happened.
            retry: (failureCount, error) => {
              const status = (error as { data?: { httpStatus?: number } })?.data?.httpStatus;
              if (status && status >= 400 && status < 500) return false;
              return failureCount < 2;
            },
          },
        },
      }),
  );
  const [trpcClient] = useState(() =>
    trpc.createClient({
      links: [httpBatchLink({ url: "/api/trpc", transformer: superjson })],
    }),
  );

  return (
    <trpc.Provider client={trpcClient} queryClient={queryClient}>
      <QueryClientProvider client={queryClient}>
        {/* attribute="class" pairs with the @custom-variant in globals.css.
            disableTransitionOnChange stops every coloured element animating at
            once when the theme flips. */}
        <ThemeProvider attribute="class" defaultTheme="system" enableSystem disableTransitionOnChange>
          {children}
        </ThemeProvider>
      </QueryClientProvider>
    </trpc.Provider>
  );
}
