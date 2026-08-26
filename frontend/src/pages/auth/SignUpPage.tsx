import { useState } from "react";
import { useForm } from "react-hook-form";
import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../../context/AuthContext";

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
    <form onSubmit={handleSubmit(onSubmit)}>
      <h1>Sign up</h1>

      <div>
        <label htmlFor="displayName">Name</label>
        <input
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
        <label htmlFor="email">Email</label>
        <input
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
        <label htmlFor="password">Password</label>
        <input
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

      <button type="submit">Create account</button>
    </form>
  );
}