"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { LogOut, Menu } from "lucide-react";
import { toast } from "sonner";
import { api } from "@/lib/client/api";
import { Button } from "@/components/ui/button";
import { UsageMeter } from "@/components/usage-meter";
import { Brand } from "@/components/sidebar";
import { errorMessage } from "@/lib/utils";

export function Topbar({ onOpenMenu, menuOpen }: { onOpenMenu: () => void; menuOpen: boolean }) {
  const router = useRouter();
  const [loggingOut, setLoggingOut] = useState(false);

  async function logout() {
    setLoggingOut(true);
    try {
      await api.post("/api/auth/logout");
      router.replace("/login");
      router.refresh();
    } catch (err) {
      toast.error(`Logout failed: ${errorMessage(err)}`);
      setLoggingOut(false);
    }
  }

  return (
    <header className="sticky top-0 z-30 flex h-14 shrink-0 items-center gap-3 border-b border-slate-200 bg-white/90 px-4 backdrop-blur sm:px-6">
      <Button
        variant="ghost"
        size="icon"
        className="-ml-2 lg:hidden"
        onClick={onOpenMenu}
        aria-label="Open navigation"
        aria-expanded={menuOpen}
        aria-controls="mobile-nav"
      >
        <Menu />
      </Button>
      <div className="lg:hidden">
        <Brand />
      </div>
      <div className="ml-auto flex items-center gap-2 sm:gap-3">
        <UsageMeter />
        <Button variant="ghost" size="sm" onClick={logout} loading={loggingOut} aria-label="Log out">
          {!loggingOut && <LogOut />}
          <span className="hidden sm:inline">Logout</span>
        </Button>
      </div>
    </header>
  );
}
