import { useState, useRef } from "react";
import { useForm } from "react-hook-form";  //For form error handling
import { useNavigate, Link } from "react-router-dom" //For changing routes
import { useAuthContext } from "../../context/AuthContext";
//Adding UI components
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
// Card pieces
import {
  Card,
  CardHeader,
  CardTitle,
  CardContent,
  CardFooter,
} from "@/components/ui/card";
import {
  ApiError,
  getApiErrorMessage,
  isAbortError,
} from "../../api/http-client";

interface SignInFormData {
  email: string;
  password: string;
}

export function SignInPage() {
  // automatic handling of form data
  const { register, handleSubmit, setError, clearErrors,
    formState: { errors } } = useForm<SignInFormData>();
  // import context and its relevant method
  const { signIn } = useAuthContext();
  // set navigate to redirect to relevant pages
  const navigate = useNavigate();
  //to notify failures that can arise only from checking database via backend
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);


  /**
   * Implementation of function onSubmit(data) to handle register
   */
  async function onSubmit(data: SignInFormData) {
    // The ref prevents another request before React renders the disabled button.
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setAuthError(null);
    clearErrors();
    try {
      await signIn(data);
      navigate("/organizations", { replace: true });
    } catch (failure) {
      // A superseded authentication attempt should not navigate or show an error.
      if (isAbortError(failure)) return;
      // Preserve the distinction between wrong credentials and a network failure.
      setAuthError(
        getApiErrorMessage(
          failure,
          "Unable to sign in. Please try again.",
        ),
      );
      if (failure instanceof ApiError) {
        for (const detail of failure.details ?? []) {
          if (
            detail.field === "email" ||
            detail.field === "password"
          ) {
            setError(detail.field, {
              type: "server",
              message: detail.messages.join(" "),
            });
          }
        }
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }

  return (
    // NEW: Card is now the page's own box, matching SignUpPage's pattern.
    // AuthLayout (the parent) only centers this on the page now.
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
      </CardHeader>

      <form
        onSubmit={handleSubmit(onSubmit)}
        aria-busy={isSubmitting}
      >
        {/* NEW: CardContent groups the fields: email and password */}
        <CardContent className="flex flex-col gap-4">
          <div>
            <Label htmlFor="email">Email</Label>
            <Input
              id="email"
              type="email"
              placeholder="member@example.com"
              {...register("email", {
                required: "Email is required",
                maxLength: {
                  value: 254,
                  message: "Email must not exceed 254 characters",
                },
                setValueAs: (value: string) => value.trim().toLowerCase(),
              })}
              disabled={isSubmitting}
            />
            {errors.email && (
              <span className="form-error">{errors.email.message}</span>
            )}
          </div>

          <div>
            <Label htmlFor="password">Password</Label>
            <Input
              id="password"
              type="password"
              placeholder="**********"
              {...register("password", {
                required: "Password is required",
                maxLength: {
                  value: 128,
                  message: "Password must not exceed 128 characters",
                },
              })}
              disabled={isSubmitting}
            />
            {errors.password && (
              <span className="form-error">{errors.password.message}</span>
            )}
          </div>

          {authError && (
            <span role="alert" className="form-error">
              {authError}
            </span>
          )}
        </CardContent>

        {/* NEW: CardFooter holds submit + sign-up link, same as SignUpPage */}
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full" disabled={isSubmitting}>{isSubmitting ? "Signing in…" : "Sign in"}</Button>
          <p className="text-sm">
            Don't have an account? <Link to="/signup">Create one</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

