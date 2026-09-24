"use client";

import { useState, type ReactNode } from "react";
import { Sidebar } from "@/components/sidebar";
import { Topbar } from "@/components/topbar";
import { Drawer } from "@/components/ui/modal";

export function AppShell({ children }: { children: ReactNode }) {
  const [menuOpen, setMenuOpen] = useState(false);

  return (
    <div className="min-h-dvh">
      <a
        href="#main"
        className="sr-only z-50 rounded-md bg-white px-3 py-2 text-sm font-medium text-indigo-700 shadow focus:not-sr-only focus:fixed focus:top-2 focus:left-2"
      >
        Skip to content
      </a>

      {/* Desktop sidebar */}
      <aside className="fixed inset-y-0 left-0 z-40 hidden w-60 border-r border-slate-200 bg-white lg:block">
        <Sidebar />
      </aside>

      {/* Mobile drawer */}
      <Drawer open={menuOpen} onClose={() => setMenuOpen(false)} title="Navigation" side="left" width="max-w-[17rem]" hideHeader>
        <div id="mobile-nav" className="h-full">
          <Sidebar onNavigate={() => setMenuOpen(false)} />
        </div>
      </Drawer>

      <div className="flex min-h-dvh min-w-0 flex-col lg:pl-60">
        <Topbar onOpenMenu={() => setMenuOpen(true)} menuOpen={menuOpen} />
        <main id="main" className="mx-auto w-full max-w-7xl min-w-0 flex-1 px-4 py-6 sm:px-6 lg:px-8">
          {children}
        </main>
      </div>
    </div>
  );
}
