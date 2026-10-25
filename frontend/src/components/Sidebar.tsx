import { useEffect, useState } from "react";
import { Menu } from "lucide-react";
import { Dialog, DialogContent, DialogTitle, DialogTrigger } from "./ui/dialog";
import { Button } from "./ui/button";
import { ThemeToggle } from "./ThemeToggle";
import { OrganizationSwitcher } from "./OrganizationSwitcher";
import { UserMenu } from "./UserMenu";
import { CollapsibleNavItem } from "./ProjectMenu";
import { Separator } from "../components/ui/separator";
import { Link, useLocation, useParams } from "react-router-dom";
import { useOrganizationProjects } from "../hooks/useOrganizationProjects";


export function Sidebar() {
	const { organizationId } = useParams();
	const {
		projects,
		isLoading,
		error,
		reload,
		accessLost,
	} = useOrganizationProjects(organizationId);

	const [open, setOpen] = useState(false);
	const [desktop, setDesktop] = useState(() => window.matchMedia("(min-width: 768px)").matches);
	const { pathname } = useLocation();

	useEffect(() => {
		const media = window.matchMedia("(min-width: 768px)");
		const update = () => setDesktop(media.matches);
		update();
		media.addEventListener("change", update);
		return () => media.removeEventListener("change", update);
	}, []);

	useEffect(() => { setOpen(false); }, [pathname, desktop]);

	// Render one set of menus. The page remains mounted when navigation resizes.
	const contents = (
		<>
			<div className="flex items-center gap-2">
				<img src="/logo/logo.svg" alt="tokenscope logo" className="h-7 w-7 dark:invert" />
				<span className="text-lg font-semibold">tokenscope</span>
			</div>
			<Separator className="mt-2 mb-2" />
			<nav aria-label="Workspace" className="flex min-h-0 flex-1 flex-col gap-1 overflow-y-auto"
				onClick={event => {
					if ((event.target as HTMLElement).closest("a[href]")) setOpen(false);
				}}>
				{organizationId && (
					accessLost ? (
						<div className="px-3 text-sm">
							<p role="alert">Organization not found.</p>
							<Link to="/organizations" className="underline">
								Back to organizations
							</Link>
						</div>
					) : (
						<>
							<Link
								to={`/organizations/${organizationId}/members`}
								className="rounded-md px-3 py-2 text-sm font-medium hover:bg-muted transition-colors"
							>
								Members
							</Link>

							{isLoading && (
								<p role="status" className="px-3 text-sm">
									Loading projects…
								</p>
							)}

							{error && (
								<div className="px-3 text-sm">
									<p role="alert">{error}</p>
									<button
										type="button"
										onClick={reload}
										className="underline"
									>
										Retry projects
									</button>
								</div>
							)}

							<CollapsibleNavItem
								label="Projects"
								items={projects.map(project => ({
									id: project.id,
									name: project.name,
									to: `/organizations/${organizationId}/projects/${project.id}`,
								}))}
								organizationId={organizationId}
							/>
						</>
					)
				)}
			</nav>

			<div className="flex shrink-0 flex-col gap-3 pt-3">
				<ThemeToggle />
				<OrganizationSwitcher />
				<Separator />
				<UserMenu />
			</div>
		</>
	);

	if (desktop) {
		return <aside aria-label="Workspace navigation" className="flex h-full w-56 shrink-0 flex-col border-r p-4">{contents}</aside>;
	}

	return (
		<div className="shrink-0 border-b bg-background p-2">
			<Dialog open={open} onOpenChange={setOpen}>
				<DialogTrigger render={<Button variant="outline" size="sm" />}>
					<Menu className="size-4" /> Open menu
				</DialogTrigger>
				<DialogContent className="top-0 left-0 flex h-dvh w-72 translate-x-0 translate-y-0 flex-col gap-0 p-4 pt-16 sm:max-w-none">
					<DialogTitle className="sr-only">Workspace navigation</DialogTitle>
					{contents}
				</DialogContent>
			</Dialog>
		</div>
	);
}
