import {BrowserRouter} from "react-router-dom"
// Browser Router, enables routing to the components inside it 
import {Routes, Route} from "react-router-dom"
//Routes, to define different routes
import {SignInPage} from "../pages/auth/SignInPage";
import {SignUpPage} from "../pages/auth/SignUpPage";
import {OrganizationsPage} from "../pages/organizations/OrganizationsPage";

function HomePage()
{
    return <h1>Home Page</h1>;
}
export function AppRouter()
{
    return(
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<HomePage />} />
                <Route path="/signin" element={<SignInPage />} />
                <Route path="/signup" element={<SignUpPage />} />
                <Route path="/organizations" element={<OrganizationsPage />} />
            </Routes>
        </BrowserRouter>
    );
}