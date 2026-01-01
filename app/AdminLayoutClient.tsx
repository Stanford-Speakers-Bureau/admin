"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

type NavItem = {
  href: string;
  label: string;
  icon: string;
};

type AdminLayoutClientProps = {
  children: React.ReactNode;
  userEmail: string | null;
  navItems: NavItem[];
  emailDisabled: boolean;
  hasLiveEvent: boolean;
};

export default function AdminLayoutClient({
  children,
  userEmail,
  navItems,
  emailDisabled,
  hasLiveEvent,
}: AdminLayoutClientProps) {
  const pathname = usePathname();

  return (
    <div className="min-h-screen bg-zinc-950">
      {/* Top Navigation Bar */}
      <nav className="fixed top-0 left-0 right-0 h-16 bg-zinc-900/80 backdrop-blur-xl border-b border-zinc-800 z-50">
        <div className="h-full max-w-7xl mx-auto px-4 sm:px-6 flex items-center justify-between">
          <div className="flex items-center gap-4 md:gap-8">
            <Link href="/" prefetch={false} className="flex items-center gap-3">
              <div className="w-8 h-8 bg-gradient-to-br from-rose-500 to-orange-500 rounded flex items-center justify-center">
                <svg
                  className="w-5 h-5 text-white"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d="M13 10V3L4 14h7v7l9-11h-7z"
                  />
                </svg>
              </div>
              <span className="text-white font-bold text-lg font-serif">
                SSB Admin
              </span>
            </Link>

            <div className="hidden md:flex items-center gap-1">
              {navItems.map((item) => {
                const isActive = pathname === item.href;
                return (
                  <Link
                    key={item.href}
                    href={item.href}
                    prefetch={false}
                    className={`flex items-center gap-2 px-4 py-2 rounded text-sm font-medium transition-all ${
                      isActive
                        ? "bg-rose-500/10 text-rose-400"
                        : "text-zinc-400 hover:text-white hover:bg-zinc-800"
                    }`}
                  >
                    <svg
                      className="w-4 h-4"
                      fill="none"
                      stroke="currentColor"
                      viewBox="0 0 24 24"
                    >
                      <path
                        strokeLinecap="round"
                        strokeLinejoin="round"
                        strokeWidth={2}
                        d={item.icon}
                      />
                    </svg>
                    {item.label}
                  </Link>
                );
              })}
            </div>
          </div>

          <div className="flex items-center gap-4">
            <Link
              href="https://stanfordspeakersbureau.com"
              prefetch={false}
              className="flex items-center gap-2 px-3 py-1.5 text-sm text-zinc-400 hover:text-white transition-colors"
            >
              <svg
                className="w-4 h-4"
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  strokeWidth={2}
                  d="M10 19l-7-7m0 0l7-7m-7 7h18"
                />
              </svg>
              Exit
            </Link>
          </div>
        </div>
      </nav>

      {/* Mobile Bottom Navigation */}
      <nav className="md:hidden fixed bottom-0 left-0 right-0 h-16 bg-zinc-900/95 backdrop-blur-xl border-t border-zinc-800 z-50">
        <div className="h-full flex items-center gap-1 px-2 overflow-x-auto scrollbar-hide">
          {navItems.map((item) => {
            const isActive = pathname === item.href;
            return (
              <Link
                key={item.href}
                href={item.href}
                prefetch={false}
                className={`flex flex-col items-center gap-1 px-3 py-2 rounded transition-all shrink-0 ${
                  isActive ? "text-rose-400" : "text-zinc-500 hover:text-white"
                }`}
              >
                <svg
                  className="w-5 h-5"
                  fill="none"
                  stroke="currentColor"
                  viewBox="0 0 24 24"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    strokeWidth={2}
                    d={item.icon}
                  />
                </svg>
                <span className="text-xs">{item.label}</span>
              </Link>
            );
          })}
        </div>
      </nav>

      {/* Global Live Event Border & Banner */}
      {hasLiveEvent && (
        <>
          {/* Red border around entire screen - split into 4 edges to avoid blocking nav */}
          <div className="fixed top-0 left-0 right-0 h-1 bg-red-500 z-[100] pointer-events-none" />
          <div className="fixed bottom-0 left-0 right-0 h-1 bg-red-500 z-[100] pointer-events-none" />
          <div className="fixed top-0 bottom-0 left-0 w-1 bg-red-500 z-[100] pointer-events-none" />
          <div className="fixed top-0 bottom-0 right-0 w-1 bg-red-500 z-[100] pointer-events-none" />
          {/* Text at very top */}
          <div className="fixed top-0 left-0 right-0 z-[100] flex justify-center pointer-events-none">
            <div className="bg-red-500 px-4 py-1 rounded-b-md flex items-center gap-2">
              <svg
                className="w-4 h-4 text-white shrink-0"
                fill="currentColor"
                viewBox="0 0 20 20"
              >
                <path
                  fillRule="evenodd"
                  d="M10 18a8 8 0 100-16 8 8 0 000 16zM9.555 7.168A1 1 0 008 8v4a1 1 0 001.555.832l3-2a1 1 0 000-1.664l-3-2z"
                  clipRule="evenodd"
                />
              </svg>
              <p className="text-white text-sm font-bold">EVENT LIVE</p>
            </div>
          </div>
        </>
      )}

      {/* Global Email Disabled Banner */}
      {emailDisabled && (
        <div className="fixed top-16 left-0 right-0 z-40 bg-amber-500/10 border-b border-amber-500/30 backdrop-blur-sm">
          <div className="max-w-7xl mx-auto px-4 sm:px-6 py-3 flex items-center gap-3">
            <svg
              className="w-5 h-5 text-amber-400 shrink-0"
              fill="none"
              stroke="currentColor"
              viewBox="0 0 24 24"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-2.5L13.732 4c-.77-.833-1.732-.833-2.5 0L3.732 16.5c-.77.833.192 2.5 1.732 2.5z"
              />
            </svg>
            <p className="text-amber-400 text-sm font-medium">
              EMAIL SENDING DISABLED
            </p>
          </div>
        </div>
      )}

      {/* Main Content */}
      <main
        className={`pb-20 md:pb-8 min-h-screen ${
          emailDisabled ? "pt-[104px]" : "pt-16"
        }`}
      >
        {children}
      </main>
    </div>
  );
}
