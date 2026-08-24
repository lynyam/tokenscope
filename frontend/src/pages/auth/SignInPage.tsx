import { useState, FormEvent } from "react";
import { useForm } from "react-hook-form";  //For form error handling 
import { useNavigate } from "react-router-dom" //For changing routes

//TODO: Add hook
//add library with npm 
//the hook has error messages as well

export function SignInPage()
{
    // const [email, setEmail] = useState("");
    // const [password, setPassword] = useState("");
    
    const {register, handleSubmit} = useForm();
    /*
     *TODO: replace 2 useState
     * const {register, handleSubmit} = useForm();
     */
    /**
     * Implementation of function onSubmit(data) to handle register
     * 
     */

    function onSubmit(data) {
        result = 
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
                    // TODO: call register function of use useForm hook, delete onChange, register does the job (46:50)
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