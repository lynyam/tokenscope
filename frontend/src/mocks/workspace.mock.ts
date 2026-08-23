import { User, Organization, Member,
    Membership, Project } from '../types/workspace.types';


export const mockUser: User = {
    id: "user-1",
    email: "mockdina@test.com",
    name: "dina"
};

export const mockOtherUser: User = {
    id: "user-2",
    email: "mockdi@test.com",
    name: "jojo"
};

export const mockOrganizations: Organization[] = [{
    id: "mockorganization",
    name: "MockOrg",
    slug: "mock-org-test",
},
{
    id: "fausseorg",
    name: "xlIton",
    slug: "xliton-org-test",
}];

export const mockMembers: Member[] = [{
    id: "user-1",
    email: "mockdina@test.com",
    name: "dina",
    role: "ADMIN",
},
{
    id: "user-2",
    email: "mockdi@test.com",
    name: "jojo",
    role: "MEMBER"
}];

export const mockMemberships: Membership[] = [{
    id: "00001",
    userId: "user-1",
    organizationId: "fausseorg",
    role: "OWNER",
},
{
    id: "00002",
    userId: "user-2",
    organizationId: "mockorganization",
    role: "MEMBER",
}];


export const mockProjects: Project[] = [{
    id: "p1",
    organizationId: "mockorganization",
    name: "MockOrg",
    slug: "mock-project",
    description:"description test",
}];