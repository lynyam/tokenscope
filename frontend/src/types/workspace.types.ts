// interface user
export interface User {
    id: string; 
    email: string;
    name: string;
}

export interface Organization {
    id: string;
    name: string;
    slug: string;
}

export type MembershipRole = "OWNER" | "ADMIN" | "MEMBER";

export interface Membership {
    id: string;
    userId: string;
    organizationId: string;
    role: MembershipRole;
}

export interface Member extends User {
    role: MembershipRole;
}

export interface Project {
    id: string;
    organizationId: string;
    name: string;
    slug: string;
    description?: string;
    archivedAt?: Date;
}