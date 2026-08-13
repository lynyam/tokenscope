import { User, Organization, Member, Project } from '../types/workspace.types';


export const mockUser: User = {
    id: "user-1",
    email: "mockdina@test.com",
    name: "dina"
};

export const mockOrganizations: Organization[] = [{
    id: "mockorganization",
    name: "MockOrg",
    slug: "mock-organization-test",
    role: "OWNER"
},
{
    id: "fausseorg",
    name: "xlIton",
    slug: "xlitn-org-test",
    role: "ADMIN",

}];

export const mockMembers: Member[] = [{
    id: "user-1",
    email: "mockdina@test.com",
    name: "anid",
    role: "ADMIN",
}];

export const mockProjects: Project[] = [{
    id: "p1",
    organizationId: "mockorganization",
    name: "MockOrg",
    slug: "mock-project",
    description:"description test",
}];