import { useNavigate } from "react-router-dom";


export function Topbar() {
  const navigate = useNavigate();

  function handleLogout() {
    navigate("/signin");
  }

  return (
    <header className="topbar">
      <button onClick={handleLogout}>Log out</button>
    </header>
  );
}
