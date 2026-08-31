"use client";

import { FolderTree, Inbox, LayoutDashboard, Wrench } from "lucide-react";
import Link from "next/link";
import { usePathname } from "next/navigation";

import { ThemeToggle } from "./theme-toggle";

const VIEWS = [
  { href: "/", label: "Dashboard", Icon: LayoutDashboard },
  { href: "/files", label: "Experiments", Icon: FolderTree },
  { href: "/tools", label: "Tools", Icon: Wrench },
  { href: "/wraps", label: "Wrap runs", Icon: Inbox },
] as const;

/**
 * The rail. Two surfaces of the same system: the dashboard is what you keep in
 * front of you, the file tree is where the work actually lives.
 */
export function AppShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();

  return (
    <div className="flex min-h-screen w-full">
      <main className="min-w-0 flex-1">{children}</main>

      <nav
        aria-label="Views"
        className="sticky top-0 flex h-screen w-14 shrink-0 flex-col items-center gap-1 border-l border-slate-200 bg-white py-3 dark:border-slate-800 dark:bg-slate-900"
      >
        {VIEWS.map(({ href, label, Icon }) => {
          const active = href === "/" ? pathname === "/" : pathname.startsWith(href);
          return (
            <Link
              key={href}
              href={href}
              title={label}
              aria-label={label}
              aria-current={active ? "page" : undefined}
              className={`flex h-10 w-10 items-center justify-center rounded-lg transition-colors ${
                active
                  ? "bg-slate-900 text-white dark:bg-white dark:text-slate-900"
                  : "text-slate-400 hover:bg-slate-100 hover:text-slate-700 dark:hover:bg-slate-800 dark:hover:text-slate-200"
              }`}
            >
              <Icon size={18} />
            </Link>
          );
        })}

        <span className="mt-auto">
          <ThemeToggle />
        </span>
      </nav>
    </div>
  );
}
