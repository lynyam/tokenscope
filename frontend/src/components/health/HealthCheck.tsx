import { useHealthCheck } from '../../hooks/useHealthCheck'
import './HealthCheck.css'

function HealthCheck()
{
    const state = useHealthCheck()//state stock le statu actuel de useHealthCheck
    
    return (
        <div className="health-check">
            {/* la classe CSS change dynamiquement selon state pour afficher
                la bonne couleur : orange=loading, vert=connected, rouge=disconnected */}
            <span className={`health-check__dot health-check__dot--${state}`} />
            <span className="health-check__label">
                {state === 'loading' && 'verification de la connexion backend...'}
                {state === 'connected' && 'Backend connecte'}
                {state === 'disconnected' && 'backend injoignable'}
            </span>
        </div>
    )
}

export default HealthCheck  