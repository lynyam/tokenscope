import { Link } from "react-router-dom";
import { buttonVariants } from "./ui/button";

const signupFocusClasses =
  "focus-visible:outline-solid! focus-visible:outline-4! focus-visible:outline-offset-4! focus-visible:outline-amber-400! focus-visible:ring-0!";

export const sectionLinkClasses =
  "rounded-sm text-sm text-muted-foreground hover:text-foreground focus-visible:outline-2 focus-visible:outline-offset-4 focus-visible:outline-ring";

export function LandingActions({
  isLoggedIn,
  size,
  showLogin = true,
}: {
  isLoggedIn: boolean;
  size: "sm" | "lg";
  showLogin?: boolean;
}) {
  if (isLoggedIn) {
    return (
      <Link
        to="/organizations"
        className={buttonVariants({
          size,
          className: signupFocusClasses,
        })}
      >
        Dashboard
      </Link>
    );
  }

  return (
    <>
      {showLogin && (
        <Link
          to="/signin"
          className={buttonVariants({ variant: "outline", size })}
        >
          Log in
        </Link>
      )}

      <Link
        to="/signup"
        className={buttonVariants({
          size,
          className: signupFocusClasses,
        })}
      >
        Try TokenScope
      </Link>
    </>
  );
}

export function LandingHeader({ isLoggedIn }: { isLoggedIn: boolean }) {
  return (
    <header className="border-b border-border">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-4 px-6 py-5">
        <Link to="/" className="flex items-center gap-2 font-semibold">
          <img
            src="/logo/logo.svg"
            alt=""
            className="size-7 rounded bg-white p-1"
          />
          TokenScope
        </Link>

        <a href="#product" className={sectionLinkClasses}>
          Product
        </a>

        <a href="#audience" className={sectionLinkClasses}>
          Who it’s for
        </a>

        <a href="#how-it-works" className={sectionLinkClasses}>
          How it works
        </a>

        <LandingActions isLoggedIn={isLoggedIn} size="sm" />
      </div>
    </header>
  );
}