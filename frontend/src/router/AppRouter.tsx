// Browser Router, enables routing to the components inside it
import { BrowserRouter, Navigate} from "react-router-dom"
//Routes, to define different routes
import { Routes, Route} from "react-router-dom"
//Pages
import { SignInPage} from "../pages/auth/SignInPage";
import { SignUpPage} from "../pages/auth/SignUpPage";
import { OrganizationsPage} from "../pages/organizations/OrganizationsPage";
//Layouts
import { AuthLayout } from "../layouts/AuthLayout";
import { AppLayout } from "../layouts/AppLayout";
import { ProtectedRoute } from "../components/ProtectedRoute";
import { AnonymousRoute } from "../components/AnonymousRoute";
//Custom hook to get the current user
import { useCurrentUser } from "../hooks/useCurrentUser";
import { OrganizationDetailPage } from "../pages/organizations/OrganizationDetailPage";
import { MembersPage } from "../pages/organizations/MembersPage";

//Root redirection
function RootRedirect() {
  const { user, isLoading } = useCurrentUser();

  if (isLoading) return <div>Loading...</div>;
  if (user) return <Navigate to="/organizations" replace />;
  return <Navigate to="/signup" replace />;
}

export function AppRouter()
{
    return(
        <BrowserRouter>
            <Routes>
                <Route path="/" element={<RootRedirect />} />
                <Route path="/signin"
                element={<AnonymousRoute><AuthLayout><SignInPage /></AuthLayout></AnonymousRoute>} />
                <Route path="/signup" element={
                    <AnonymousRoute>
                        <AuthLayout><SignUpPage /></AuthLayout>
                    </AnonymousRoute>
                } />
                <Route
                    path="/organizations"
                    element={
                        <ProtectedRoute>
                            <AppLayout><OrganizationsPage /></AppLayout>
                        </ProtectedRoute>
                    }
                />
                <Route path="/organizations/:organizationId" element={<OrganizationDetailPage />} />
                <Route
                    path="/organizations/:organizationId/members"
                    element={
                    <AppLayout>
						<MembersPage />
					</AppLayout>
                    }
                />
                <Route path="*" element={<h1>404 Not Found</h1>}/>
            </Routes>
        </BrowserRouter>
    );
}
