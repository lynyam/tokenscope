import {useState, FormEvent} from "react";

export function SignUpPage()
{
    const [email, setEmail] = useState("");
    return (
        <form>
            <h1>Sign up</h1>
            <input 
            type ="email"
            placeholder="Email..."
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            />
        </form>
    );
}