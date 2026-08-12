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
      <body className="flex min-h-full flex-col">
        {children}
        <footer className="shrink-0 border-t border-[#e2e1e8] bg-[#fcf8ff]">
          <div className="mx-auto flex min-h-[94px] w-full max-w-[960px] flex-col justify-center gap-[13px] px-[20px] py-[14px] sm:px-[30px] 2xl:max-w-[1380px]">
            <p className="text-center text-[11px] font-normal leading-[16px] text-[#6b6978]">
              <strong className="font-semibold text-[#555363]">Early Beta:</strong>{" "}
              This portal is currently in its early beta stage. Some information may occasionally be inaccurate or incomplete. For ideas, suggestions, or corrections, please email{" "}
              <a
                className="font-medium text-[#3525cd] transition-colors hover:text-[#1f1599]"
                href="mailto:faisal@crossinghurdles.com"
              >
                faisal@crossinghurdles.com
              </a>
              .
            </p>
            <nav className="flex items-center justify-end gap-[34px] text-[12px] font-medium leading-[16px] text-[#5f5d6d]">
              <a className="transition-colors hover:text-[#3525cd]" href="mailto:stem.support@crossinghurdles.com">
                Contact us
              </a>
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
