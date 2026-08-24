// interface user
export interface User {
    id: string;
    email: string;
    displayName: string;  //to met our data model field name
}

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";

export interface Organization {
    id: string;
    name: string;
    slug: string;
    //role: MembershipRole; -> link btw User and Orgnization is materialise by Membership
}

/* this should not exist. It merges two different entities and
loses membership identity and organization scope. I have introduced Membership
and MembershipWithUser
export interface Member extends User {
    role: MembershipRole;
}
*/

export interface Project {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description: string | null; //our Prisma model return nullable
    archivedAt: string | null; //http serialise date as string
}

export interface OrganizationSummary extends Organization {
    currentUserRole: MembershipRole; //contextual information derived from the
                                    //authenticated user’s membership. It does
                                    //not mean the organization owns a role.
}
//Add our Membership Entity type
export interface Membership {
    id: string;
    userId: string;
    organizationId: string;
    role: MembershipRole;
}

/** Membership enriched with the safe user data required by TSE-35. */
export interface MembershipWithUser extends Membership {
    user: User;
}

export interface OrganizationMembershipsResponse {
    memberships: MembershipWithUser[];
    currentUserRole: MembershipRole;
}

//need for auth feature
export interface SignInInput {
    email: string;
    password: string;
}

export interface SignUpInput extends SignInInput {
    displayName: string;
}

export interface CreateOrganizationInput {
    name: string;
}
