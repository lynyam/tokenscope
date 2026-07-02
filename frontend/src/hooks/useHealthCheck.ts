import { useEffect, useState } from 'react'
import { fetchHealth } from '../api/health'
import type { ConnectionState } from '../types/health'


// cette fonction retourne l'etat de la connexion de backend
export function useHealthCheck()
{
    const [state, setState] = useState<ConnectionState>('loading')

    //useEffect lance fetch une seule fois au montage du composant
    useEffect(() =>
    {   let cancelled = false
        fetchHealth()
            .then(() =>
            {
                if (!cancelled) setState('connected')// si le backend repond state passe a connected
            })
            .catch(() => 
            {
                if (!cancelled) setState('disconnected')
            })
        return () => {
            cancelled = true
        }
    }, [])
    return state
}