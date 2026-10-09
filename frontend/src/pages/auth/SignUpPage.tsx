import { useState, useRef } from "react";
import { useForm } from "react-hook-form";
import { useNavigate, Link } from "react-router-dom";
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

interface SignUpFormData {
  email: string;
  password: string;
  displayName: string;
}

export function SignUpPage() {
  //automatic handling of form data
  const { register, handleSubmit, setError, clearErrors,
    formState: { errors } } = useForm<SignUpFormData>();
  // import context and its relevant method
  const { signUp } = useAuthContext();
  // set navigate to redirect to relevant pages
  const navigate = useNavigate();
  //to notify failures that can arise only from checking database via backend
  const [authError, setAuthError] = useState<string | null>(null);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const submitting = useRef(false);

  async function onSubmit(data: SignUpFormData) {
    if (submitting.current) return;
    submitting.current = true;
    setIsSubmitting(true);
    setAuthError(null);
    clearErrors();
    try {
      await signUp(data);
      navigate("/organizations", { replace: true });
    } catch (failure) {
      if (isAbortError(failure)) return;
      setAuthError(
        getApiErrorMessage(
          failure,
          "Unable to create your account. Please try again.",
        ),
      );

      if (failure instanceof ApiError) {
        for (const detail of failure.details ?? []) {
          if (
            detail.field === "email" ||
            detail.field === "password" ||
            detail.field === "displayName"
          ) {
            setError(detail.field, {
              type: "server",
              message: detail.messages.join(" "),
            });
          }
        }

        // API.md defines this conflict specifically for duplicate registration.
        if (failure.code === "EMAIL_ALREADY_EXISTS") {
          setError("email", {
            type: "server",
            message: failure.message,
          });
        }
      }
    } finally {
      submitting.current = false;
      setIsSubmitting(false);
    }
  }
  return (
    // NEW: Card replaces the bare <form> as the outer wrapper
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign up</CardTitle>
      </CardHeader>

      <form
        onSubmit={handleSubmit(onSubmit)}
        aria-busy={isSubmitting}
      >
        {/* NEW: CardContent groups the form fields */}
        <CardContent className="flex flex-col gap-4">
          <div>
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="Pepito Perez"
              {...register("displayName", {
                required: "Name is required",
                maxLength: {
                  value: 80,
                  message: "Name must not exceed 80 characters",
                },
                setValueAs: (value: string) => value.trim(),
              })}
              disabled={isSubmitting}
            />
            {errors.displayName && (
              <span className="form-error">{errors.displayName.message}</span>
            )}
          </div>

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
                minLength: {
                  value: 8,
                  message: "Password must be at least 8 characters",
                },
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

        {/* NEW: CardFooter holds the submit button and sign-in link */}
        <CardFooter className="flex flex-col gap-3">
          <Button
            type="submit"
            className="w-full"
            disabled={isSubmitting}
          >
            {isSubmitting ? "Creating account…" : "Create account"}
          </Button>
          <p className="text-sm">
            Already have an account? <Link to="/signin">Sign in</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );

}
