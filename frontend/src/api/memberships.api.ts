import { Member } from '../types/workspace.types'
import { mockMembers } from '../mocks/workspace.mock'

//pour l'instant renvoie tous les mocks; une fois plusieurs organisations
//dans le mock, filtrer mockMembers selon organizationId
export async function getMembers(organizationId: string): Promise<Member[]> {
    return mockMembers;
}



//cette fonction devra filtrer les membres selon l'organisation demandée