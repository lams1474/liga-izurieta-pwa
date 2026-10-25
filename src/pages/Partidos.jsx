import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import { descargarMisPartidos } from '../lib/descargarPartidos'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { LogOut, Calendar, Download, Wifi, WifiOff, MapPin, Clock, Trash2 } from 'lucide-react'

export default function Partidos() {
  const navigate = useNavigate()
  const [online, setOnline] = useState(navigator.onLine)
  const [descargando, setDescargando] = useState(false)
  const [partidosLocales, setPartidosLocales] = useState([])

  // 1. Cargar partidos desde Dexie al montar el componente
  useEffect(() => {
    db.partidos.toArray().then(data => {
      setPartidosLocales(data)
    })
  }, [])

  // 2. Escuchar cambios de conexión (Online/Offline)
  useEffect(() => {
    const handleOnline = () => setOnline(true)
    const handleOffline = () => setOnline(false)
    window.addEventListener('online', handleOnline)
    window.addEventListener('offline', handleOffline)
    return () => {
      window.removeEventListener('online', handleOnline)
      window.removeEventListener('offline', handleOffline)
    }
  }, [])

  // 3. Función para descargar los partidos
  async function handleDescargar() {
    setDescargando(true)
    try {
      const resumen = await descargarMisPartidos()
      
      if (resumen.partidos === 0) {
        toast.error('No tienes partidos pendientes asignados')
      } else {
        toast.success(`Descargados ${resumen.partidos} partidos y ${resumen.jugadores} jugadores`)
      }
      
      // Volver a cargar la lista desde Dexie para mostrar en pantalla
      const locales = await db.partidos.toArray()
      setPartidosLocales(locales)

    } catch (err) {
      console.error(err)
      toast.error(err.message || 'Error al descargar partidos')
    } finally {
      setDescargando(false)
    }
  }

  // 4. Función para limpiar la memoria del celular (en caso de emergencia)
  async function limpiarMemoria() {
    if (!window.confirm("¿Seguro que deseas borrar todos los datos locales del celular? Tendrás que volver a descargar los partidos.")) return
    
    try {
      // Limpiamos las tablas principales y las relacionadas
      await db.partidos.clear()
      await db.planilla.clear()
      await db.eventos.clear()
      await db.firmas.clear()
      
      setPartidosLocales([])
      toast.success('Memoria limpiada correctamente')
    } catch (err) {
      console.error(err)
      toast.error('Error al limpiar la memoria')
    }
  }

  async function cerrarSesion() {
    await supabase.auth.signOut()
    navigate('/login', { replace: true })
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-8">
      {/* Barra Superior */}
      <header className="bg-liga-azul text-white p-4 flex justify-between items-center shadow-md sticky top-0 z-10">
        <div>
          <h1 className="font-bold text-lg">Mis Partidos</h1>
          <p className="text-xs text-liga-amarillo flex items-center gap-1 mt-1">
            {online ? <Wifi size={12} /> : <WifiOff size={12} />}
            {online ? 'En línea' : 'Sin conexión (Offline)'}
          </p>
        </div>
        <button
          onClick={cerrarSesion}
          className="bg-liga-rojo p-2 rounded-md hover:bg-liga-rojo/80 transition-colors"
          title="Cerrar sesión"
        >
          <LogOut size={20} />
        </button>
      </header>

      <main className="p-4 max-w-lg mx-auto space-y-4">
        
        {/* Botón de Descarga */}
        <button
          onClick={handleDescargar}
          disabled={descargando || !online}
          className="w-full bg-liga-verde text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50 hover:bg-liga-verde/90 transition-colors shadow-sm"
        >
          <Download size={20} />
          {descargando ? 'Descargando datos...' : 'Descargar partidos offline'}
        </button>

        {/* Botón de Limpiar Memoria (Utilidad para pruebas) */}
        <div className="text-center pb-2">
          <button 
            onClick={limpiarMemoria}
            className="text-xs text-gray-500 hover:text-liga-rojo flex items-center justify-center gap-1 mx-auto underline transition-colors"
          >
            <Trash2 size={12} /> Borrar datos locales del celular
          </button>
        </div>

        {/* Lista de Partidos */}
        {partidosLocales.length === 0 ? (
          <div className="bg-white p-8 rounded-lg shadow-md text-center">
            <Calendar size={48} className="mx-auto text-gray-300 mb-4" />
            <h2 className="text-lg font-bold text-gray-800 mb-2">No hay partidos en memoria</h2>
            <p className="text-gray-500 text-sm">
              Asegúrate de tener internet y pulsa el botón de arriba para descargar tus partidos asignados.
            </p>
          </div>
        ) : (
          <>
            <p className="text-sm text-gray-500 text-center font-semibold mb-2">
              {partidosLocales.length} partido(s) guardado(s) en este celular
            </p>
            
            {partidosLocales.map((p) => (
              <div key={p.id} className="bg-white p-4 rounded-lg shadow-md border-l-4 border-liga-azul">
                <div className="flex justify-between items-start mb-3">
                  <div className="flex-1">
                    <p className="text-sm font-semibold text-gray-600 flex items-center gap-1">
                      <Clock size={14} /> {p.hora?.slice(0, 5) || '--:--'}
                      {p.cancha && (
                        <>
                          <MapPin size={14} className="ml-2" /> {p.cancha}
                        </>
                      )}
                    </p>
                  </div>
                  <span
                    className={`text-xs px-2 py-1 rounded font-bold ${
                      p.jugado
                        ? 'bg-gray-200 text-gray-600'
                        : 'bg-liga-amarillo text-liga-azul'
                    }`}
                  >
                    {p.jugado ? 'Finalizado' : 'Pendiente'}
                  </span>
                </div>
                
                <button
                  onClick={() => navigate(`/partido/${p.id}`)}
                  className="w-full mt-2 bg-liga-azul text-white py-2 rounded-md font-bold hover:bg-liga-azul/90 transition-colors"
                >
                  Abrir Partido en Vivo
                </button>
              </div>
            ))}
          </>
        )}
      </main>
    </div>
  )
}