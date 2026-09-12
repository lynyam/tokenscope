import { useNavigate } from "react-router-dom";
import { useAuthContext } from "../context/AuthContext";


export function Topbar() {
  const {user, signOut} = useAuthContext();
  const navigate = useNavigate();

  async function handleLogout() {
    await signOut();
    navigate("/signin");
  }

  return (
    <header className="flex items-center h-14 border-b px-6">
      <span className="text-lg font-semibold">TokenScope</span>
    </header>
  );
}


