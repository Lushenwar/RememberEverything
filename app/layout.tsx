import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Link from "next/link";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

export const metadata: Metadata = {
  title: "Remember Everything",
  description:
    "A cognitive-science memory engine: dual coding, Feynman interrogation, FSRS scheduling.",
};

// Grows as phases land; a link here means the route exists.
const NAV = [
  ["/", "Graph"],
  ["/ingest", "Ingest"],
] as const;

export default function RootLayout({
  children,
}: Readonly<{
  children: React.ReactNode;
}>) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <body className="min-h-full flex flex-col">
        <header className="border-b border-border">
          <nav className="mx-auto flex max-w-5xl items-center gap-8 px-6 py-4">
            <Link href="/" className="font-mono text-sm tracking-tight text-accent">
              remember.everything
            </Link>
            <div className="flex gap-5 text-sm">
              {NAV.map(([href, label]) => (
                <Link
                  key={href}
                  href={href}
                  className="text-muted transition-colors hover:text-foreground"
                >
                  {label}
                </Link>
              ))}
            </div>
          </nav>
        </header>
        <main className="mx-auto w-full max-w-5xl flex-1 px-6 py-10">{children}</main>
      </body>
    </html>
  );
}
