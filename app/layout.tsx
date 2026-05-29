import type { Metadata } from 'next';
import './globals.css';
import { AppContextProvider } from '@/context/AppContext';

export const metadata: Metadata = {
  title: 'Ape X Job Hunt',
  description: 'AI powered job search and ATS resume optimizer',
  icons: {
    icon: 'https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/72930258-cb9d-4707-a6f0-10796608123b.png?h=6bddd8652361a42e952da7a8b9ff00c4',
  },
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <link
          rel="icon"
          href="https://cdn.myportfolio.com/abc1e0ab-7370-4502-8c78-92428397bf66/72930258-cb9d-4707-a6f0-10796608123b.png?h=6bddd8652361a42e952da7a8b9ff00c4"
        />
      </head>
      <body>
        <AppContextProvider>{children}</AppContextProvider>
      </body>
    </html>
  );
}
