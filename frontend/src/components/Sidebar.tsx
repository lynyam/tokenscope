import { Link } from "react-router-dom";

export function Sidebar() {
  return (
    <aside className="sidebar">
      <nav>
        <ul>
          <li><Link to="/organizations">Organizations</Link></li>
        </ul>
      </nav>
    </aside>
  );
}