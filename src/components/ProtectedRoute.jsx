import { Navigate } from 'react-router-dom'
import { useAuth } from '../hooks/useAuth'

export default function ProtectedRoute({ children }) {
  const { user, loading } = useAuth()

  if (loading) {
    return (
      <div className="min-h-screen bg-liga-azul flex items-center justify-center text-white">
        <p className="animate-pulse">Cargando sesión…</p>
      </div>
    )
  }

  if (!user) return <Navigate to="/login" replace />

  return children
}