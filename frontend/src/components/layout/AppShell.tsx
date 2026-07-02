import type { ReactNode } from 'react'
import './AppShell.css'

// c'est un contrat typescript que dirait quel donnes on donnera a appshel
interface AppShellProps
{
    children: ReactNode
}

function AppShell({ children }: AppShellProps)
{
    return (
        <div className="app-shell">
            <header className="app-shell__header">
                <div className="app-shell__brand">TokenScope</div>
            </header>
            <main className="app-shell__content">{children}</main>
        </div>
    )
}
//le fichier as un seul export principal que a l'importation on peut le nommer comme on l'entend
export default AppShell