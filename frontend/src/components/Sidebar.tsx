import { Link, useNavigate } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";
import { Button } from "@/components/ui/button";
import { LogOut } from "lucide-react";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";

export function Sidebar() {
  const { user, signOut } = useAuthContext();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    navigate("/signin");
  }

  return (
    <aside className="flex h-screen w-56 flex-col justify-between border-r p-4">
      <div className="flex flex-col gap-4">
        <nav className="flex flex-col gap-1">
          <Link to="/organizations" className="rounded-md px-3 py-2 text-sm font-medium bg-muted">
            Organizations
          </Link>
        </nav>
      </div>
      <div className="flex justify-between gap-3 border-t pt-4">
        <div className="flex items-center gap-2 px-3">
          <Avatar>
            <AvatarFallback>{user?.displayName?.charAt(0).toUpperCase()}</AvatarFallback>
          </Avatar>
          <span className="text-sm font-medium">{user?.displayName}</span>
        </div>
        <Button variant="outline" onClick={handleLogout} className="text-red-600">
          <LogOut className="h-4 w-4" />
        </Button>
      </div>
    </aside>
  );
}