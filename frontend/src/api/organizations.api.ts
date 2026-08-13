import { Organization } from '../types/workspace.types'
import { mockOrganizations } from '../mocks/workspace.mock'

//renvoi toutes les organisations qui existent dans la base de donnes
export async function getOrganizations(): Promise<Organization[]> {
    return mockOrganizations;
}




//plustard backend vas renvoie seulement celles ou l'utilisateur connecte est membre