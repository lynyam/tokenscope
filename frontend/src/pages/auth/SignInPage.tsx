import { useState, FormEvent } from "react";
import { useForm } from "react-hook-form";  //For form error handling 
import { useNavigate, Link } from "react-router-dom" //For changing routes
import { useAuthContext } from "../../context/AuthContext";
//Adding UI components 
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";



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
    <form onSubmit={handleSubmit(onSubmit)}>
        <h1>Sign In</h1>

            <div>
                <Label htmlFor="email">Email</Label>
                <Input 
                    id="email"
                    type ="email" 
                    placeholder="member@example.com"
                    {...register("email", { required: "Email is required"})}
                />
                {errors.email && (<span className="form-error">{errors.email.message}</span>)}
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
        <Button type="submit">Sign in</Button>

        <p>
          Don't have an account? <Link to="/signup">Create one</Link>
        </p>
    </form>
    );
}

