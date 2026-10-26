import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { db } from '../lib/db'
import { supabase } from '../lib/supabase'
import toast from 'react-hot-toast'
import { ArrowLeft, Clock, MapPin, Shield, User, X, Circle, CheckCircle, Lock, Printer } from 'lucide-react'
import { sincronizarPartido } from '../lib/sincronizarPartido'
import FirmaModal from '../components/FirmaModal'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

export default function PartidoVivo() {
  const { id } = useParams()
  const navigate = useNavigate()

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
    if (carnetsJugador.length === 0) return { habilitado: false, motivo: 'Sin carnet registrado' }
    const carnet = carnetsJugador[0]
    if (!carnet.valido) return { habilitado: false, motivo: carnet.motivo_bloqueo || 'Carnet no válido' }
    const sancion = sanciones.find(s => s.jugador_id === jugadorId && s.activa)
    if (sancion) return { habilitado: false, motivo: `Sanción: ${sancion.motivo || sancion.tipo}` }
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
    const minutoStr = prompt(`Ingrese el minuto (1-90):`, "1")
    if (minutoStr === null) return 
    const minuto = parseInt(minutoStr) || 0

    try {
      const nuevoEvento = {
        partido_id: id, tipo, jugador_id: jugadorSeleccionado.jugador.id,
        equipo_id: jugadorSeleccionado.equipoId, minuto, sync_status: 'pending'
      }
      const eventId = await db.eventos.add(nuevoEvento)
      setEventos(prev => [...prev, { ...nuevoEvento, id: eventId }])
      toast.success('Evento registrado')
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
      // AQUI AGREGAMOS ESTO: Borrar firmas viejas de la base local antes de guardar las nuevas
      await db.firmas.where('partido_id').equals(id).delete()

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

  // ============ GENERAR PDF OFICIAL (IGUAL AL ADMIN) ============
  function descargarPDF() {
    try {
      const doc = new jsPDF()
      const p = partido
      
      const dibujarEncabezado = (pagina) => {
        doc.setFont("helvetica", "bold")
        doc.setFontSize(14)
        doc.text('LIGA DEPORTIVA BARRIAL JOSE I. IZURIETA', 105, 15, { align: 'center' })
        doc.setFontSize(9)
        doc.setFont("helvetica", "normal")
        doc.text('PUJILI - ECUADOR', 105, 20, { align: 'center' })
        doc.text('FUNDADA EL 09 DE MARZO DEL 2013', 20, 26)
        doc.text('ACUERDO MUNICIPAL NO. 034-GADMP-2013', 130, 26)
        doc.line(15, 28, 195, 28)
        doc.setFont("helvetica", "bold")
        doc.setFontSize(12)
        doc.text(`ACTA DE JUEGO - PÁGINA ${pagina}`, 105, 35, { align: 'center' })
      }

      // PÁGINA 1: PLANILLA
      dibujarEncabezado(1)
      doc.setFontSize(9)
      doc.setFont("helvetica", "normal")
      
      const fechaStr = new Date().toLocaleDateString()
      doc.text(`VOCAL DE TURNO: ____________________`, 15, 45)
      doc.text(`CIUDAD: Pujilí`, 100, 45)
      doc.text(`FECHA: ${fechaStr}`, 145, 45)
      doc.text(`HORA: ${p.hora?.slice(0,5) || '________'}`, 15, 51)

      // TABLA EQUIPO LOCAL
      doc.setFont("helvetica", "bold")
      doc.text(`CLUB: ${equipoLocal?.nombre?.toUpperCase()}`, 15, 60)
      doc.text(`CATEGORÍA: ${equipoLocal?.categoria?.toUpperCase() || ''}`, 100, 60)

      const filasLocal = jugadoresLocal.filter(j => planillaLocal.find(pl => pl.jugador_id === j.id)).map(j => {
        const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
        const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
        const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
        return [j.dorsal || '-', `${j.apellidos} ${j.nombres}`, goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
      })

      autoTable(doc, {
        startY: 63,
        head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']],
        body: filasLocal,
        theme: 'grid',
        headStyles: { fillColor: [200, 200, 200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0: { cellWidth: 15, halign: 'center' }, 1: { cellWidth: 110 }, 2: { cellWidth: 15, halign: 'center' }, 3: { cellWidth: 15, halign: 'center' }, 4: { cellWidth: 15, halign: 'center' } }
      })

      // TABLA EQUIPO VISITANTE
      let finalY = doc.lastAutoTable.finalY + 10
      doc.setFont("helvetica", "bold")
      doc.text(`CLUB: ${equipoVisitante?.nombre?.toUpperCase()}`, 15, finalY)
      doc.text(`CATEGORÍA: ${equipoVisitante?.categoria?.toUpperCase() || ''}`, 100, finalY)

      const filasVisitante = jugadoresVisitante.filter(j => planillaLocal.find(pl => pl.jugador_id === j.id)).map(j => {
        const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
        const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
        const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
        return [j.dorsal || '-', `${j.apellidos} ${j.nombres}`, goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
      })

      autoTable(doc, {
        startY: finalY + 3,
        head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']],
        body: filasVisitante,
        theme: 'grid',
        headStyles: { fillColor: [200, 200, 200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0: { cellWidth: 15, halign: 'center' }, 1: { cellWidth: 110 }, 2: { cellWidth: 15, halign: 'center' }, 3: { cellWidth: 15, halign: 'center' }, 4: { cellWidth: 15, halign: 'center' } }
      })

      // PÁGINA 2: TARJETAS Y FIRMAS
      doc.addPage()
      dibujarEncabezado(2)
      doc.setFontSize(9)
      doc.setFont("helvetica", "normal")
      
      const nombreArbitro = p.arbitro_id ? 'Firmado Digitalmente' : '________________________'
      doc.text(`NOMBRE DEL SR. ARBITRO: ${nombreArbitro}`, 15, 45)

      const tarjetasLocal = eventos.filter(ev => (ev.tipo === 'amarilla' || ev.tipo === 'roja') && ev.equipo_id === p.equipo_local_id)
      const tarjetasVisitante = eventos.filter(ev => (ev.tipo === 'amarilla' || ev.tipo === 'roja') && ev.equipo_id === p.equipo_visitante_id)

      const dibujarSeccionTarjetas = (startY, nombreClub, tarjetas) => {
        doc.setFont("helvetica", "bold")
        doc.text(`TARJETAS DEL CLUB: ${nombreClub.toUpperCase()}`, 15, startY)
        let yAmarillas = startY + 6
        let yRojas = startY + 45

        doc.text('TARJETAS AMARILLAS:', 15, yAmarillas)
        doc.setFont("helvetica", "normal")
        yAmarillas += 5
        const amarillas = tarjetas.filter(t => t.tipo === 'amarilla')
        for(let i=0; i<6; i++) {
          doc.text(`NO. ______`, 15, yAmarillas + (i*6))
          doc.line(35, yAmarillas + (i*6), 130, yAmarillas + (i*6))
          if (amarillas[i]) doc.text(amarillas[i].jugador, 37, yAmarillas + (i*6) - 1)
          doc.text(`POR: ________________`, 135, yAmarillas + (i*6))
        }

        doc.setFont("helvetica", "bold")
        doc.text('TARJETAS ROJAS:', 15, yRojas)
        doc.setFont("helvetica", "normal")
        yRojas += 5
        const rojas = tarjetas.filter(t => t.tipo === 'roja')
        for(let i=0; i<4; i++) {
          doc.text(`NO. ______`, 15, yRojas + (i*6))
          doc.line(35, yRojas + (i*6), 130, yRojas + (i*6))
          if (rojas[i]) doc.text(rojas[i].jugador, 37, yRojas + (i*6) - 1)
          doc.text(`POR: ________________`, 135, yRojas + (i*6))
        }
        return yRojas + 30
      }

      let nextY = dibujarSeccionTarjetas(55, equipoLocal?.nombre, tarjetasLocal)
      nextY = dibujarSeccionTarjetas(nextY, equipoVisitante?.nombre, tarjetasVisitante)

      doc.setFont("helvetica", "bold")
      doc.text('NOVEDADES:', 15, nextY)
      doc.setFont("helvetica", "normal")
      const splitText = doc.splitTextToSize(p.observaciones || 'Sin novedades registradas.', 175)
      doc.text(splitText, 15, nextY + 6)
      
      let lineY = nextY + 6 + (splitText.length * 5) + 5
      for(let i=0; i<4; i++) {
        doc.line(15, lineY + (i*8), 195, lineY + (i*8))
      }

      // FIRMAS
      const firmaY = Math.min(lineY + 50, 220)
      const fArbitro = firmas.find(f => f.tipo_firmante === 'arbitro')
      const fCapLocal = firmas.find(f => f.tipo_firmante === 'local')
      const fCapVisitante = firmas.find(f => f.tipo_firmante === 'visitante')
      const fVocal = firmas.find(f => f.tipo_firmante === 'vocal')

      if (fCapLocal?.firma_base64) doc.addImage(fCapLocal.firma_base64, 'PNG', 20, firmaY - 20, 40, 20)
      if (fCapVisitante?.firma_base64) doc.addImage(fCapVisitante.firma_base64, 'PNG', 130, firmaY - 20, 40, 20)

      doc.line(15, firmaY, 65, firmaY)
      doc.line(135, firmaY, 185, firmaY)
      doc.setFontSize(8)
      doc.setFont("helvetica", "bold")
      doc.text(`CAPITÁN ${equipoLocal?.nombre}`, 40, firmaY + 4, { align: 'center' })
      doc.text(`CAPITÁN ${equipoVisitante?.nombre}`, 160, firmaY + 4, { align: 'center' })

      const firmaY2 = firmaY + 30
      if (fArbitro?.firma_base64) doc.addImage(fArbitro.firma_base64, 'PNG', 50, firmaY2 - 20, 40, 20)
      if (fVocal?.firma_base64) doc.addImage(fVocal.firma_base64, 'PNG', 120, firmaY2 - 20, 40, 20)

      doc.line(40, firmaY2, 100, firmaY2)
      doc.line(110, firmaY2, 170, firmaY2)
      doc.text('FIRMA DEL SR. ÁRBITRO', 70, firmaY2 + 4, { align: 'center' })
      doc.text('FIRMA DEL VOCAL', 140, firmaY2 + 4, { align: 'center' })

      doc.setFontSize(8)
      doc.text('VIVE EL FUTBOL SIN DROGAS Y SIN ALCOHOL', 15, 285)
      doc.text('CAMPEONATO 2026', 170, 285)

      doc.save(`Acta_Oficial_${equipoLocal?.nombre}_vs_${equipoVisitante?.nombre}.pdf`)
      toast.success('PDF Oficial descargado')
    } catch (err) {
      console.error(err)
      toast.error('Error al generar PDF')
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
              onClick={descargarPDF}
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
    </div>
  )
}