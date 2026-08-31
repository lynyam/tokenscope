import { useState, FormEvent } from "react";
import { useForm } from "react-hook-form";  //For form error handling 
import { useNavigate } from "react-router-dom" //For changing routes
import { useAuthContext } from "../../context/AuthContext";


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
                <label htmlFor="email">Email</label>
                <input 
                    type ="email" 
                    placeholder="member@example.com"
                    {...register("email", { required: "Email is required"})}
                />
                {errors.email && (<span className="form-error">{errors.email.message}</span>)}
            </div>
            <div>
                <label htmlFor="password">Password</label>
                <input
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
        <button type="submit">Sign in</button>
    </form>
    );
}

