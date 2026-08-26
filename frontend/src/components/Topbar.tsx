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
    <header className="topbar">
      <span>{user?.displayName}</span>
      <button onClick={handleLogout}>Log out</button>
    </header>
  );
}


