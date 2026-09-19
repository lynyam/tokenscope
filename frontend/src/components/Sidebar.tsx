import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { UserMenu } from "./UserMenu";
import { Separator } from "../components/ui/separator"; 

export function Sidebar() {
  return (
    <aside className="flex h-full w-56 flex-col border-r p-4">
      <span className="text-lg font-semibold">TokenScope</span>
      <nav className="flex flex-1 flex-col gap-1">
        {/* tes liens de nav ici */}
      </nav>

      <div className="flex flex-col gap-3">
        <OrganizationSwitcher />
        <Separator />
        <UserMenu />
      </div>
    </aside>
  );
}