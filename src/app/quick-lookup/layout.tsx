import type { Metadata } from 'next';

export const metadata: Metadata = {
  title: 'Quick Lookup - Vocab Agent',
  description: 'Quick word lookup window',
};

export default function QuickLookupLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  // This is a route group layout - just pass through children
  // The root layout already provides <html> and <body>
  return children;
}
