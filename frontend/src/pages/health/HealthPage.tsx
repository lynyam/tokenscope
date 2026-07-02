import HealthCheck from '../../components/health/HealthCheck'

function HealthPage() {
  return (
    <div>
      <h1>TokenScope</h1>
      <p>LLM Cost Observatory — frontend shell</p>
      <p>Ici on peut ajouter tout le contenu qu'on souhaite</p>
      <HealthCheck />
    </div>
  )
}

export default HealthPage