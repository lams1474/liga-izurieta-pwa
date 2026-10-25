import { useState, useEffect, useRef } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { ArrowLeft, Clock, MapPin, Shield, User, X, Circle, CheckCircle, Lock, Printer } from 'lucide-react'
import { sincronizarPartido } from '../lib/sincronizarPartido'
import FirmaModal from '../components/FirmaModal'
import { useReactToPrint } from 'react-to-print'
import ActaPrintView from '../components/ActaPrintView'

export default function PartidoVivo() {
  const { id } = useParams()
  const navigate = useNavigate()
  
  // 1. Declaramos la referencia (ESTO FALTABA)
  const componentRef = useRef()

  // 2. Configuramos la impresión
  const handlePrint = useReactToPrint({
    contentRef: componentRef,
    documentTitle: 'Acta_Partido_Liga',
    onBeforePrint: () => toast.loading('Generando PDF...', { id: 'pdf' }),
    onAfterPrint: () => toast.success('PDF Generado', { id: 'pdf' }),
    onPrintError: (errorLocation, error) => {
      console.error(errorLocation, error);
      toast.error('Error al generar el PDF. Revisa la consola.', { id: 'pdf' });
    },
    pageStyle: `
      @page { size: A4 portrait; margin: 10mm; }
      @media print {
        body { -webkit-print-color-adjust: exact; print-color-adjust: exact; }
      }
    `
  })

  const [cargando, setCargando] = useState(true)
  const [partido, setPartido] = useState(null)
  const [equipoLocal, setEquipoLocal] = useState(null)
  const [equipoVisitante, setEquipoVisitante] = useState(null)
  const [rolUsuario, setRolUsuario] = useState(null)

  const [jugadoresLocal, setJugadoresLocal] = useState([])
  const [jugadoresVisitante, setJugadoresVisitante] = useState([])
  const [eventos, setEventos] = useState([])
  const [planillaLocal, setPlanillaLocal] = useState([])
  
  const [carnets, setCarnets] = useState([])
  const [sanciones, setSanciones] = useState([])
  const [firmas, setFirmas] = useState([]) 

  const [jugadorSeleccionado, setJugadorSeleccionado] = useState(null)
  const [finalizando, setFinalizando] = useState(false)

  const [pasoFirma, setPasoFirma] = useState(null)
  const [firmasTemporales, setFirmasTemporales] = useState([])
  const [novedadesGenerales, setNovedadesGenerales] = useState('')

  useEffect(() => {
    async function cargarDatosOffline() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const userId = session?.user?.id

        const p = await db.partidos.get(id)
        if (!p) { setCargando(false); return }
        setPartido(p)

        if (p.vocal_id === userId) setRolUsuario('vocal')
        else setRolUsuario('arbitro')

        const local = await db.equipos.get(p.equipo_local_id)
        const visitante = await db.equipos.get(p.equipo_visitante_id)
        setEquipoLocal(local)
        setEquipoVisitante(visitante)

        const plan = await db.planilla.where('partido_id').equals(id).toArray()
        setPlanillaLocal(plan)

        const localesIds = plan.filter(pl => pl.equipo_id === p.equipo_local_id).map(pl => pl.jugador_id)
        const visitantesIds = plan.filter(pl => pl.equipo_id === p.equipo_visitante_id).map(pl => pl.jugador_id)

        const jLocales = await db.jugadores.bulkGet(localesIds)
        const jVisitantes = await db.jugadores.bulkGet(visitantesIds)

        setJugadoresLocal((jLocales.filter(Boolean)).sort((a, b) => a.apellidos.localeCompare(b.apellidos)))
        setJugadoresVisitante((jVisitantes.filter(Boolean)).sort((a, b) => a.apellidos.localeCompare(b.apellidos)))

        const evs = await db.eventos.where('partido_id').equals(id).toArray()
        setEventos(evs)

        const f = await db.firmas.where('partido_id').equals(id).toArray()
        setFirmas(f)

        const c = await db.carnets.toArray()
        const s = await db.sanciones.where('partido_id').equals(id).toArray() 
        setCarnets(c)
        setSanciones(s)

      } catch (error) {
        console.error("Error cargando partido offline:", error)
      } finally {
        setCargando(false)
      }
    }
    cargarDatosOffline()
  }, [id])

  const evaluarJugador = (jugadorId) => {
    const carnetsJugador = carnets.filter(c => c.jugador_id === jugadorId)
    
    if (carnetsJugador.length === 0) {
      return { habilitado: false, motivo: 'Sin carnet registrado' }
    }
    
    const tieneCarnetValido = carnetsJugador.some(c => c.valido === true)
    if (!tieneCarnetValido) {
      return { habilitado: false, motivo: 'Carnet no válido' }
    }
    
    const sancion = sanciones.find(s => s.jugador_id === jugadorId && s.activa)
    if (sancion) {
      return { habilitado: false, motivo: `Sanción: ${sancion.motivo || sancion.tipo}` }
    }

    return { habilitado: true, motivo: null }
  }

  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido?.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido?.equipo_visitante_id).length
  const getEventosJugador = (jugadorId) => eventos.filter(e => e.jugador_id === jugadorId)
  const esTitular = (jugadorId, equipoId) => planillaLocal.find(pl => pl.jugador_id === jugadorId && pl.equipo_id === equipoId)?.es_titular || false

  async function toggleTitular(jugadorId, equipoId) {
    const { habilitado, motivo } = evaluarJugador(jugadorId)
    if (!habilitado) return toast.error(`No se puede habilitar: ${motivo}`)

    const insc = planillaLocal.find(pl => pl.jugador_id === jugadorId && pl.equipo_id === equipoId)
    if (!insc) return

    const nuevoEstado = !insc.es_titular
    await db.planilla.update(insc.id, { es_titular: nuevoEstado })
    setPlanillaLocal(prev => prev.map(pl => pl.id === insc.id ? { ...pl, es_titular: nuevoEstado } : pl))
    toast.success(nuevoEstado ? 'Marcado como Titular' : 'Marcado como Suplente')
  }

  async function registrarEvento(tipo) {
    if (!jugadorSeleccionado) return
    const minutoStr = prompt(`Ingrese el minuto del evento (1-90):`, "1")
    if (minutoStr === null) return 
    const minuto = parseInt(minutoStr) || 0

    try {
      const nuevoEvento = {
        partido_id: id, tipo, jugador_id: jugadorSeleccionado.jugador.id,
        equipo_id: jugadorSeleccionado.equipoId, minuto, sync_status: 'pending'
      }
      const eventId = await db.eventos.add(nuevoEvento)
      setEventos(prev => [...prev, { ...nuevoEvento, id: eventId }])
      toast.success('Evento registrado correctamente')
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar evento')
    } finally {
      setJugadorSeleccionado(null)
    }
  }

  function iniciarCierre() {
    if (!window.confirm("¿Deseas finalizar el partido? Se procederá a firmar el acta.")) return
    setFirmasTemporales([])
    setNovedadesGenerales('')
    setPasoFirma('local')
  }

  async function handleGuardarFirma(datosFirma) {
    const nuevasFirmas = [...firmasTemporales, { tipo: pasoFirma, ...datosFirma }]
    setFirmasTemporales(nuevasFirmas)
    if (datosFirma.novedades) setNovedadesGenerales(datosFirma.novedades)

    if (pasoFirma === 'local') setPasoFirma('visitante')
    else if (pasoFirma === 'visitante') setPasoFirma('vocal')
    else if (pasoFirma === 'vocal') setPasoFirma('arbitro')
    else if (pasoFirma === 'arbitro') {
      setPasoFirma(null)
      await ejecutarFinalizacion(nuevasFirmas, datosFirma.novedades || novedadesGenerales)
    }
  }

  async function ejecutarFinalizacion(firmasFinales, textoNovedades) {
    setFinalizando(true)
    try {
      for (const f of firmasFinales) {
        await db.firmas.add({
          partido_id: id, tipo_firmante: f.tipo, firma_base64: f.firma,
          de_acuerdo: f.deAcuerdo, motivo_desacuerdo: f.motivo, sync_status: 'pending'
        })
      }
      
      const firmasActualizadas = await db.firmas.where('partido_id').equals(id).toArray()
      setFirmas(firmasActualizadas)

      if (textoNovedades) {
        await db.partidos.update(id, { observaciones: textoNovedades })
        setPartido(prev => ({ ...prev, observaciones: textoNovedades, jugado: true }))
      }

      if (navigator.onLine) {
        toast.loading('Sincronizando acta con la nube...', { id: 'sync' })
        await sincronizarPartido(id)
        toast.success('Acta sincronizada', { id: 'sync' })
      } else {
        await db.partidos.update(id, { jugado: true, sincronizado: false })
        toast.success('Acta cerrada offline. Se sincronizará luego.', { icon: '📡' })
      }
      
      setPartido(prev => ({ ...prev, jugado: true }))
      
    } catch (error) {
      console.error(error)
      toast.error('Error al finalizar: ' + error.message)
    } finally {
      setFinalizando(false)
    }
  }

  if (cargando) return <div className="min-h-screen flex items-center justify-center font-bold">Cargando...</div>
  if (!partido) return <div className="p-8 text-center text-xl font-bold">Partido no encontrado</div>

  const renderJugador = (j, equipoId) => {
    const { habilitado, motivo } = evaluarJugador(j.id)
    const titular = esTitular(j.id, equipoId)
    const evs = getEventosJugador(j.id)

    return (
      <div key={j.id} onClick={() => setJugadorSeleccionado({ jugador: j, equipoId, habilitado, motivo })} className={`p-3 flex justify-between items-center cursor-pointer transition-colors ${!habilitado ? 'bg-red-50 opacity-80' : titular ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-gray-100'}`}>
        <div className="flex items-center gap-3">
          <div className="w-8 h-8 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 overflow-hidden relative">
             {!habilitado && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Lock size={12} className="text-white"/></div>}
             {j.foto_url ? <img src={j.foto_url} className="w-full h-full object-cover" /> : <User size={16} />}
          </div>
          <div>
            <p className="font-semibold text-sm text-gray-800 flex items-center gap-1">
              {j.apellidos} {titular && habilitado && <CheckCircle size={12} className="text-green-600" />}
            </p>
            <p className="text-xs text-gray-500">{j.nombres}</p>
          </div>
        </div>
        <div className="flex gap-1 items-center">
           {!habilitado && <span className="text-[10px] font-bold text-red-600 mr-2">{motivo}</span>}
           {evs.map(e => {
             if (e.tipo === 'gol') return <Circle key={e.id} size={16} className="text-green-600 fill-green-600" />
             if (e.tipo === 'amarilla') return <div key={e.id} className="w-3 h-4 bg-yellow-400 rounded-sm" />
             if (e.tipo === 'roja') return <div key={e.id} className="w-3 h-4 bg-red-600 rounded-sm" />
             return null
           })}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      <header className="bg-liga-azul text-white p-4 flex items-center gap-3 sticky top-0 z-10 shadow-md">
        <button onClick={() => navigate('/partidos')} className="p-2 bg-white/10 rounded-md hover:bg-white/20">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="font-bold">Partido en Vivo</h1>
          <p className="text-xs text-liga-amarillo capitalize">Sesión: {rolUsuario}</p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        <div className="bg-white rounded-lg shadow-md p-4 text-center">
          <div className="flex justify-between items-center text-gray-500 text-sm mb-2 px-4">
            <span className="flex items-center gap-1"><Clock size={14}/> {partido.hora?.slice(0,5)}</span>
            <span className="flex items-center gap-1"><MapPin size={14}/> {partido.cancha}</span>
          </div>
          <div className="flex justify-between items-center mt-4">
            <div className="flex-1 text-right pr-4"><p className="text-lg font-bold text-gray-800 leading-tight">{equipoLocal?.nombre}</p></div>
            <div className="bg-gray-800 px-6 py-3 rounded-lg text-4xl font-black text-white shadow-inner">{golesLocal} - {golesVisitante}</div>
            <div className="flex-1 text-left pl-4"><p className="text-lg font-bold text-gray-800 leading-tight">{equipoVisitante?.nombre}</p></div>
          </div>
        </div>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-liga-azul text-white p-3 flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2"><Shield size={18} /> {equipoLocal?.nombre}</h3>
            </div>
            <div className="divide-y divide-gray-100">{jugadoresLocal.map(j => renderJugador(j, partido.equipo_local_id))}</div>
          </div>
          
          <div className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-gray-800 text-white p-3 flex justify-between items-center">
              <h3 className="font-bold flex items-center gap-2"><Shield size={18} /> {equipoVisitante?.nombre}</h3>
            </div>
            <div className="divide-y divide-gray-100">{jugadoresVisitante.map(j => renderJugador(j, partido.equipo_visitante_id))}</div>
          </div>
        </div>

        <div className="mt-8">
          <button 
            onClick={iniciarCierre} 
            disabled={finalizando || partido.jugado} 
            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 ${partido.jugado ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-liga-rojo text-white hover:bg-red-700'}`}
          >
            {finalizando ? 'Procesando...' : partido.jugado ? 'Acta Finalizada' : 'Finalizar Partido y Firmar Acta'}
          </button>

          {partido.jugado && (
            <button
              onClick={handlePrint}
              className="w-full mt-3 py-4 rounded-xl font-bold text-lg shadow-lg bg-gray-800 text-white hover:bg-black transition-colors flex items-center justify-center gap-2"
            >
              <Printer size={20} /> Descargar / Imprimir Acta PDF
            </button>
          )}
        </div>
      </main>

      {jugadorSeleccionado && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl p-5 animate-in slide-in-from-bottom-5">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <div>
                <h3 className="font-bold text-gray-800 text-lg">{jugadorSeleccionado.jugador.apellidos}</h3>
                <p className="text-sm text-gray-500">{jugadorSeleccionado.jugador.nombres}</p>
                {!jugadorSeleccionado.habilitado && <p className="text-xs text-red-600 font-bold mt-1">BLOQUEADO: {jugadorSeleccionado.motivo}</p>}
              </div>
              <button onClick={() => setJugadorSeleccionado(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20} /></button>
            </div>

            {rolUsuario === 'vocal' && (
              <div className="mb-4">
                <button 
                  onClick={() => toggleTitular(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId)}
                  disabled={!jugadorSeleccionado.habilitado}
                  className={`w-full py-2 rounded-lg font-bold border-2 flex items-center justify-center gap-2 ${
                    !jugadorSeleccionado.habilitado ? 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed' :
                    esTitular(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId) ? 'bg-green-50 border-green-600 text-green-700' : 'bg-gray-50 border-gray-300 text-gray-600'
                  }`}
                >
                  <CheckCircle size={18} /> 
                  {esTitular(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId) ? 'Es Titular (Quitar)' : 'Marcar como Titular'}
                </button>
              </div>
            )}

            {rolUsuario === 'arbitro' && (
               <div className="mb-4 text-center text-xs text-gray-500 bg-blue-50 p-2 rounded">
                 La planilla es controlada por el Vocal.
               </div>
            )}

            <div className="grid grid-cols-1 gap-2 pt-2 border-t">
              <p className="text-xs text-center text-gray-500 mb-1">Registrar Evento:</p>
              <button onClick={() => registrarEvento('gol')} disabled={!jugadorSeleccionado.habilitado} className="bg-green-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                <Circle size={20} className="fill-white" /> ¡GOL!
              </button>
              <button onClick={() => registrarEvento('amarilla')} disabled={!jugadorSeleccionado.habilitado} className="bg-yellow-400 text-yellow-900 py-3 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                <div className="w-4 h-5 bg-yellow-900 rounded-sm"></div> Tarjeta Amarilla
              </button>
              <button onClick={() => registrarEvento('roja')} disabled={!jugadorSeleccionado.habilitado} className="bg-red-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                <div className="w-4 h-5 bg-white rounded-sm"></div> Tarjeta Roja
              </button>
            </div>
          </div>
        </div>
      )}

      <FirmaModal 
        key={pasoFirma} 
        isOpen={!!pasoFirma} 
        onClose={() => setPasoFirma(null)} 
        onSave={handleGuardarFirma} 
        tipoFirmante={pasoFirma}
        titulo={pasoFirma === 'local' ? `Capitán ${equipoLocal?.nombre}` : pasoFirma === 'visitante' ? `Capitán ${equipoVisitante?.nombre}` : pasoFirma === 'vocal' ? 'Firma del Vocal' : 'Firma del Árbitro'}
      />

      <div style={{ position: 'absolute', left: '-9999px', top: 0 }}>
        <ActaPrintView 
          ref={componentRef}
          partido={partido}
          equipoLocal={equipoLocal}
          equipoVisitante={equipoVisitante}
          jugadoresLocal={jugadoresLocal}
          jugadoresVisitante={jugadoresVisitante}
          eventos={eventos}
          firmas={firmas}
        />
      </div>
    </div>
  )
}