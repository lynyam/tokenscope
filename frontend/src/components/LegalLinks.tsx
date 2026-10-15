import { Link } from "react-router-dom";

const linkClasses =
  "rounded-sm text-muted-foreground underline underline-offset-4 hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function LegalLinks({
  className = "",
}: {
  className?: string;
}) {
  return (
    <nav
      aria-label="Legal information"
      className={`flex flex-wrap items-center justify-center gap-x-6 gap-y-3 text-sm ${className}`}
    >
      <Link to="/privacy" className={linkClasses}>
        Privacy Policy
      </Link>

      <Link to="/terms" className={linkClasses}>
        Terms of Service
      </Link>
    </nav>
  );
}