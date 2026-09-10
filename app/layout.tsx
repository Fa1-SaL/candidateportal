import type { Metadata, Viewport } from "next";
import { Manrope } from "next/font/google";
import "./globals.css";

const manrope = Manrope({
  variable: "--font-manrope",
  subsets: ["latin"],
  display: "swap",
});

export const metadata: Metadata = {
  title: "Candidate Portal",
  description: "Crossing Hurdles candidate assignment dashboard",
  icons: {
    icon: [
      { url: "/favicon.ico", sizes: "any" },
      { url: "/favicon.png", type: "image/png" },
    ],
    shortcut: "/favicon.ico",
    apple: "/apple-icon.png",
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${manrope.variable} h-full antialiased`}
    >
      <body className="flex min-h-dvh flex-col">
        <a className="skip-link" href="#main-content">Skip to content</a>
        {children}
        <footer className="portal-footer">
          <div>
            <p>
              Questions about your records? Contact{" "}
              <a
                className="font-medium text-[#3525cd] transition-colors hover:text-[#1f1599]"
                href="mailto:faisal@crossinghurdles.com"
              >
                faisal@crossinghurdles.com
              </a>
              .
            </p>
            <nav aria-label="Related websites" className="flex flex-wrap items-center gap-6">
              <a className="transition-colors hover:text-[#3525cd]" href="https://experts.snorkel-ai.com/">
                Snorkel
              </a>
              <a className="transition-colors hover:text-[#3525cd]" href="https://crossinghurdles.com/">
                Crossing Hurdles
              </a>
            </nav>
          </div>
        </footer>
      </body>
    </html>
  );
}
