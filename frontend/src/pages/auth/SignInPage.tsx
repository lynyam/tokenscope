import { useState, FormEvent } from "react";

export function SignInPage()
{
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("");

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        alert("submitted with email: " + email + " and password: " + password);
    }
    return (
    <form onSubmit={handleSubmit}>
        <h1>Sign In</h1>
            <div>
                <label>
                    Email 
                    <input 
                    type ="email"
                    placeholder="...@..."
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    />
                </label>
            </div>
            
            <div>
                <label>
                    Password 
                    <input 
                        type="password"
                        placeholder="**********"
                        value={password}
                        onChange={(e) => setPassword(e.target.value)}
                    />
                </label>
            </div>
            <button type="submit">Sign in</button>
    </form>
    
    );
}