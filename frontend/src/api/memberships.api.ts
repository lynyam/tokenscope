import { Member, Membership } from '../types/workspace.types'
import { mockMembers, mockMemberships, mockUser } from '../mocks/workspace.mock'

//pour l'instant renvoie tous les mocks; une fois plusieurs organisations
//dans le mock, filtrer mockMembers selon organizationId
export async function getMembers(organizationId: string): Promise<Member[]> {
    return mockMembers;
}

//fonction pour aider a trouver le role du user actuel-connecte
export async function getMembershipForOrganization(organizationId: string): Promise<Membership | undefined> {
    return mockMemberships.find((m) => m.organizationId === organizationId && m.userId === mockUser.id);
}

//cette fonction devra filtrer les membres selon l'organisation demandée