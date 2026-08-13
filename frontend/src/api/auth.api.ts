import { User } from '../types/workspace.types'
import { mockUser } from '../mocks/workspace.mock'

//getcurrentuser est une fonction que sert juste a demander, qui est l'utilisateur
//actuelment connecte, et a recuperer ses infos, pour les afficher a l'ecran
export async function getCurrentUser(): Promise<User> {
    return mockUser;
}
