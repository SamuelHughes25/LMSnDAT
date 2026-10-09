import type { Metadata } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import Script from "next/script";
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
  title: "LMS",
  description: "Internal audit template platform",
};

export default function RootLayout({ children }: LayoutProps<"/">) {
  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        {/* Applies the stored dark-mode preference (see theme-toggle.tsx)
            synchronously, before first paint — strategy="beforeInteractive"
            is next/script's dedicated mechanism for exactly this ("run
            before hydration so there's no flash of the wrong theme").
            A raw JSX <script> tag here looks equivalent on a full page
            load (the browser just parses and runs it natively), but React
            treats a literal <script> element as a client-rendered node on
            any soft client-side navigation that re-renders this tree —
            which it never actually executes, throwing "Encountered a
            script tag while rendering React component" the first time a
            learner navigated into the course player. next/script's
            beforeInteractive strategy injects the script through Next's
            own runtime instead of React's normal element reconciliation,
            so it never hits that restriction. */}
        <Script
          id="theme-init"
          strategy="beforeInteractive"
          dangerouslySetInnerHTML={{
            __html:
              'try{if(localStorage.getItem("lms-theme")==="dark")document.documentElement.classList.add("dark")}catch(e){}',
          }}
        />
      </head>
      <body className="min-h-full flex flex-col">{children}</body>
    </html>
  );
}
