// Browser Router, enables routing to the components inside it 
import { BrowserRouter} from "react-router-dom"
//Routes, to define different routes
import { Routes, Route} from "react-router-dom"
//Pages
import { SignInPage} from "../pages/auth/SignInPage";
import { SignUpPage} from "../pages/auth/SignUpPage";
import { OrganizationsPage} from "../pages/organizations/OrganizationsPage";
//Layouts
import { AuthLayout } from "../layouts/AuthLayout";
import { AppLayout } from "../layouts/AppLayout";

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
                <Route path="/signin" element={<AuthLayout><SignInPage /></AuthLayout>} />
                <Route path="/signup" element={<AuthLayout><SignUpPage /></AuthLayout>} />
                <Route path="/organizations" element={<OrganizationsPage />} />
                <Route path="*" element={<h1>404 Not Found</h1>}/>
            </Routes>
        </BrowserRouter>
    );
}