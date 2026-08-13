import { Project } from '../types/workspace.types'
import { mockProjects } from '../mocks/workspace.mock'


//cette fonction renvoie la liste de tous les projets d'une organization
export async function getProjects(organizationId: string): Promise<Project[]> {
    return mockProjects;
}