import {useState, FormEvent} from "react";

export function SignUpPage()
{
    const [email, setEmail] = useState("");
    const [password, setPassword] = useState("")

    function handleSubmit(e: FormEvent) {
        e.preventDefault();
        alert("submitted with email: " + email + " and password: " + password);
    }
    return (
        <form onSubmit={handleSubmit}>
            <h1>Sign up</h1>
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
            <button type="submit">Create account</button>
        </form>
    );
}

// todo: Validate password(+min len) and email are entered: is it frontend or backend job?