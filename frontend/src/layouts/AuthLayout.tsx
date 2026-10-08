import { ReactNode } from "react";

/*MODIFIED: replaced the old "auth-page-wrapper"/"auth-card" custom CSS
classes with Tailwind utilities. This div now ONLY centers the page —
it no longer renders its own card box, since each page renders its
own <Card> now. This removes the double-wrapping that caused the
misaligned layout you saw earlier.
*/

export function AuthLayout({ children }: { children: ReactNode }) {
  return (
    <div className="flex min-h-screen items-center justify-center bg-background p-4">
      {children}
    </div>
  );
}