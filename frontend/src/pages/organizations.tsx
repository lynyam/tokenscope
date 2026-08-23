import { useState } from "react";
import { getOrganizations } from "../api/organizations.api";
import { Membership, Organization } from "../types/workspace.types";
import { useEffect } from "react";
import { mockUser } from "../mocks/workspace.mock"

//le composant gere proprement l'etat de chargement
export function Organizations() {
    const [organizations, setOrganizations] = useState<Organization[]>([]);
    const [isLoading, setIsLoading] = useState(true);
    const [error, setError] =  useState<string | null>(null);
    const [newOrgName, setNewOrgName] = useState("");
    const [memberships, setMemberships] = useState<Membership[]>([]);

    useEffect(() => {
        getOrganizations()
        .then((data) => {
            setOrganizations(data);
            setIsLoading(false); //chargement fini
        })
        .catch(() => {
            setError("Failed to load organizations.");
            setIsLoading(false);
        })
    }, []);
    function handleCreate() {
        if (newOrgName.trim() === "") {
            return; // on ne fait rien si le champ est vide
        }
       const newOrg: Organization = {
        id: crypto.randomUUID(),   // identifiant unique généré côté client
        name: newOrgName,
        slug:newOrgName.toLowerCase().replace(/\s+/g, "-"),
       };
       const newMembership: Membership = {
        id: crypto.randomUUID(),
        userId: mockUser.id,
        organizationId: newOrg.id,
        role: "OWNER" 
       }
       setOrganizations([...organizations, newOrg]);
       setMemberships([...memberships, newMembership]);
       setNewOrgName("");
    } 
    return (
        <div>
            <h1>Organizations</h1>
            <input value={newOrgName} onChange={(e) => setNewOrgName(e.target.value)} />
            <button onClick={handleCreate}>Create</button>
            {error ? (
                <p>{error}</p>
            ) : isLoading ? (
                <p>Loading...</p>
            ) : organizations.length === 0 ? (
                <p>No organizations yet.</p>
            ) : (
                <ul>
                {organizations.map((org) => (
                    <li key={org.id}>{org.name}</li>
                ))}
            </ul>
            )}
        </div>
    );
}
