const API_BASE_URL = import.meta.env.VITE_API_URL ?? 'http://localhost:3000'

export interface HealthStatus
{
    status: 'ok' | 'error'
    timestamp?: string
}

/*async - marque la fonction comme asynchrone - obligatoire pour utiliser await
await - suspend l'execution jusqu'a ce que le reseau repond
Promise<HealthStatus> : valeur de retour — pas directe, mais promise de donner un HealthStatus
*/
export async function fetchHealth(): Promise<HealthStatus>
{
    const response = await fetch(`${API_BASE_URL}/health`)

    if (!response.ok)
    {
        throw new Error(`Health check failed with status ${response.status}`)
    }
    return response.json() //converti la reponse http en objet javascript
                        // typescript verifie que cet objet correspond a healtstatus grace au type de retour declare
}