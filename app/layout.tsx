import type { Metadata } from 'next';
import './globals.css';

export const metadata: Metadata = {
  title: 'Foresee — Simulate Before You Act',
  description: 'A transaction-backed simulation gateway for high-stakes agent writes.'
};

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="en"><body>{children}</body></html>;
}
