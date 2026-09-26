import { useState } from "react";
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

interface SignUpFormData {
  email: string;
  password: string;
  displayName: string;
}

export function SignUpPage() {
  //automatic handling of form data
  const { register, handleSubmit, formState: { errors } } = useForm<SignUpFormData>();
  // import context and its relevant method
  const { signUp } = useAuthContext();
  // set navigate to redirect to relevant pages
  const navigate = useNavigate();
  //to notify failures that can arise only from checking database via backend
  const [authError, setAuthError] = useState<string | null>(null);

  async function onSubmit(data: SignUpFormData) {
    setAuthError(null);
    try {
      await signUp(data);
      navigate("/organizations");
    } catch (err) {
      setAuthError("Unable to create account. Please try again.");
    }
  }
    return (
    // NEW: Card replaces the bare <form> as the outer wrapper
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign up</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* NEW: CardContent groups the form fields */}
        <CardContent className="flex flex-col gap-4">
          <div>
            <Label htmlFor="displayName">Name</Label>
            <Input
              id="displayName"
              type="text"
              placeholder="Pepito Perez"
              {...register("displayName", { required: "Name is required" })}
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
              {...register("email", { required: "Email is required" })}
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
                minLength: { value: 8, message: "Password must be at least 8 characters" },
              })}
            />
            {errors.password && (
              <span className="form-error">{errors.password.message}</span>
            )}
          </div>

          {authError && <span className="form-error">{authError}</span>}
        </CardContent>

        {/* NEW: CardFooter holds the submit button and sign-in link */}
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full">Create account</Button>
          <p className="text-sm">
            Already have an account? <Link to="/signin">Sign in</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );

}