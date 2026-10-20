import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import { LogOut, Calendar } from 'lucide-react'

export default function Partidos() {
  const navigate = useNavigate()

  async function cerrarSesion() {
    await supabase.auth.signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-gray-100">
      <header className="bg-liga-azul text-white p-4 flex justify-between items-center shadow-md">
        <div>
          <h1 className="font-bold">Mis Partidos</h1>
          <p className="text-xs text-liga-amarillo">Vocal / Árbitro</p>
        </div>
        <button onClick={cerrarSesion} className="bg-liga-rojo p-2 rounded-md hover:bg-liga-rojo/80">
          <LogOut size={20} />
        </button>
      </header>

      <main className="p-6 max-w-lg mx-auto">
        <div className="bg-white p-6 rounded-lg shadow-md text-center">
          <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
          <h2 className="text-xl font-bold text-gray-800 mb-2">Aquí irán los partidos</h2>
          <p className="text-gray-500 text-sm">
            Próximamente descargaremos los partidos asignados para que puedas trabajar sin internet.
          </p>
        </div>
      </main>
    </div>
  )
}