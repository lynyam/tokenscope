import { useEffect, type ReactNode } from "react";
import { Link } from "react-router-dom";
import { LegalLinks } from "../components/LegalLinks";

interface LegalLayoutProps {
  title: string;
  children: ReactNode;
}

const linkClasses =
  "rounded-sm underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function LegalLayout({ title, children }: LegalLayoutProps) {
  useEffect(() => {
    const previousTitle = document.title;
    document.title = `${title} — TokenScope`;

    return () => {
      document.title = previousTitle;
    };
  }, [title]);

  return (
    <div className="min-h-screen bg-background text-foreground">
      <header className="border-b border-border">
        <div className="mx-auto max-w-3xl px-6 py-5">
          <Link
            to="/"
            className="inline-flex items-center gap-2 rounded-sm font-semibold focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring"
          >
            <img
              src="/logo/logo.svg"
              alt=""
              className="size-7 rounded bg-white p-1"
            />
            TokenScope
          </Link>
        </div>
      </header>

      <main className="mx-auto max-w-3xl px-6 py-12 sm:py-16">
        <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
          {title}
        </h1>

        <p className="mt-4 text-sm text-muted-foreground">
          Last updated: <time dateTime="2026-10-03">3 October 2026</time>
        </p>

        <div className="mt-10 space-y-10 wrap-break-word leading-relaxed [&_h2]:mb-4 [&_h2]:font-heading [&_h2]:text-xl [&_h2]:font-semibold [&_p+p]:mt-4 [&_ul]:mt-4 [&_ul]:list-disc [&_ul]:space-y-2 [&_ul]:pl-6 [&_a]:underline [&_a]:underline-offset-4 [&_a]:focus-visible:outline-2 [&_a]:focus-visible:outline-offset-4 [&_a]:focus-visible:outline-ring">
          {children}
        </div>
      </main>

      <footer className="mx-auto max-w-3xl border-t border-border px-6 py-8">
        <LegalLinks />

        <p className="mt-6 text-center text-sm text-muted-foreground">
          <Link to="/" className={linkClasses}>
            Back to home
          </Link>
        </p>
      </footer>
    </div>
  );
}