import { useState, FormEvent } from "react";
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


interface SignInFormData {
  email: string;
  password: string;
}

export function SignInPage()
{    
    // automatic handling of form data
    const {register, handleSubmit, formState: { errors }} = useForm<SignInFormData>();
    // import context and its relevant method
    const { signIn } = useAuthContext();  
    // set navigate to redirect to relevant pages
    const navigate = useNavigate();
      //to notify failures that can arise only from checking database via backend
    const [authError, setAuthError] = useState<string | null>(null);

    /**
     * Implementation of function onSubmit(data) to handle register
     */
    async function onSubmit(data: SignInFormData) {
        setAuthError(null);
        try {
            await signIn(data);
            navigate("/organizations");
        } catch (err) {
        setAuthError("Invalid email or password.");
        }
    }

  return (
    // NEW: Card is now the page's own box, matching SignUpPage's pattern.
    // AuthLayout (the parent) only centers this on the page now.
    <Card className="w-full max-w-sm">
      <CardHeader>
        <CardTitle>Sign In</CardTitle>
      </CardHeader>

      <form onSubmit={handleSubmit(onSubmit)}>
        {/* NEW: CardContent groups the fields: email and password */}
        <CardContent className="flex flex-col gap-4">
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
              {...register("password", { required: "Password is required" })}
            />
            {errors.password && (
              <span className="form-error">{errors.password.message}</span>
            )}
          </div>

          {authError && <span className="form-error">{authError}</span>}
        </CardContent>

        {/* NEW: CardFooter holds submit + sign-up link, same as SignUpPage */}
        <CardFooter className="flex flex-col gap-3">
          <Button type="submit" className="w-full">Sign in</Button>
          <p className="text-sm">
            Don't have an account? <Link to="/signup">Create one</Link>
          </p>
        </CardFooter>
      </form>
    </Card>
  );
}

