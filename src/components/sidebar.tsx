"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { Ban, FileText, Inbox, LayoutDashboard, Mail, MailCheck, Megaphone, Settings, Users } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

interface NavItem {
  href: string;
  label: string;
  icon: ReactNode;
}

const NAV: NavItem[][] = [
  [
    { href: "/", label: "Dashboard", icon: <LayoutDashboard /> },
    { href: "/campaigns", label: "Campaigns", icon: <Megaphone /> },
    { href: "/leads", label: "Leads", icon: <Users /> },
    { href: "/templates", label: "Templates", icon: <FileText /> },
  ],
  [
    { href: "/queue", label: "Email Queue", icon: <Inbox /> },
    { href: "/history", label: "Send History", icon: <MailCheck /> },
  ],
  [
    { href: "/suppressions", label: "Suppression", icon: <Ban /> },
    { href: "/settings", label: "Settings", icon: <Settings /> },
  ],
];

function isActive(pathname: string, href: string) {
  if (href === "/") return pathname === "/";
  return pathname === href || pathname.startsWith(`${href}/`);
}

export function Brand() {
  return (
    <Link
      href="/"
      className="flex items-center gap-2 rounded-md text-base font-bold tracking-[0.2em] text-slate-900 focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none"
    >
      <span className="flex size-7 items-center justify-center rounded-lg bg-indigo-600 text-white">
        <Mail className="size-4" aria-hidden="true" />
      </span>
      MAIL
    </Link>
  );
}

export function Sidebar({ onNavigate }: { onNavigate?: () => void }) {
  const pathname = usePathname();
  return (
    <div className="flex h-full flex-col">
      <div className="flex h-14 shrink-0 items-center border-b border-slate-200 px-5">
        <Brand />
      </div>
      <nav className="flex-1 overflow-y-auto px-3 py-4" aria-label="Main">
        {NAV.map((group, gi) => (
          <ul key={gi} className={cn("space-y-0.5", gi > 0 && "mt-3 border-t border-slate-200 pt-3")}>
            {group.map((item) => {
              const active = isActive(pathname, item.href);
              return (
                <li key={item.href}>
                  <Link
                    href={item.href}
                    onClick={onNavigate}
                    aria-current={active ? "page" : undefined}
                    className={cn(
                      "flex items-center gap-3 rounded-lg px-3 py-2 text-sm font-medium transition-colors focus-visible:ring-2 focus-visible:ring-indigo-500 focus-visible:outline-none [&_svg]:size-4",
                      active ? "bg-indigo-50 text-indigo-700" : "text-slate-600 hover:bg-slate-100 hover:text-slate-900",
                    )}
                  >
                    <span className={active ? "text-indigo-600" : "text-slate-400"}>{item.icon}</span>
                    {item.label}
                  </Link>
                </li>
              );
            })}
          </ul>
        ))}
      </nav>
      <div className="border-t border-slate-200 px-5 py-3 text-xs text-slate-400">Internal outreach tool</div>
    </div>
  );
}
