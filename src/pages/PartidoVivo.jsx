import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import toast from 'react-hot-toast'
import { ArrowLeft, Clock, MapPin, Shield, User, X, Circle, CheckCircle, Lock, Printer, AlertTriangle, Play, Pause, RotateCcw, Ban, Pencil, DollarSign } from 'lucide-react'
import { sincronizarPartido } from '../lib/sincronizarPartido'
import FirmaModal from '../components/FirmaModal'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

const CAUSAS_COMUNES = ['Juego brusco', 'Protestas', 'Agresión', 'Demorar el juego', 'Insultos al árbitro']

export default function PartidoVivo() {
  const { id } = useParams()
  const navigate = useNavigate()

  const [cargando, setCargando] = useState(true)
  const [partido, setPartido] = useState(null)
  const [equipoLocal, setEquipoLocal] = useState(null)
  const [equipoVisitante, setEquipoVisitante] = useState(null)
  const [rolUsuario, setRolUsuario] = useState(null)
  const [esAdmin, setEsAdmin] = useState(false)
  const [esFutsala, setEsFutsala] = useState(false)

  const [jugadoresLocal, setJugadoresLocal] = useState([])
  const [jugadoresVisitante, setJugadoresVisitante] = useState([])
  const [eventos, setEventos] = useState([])
  const [faltas, setFaltas] = useState([])
  const [planillaLocal, setPlanillaLocal] = useState([])
  const [planillaVisitante, setPlanillaVisitante] = useState([])

  const [carnets, setCarnets] = useState([])
  const [sanciones, setSanciones] = useState([])
  const [firmas, setFirmas] = useState([])
  const [deudasTarjetas, setDeudasTarjetas] = useState([])

  const [jugadorSeleccionado, setJugadorSeleccionado] = useState(null)
  const [finalizando, setFinalizando] = useState(false)

  const [pasoFirma, setPasoFirma] = useState(null)
  const [firmasTemporales, setFirmasTemporales] = useState([])
  const [novedadesGenerales, setNovedadesGenerales] = useState('')

  const [periodoActual, setPeriodoActual] = useState(1)
  const [tiempoRestante, setTiempoRestante] = useState(22 * 60)
  const [relojCorriendo, setRelojCorriendo] = useState(false)

  // Modal dorsal
  const [modalDorsal, setModalDorsal] = useState(null) // { jugadorId, equipoId, jugadorNombre, dorsalActual }
  const [dorsalInput, setDorsalInput] = useState('')
  const [guardandoDorsal, setGuardandoDorsal] = useState(false)

  useEffect(() => {
    let intervalo = null
    if (relojCorriendo) {
      intervalo = setInterval(() => {
        setTiempoRestante(prev => {
          if (prev <= 1) {
            clearInterval(intervalo)
            setTimeout(() => {
              setRelojCorriendo(false)
              toast.error('¡Tiempo finalizado!', { icon: '⏱️' })
            }, 0)
            return 0
          }
          return prev - 1
        })
      }, 1000)
    }
    return () => clearInterval(intervalo)
  }, [relojCorriendo])

  useEffect(() => {
    async function cargarDatosOffline() {
      try {
        const { data: { session } } = await supabase.auth.getSession()
        const userId = session?.user?.id

        const p = await db.partidos.get(id)
        if (!p) { setCargando(false); return }
        setPartido(p)

        // Consulta ampliada: fecha + nombres de vocal/árbitro
        const { data: pData } = await supabase
          .from('partidos')
          .select(`
            fecha_id,
            vocal_id,
            arbitro_id,
            fecha:fechas(fecha_inicio, etapa:etapas(disciplina)),
            arbitro:arbitros(nombres, apellidos),
            vocal:usuarios(nombres, apellidos)
          `)
          .eq('id', id)
          .single()

        const disciplina = pData?.fecha?.etapa?.disciplina
        setEsFutsala(disciplina === 'futsala')

        setPartido(prev => ({
          ...prev,
          fecha_inicio: pData?.fecha?.fecha_inicio || null,
          vocal_nombre: pData?.vocal ? `${pData.vocal.nombres} ${pData.vocal.apellidos}` : null,
          arbitro_nombre: pData?.arbitro ? `${pData.arbitro.nombres} ${pData.arbitro.apellidos}` : null
        }))

        if (p.vocal_id === userId) setRolUsuario('vocal')
        else setRolUsuario('arbitro')

        const { data: usuarioData } = await supabase
          .from('usuarios').select('rol').eq('id', userId).single()
        setEsAdmin(['admin', 'secretaria'].includes(usuarioData?.rol))

        const local = await db.equipos.get(p.equipo_local_id)
        const visitante = await db.equipos.get(p.equipo_visitante_id)
        setEquipoLocal(local)
        setEquipoVisitante(visitante)

        const plan = await db.planilla.where('partido_id').equals(id).toArray()
        const planLoc = plan.filter(pl => pl.equipo_id === p.equipo_local_id)
        const planVis = plan.filter(pl => pl.equipo_id === p.equipo_visitante_id)
        setPlanillaLocal(planLoc)
        setPlanillaVisitante(planVis)

        const localesIds = planLoc.map(pl => pl.jugador_id)
        const visitantesIds = planVis.map(pl => pl.jugador_id)

        const jLocales = await db.jugadores.bulkGet(localesIds)
        const jVisitantes = await db.jugadores.bulkGet(visitantesIds)
        setJugadoresLocal(jLocales.filter(Boolean).sort((a, b) => a.apellidos.localeCompare(b.apellidos)))
        setJugadoresVisitante(jVisitantes.filter(Boolean).sort((a, b) => a.apellidos.localeCompare(b.apellidos)))

        const evs = await db.eventos.where('partido_id').equals(id).toArray()
        setEventos(evs)
        const flts = await db.faltas.where('partido_id').equals(id).toArray()
        setFaltas(flts)
        const f = await db.firmas.where('partido_id').equals(id).toArray()
        setFirmas(f)
        const c = await db.carnets.toArray()
        const s = await db.sanciones.where('partido_id').equals(id).toArray()
        setCarnets(c)
        setSanciones(s)

        // Deudas de tarjetas (desde Supabase, no offline)
        await cargarDeudasTarjetas()
      } catch (err) {
        console.error(err)
        toast.error('Error al cargar el partido')
      } finally {
        setCargando(false)
      }
    }
    cargarDatosOffline()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [id])

  async function cargarDeudasTarjetas() {
    try {
      const { data, error } = await supabase.rpc('obtener_deudas_tarjetas_partido', { p_partido_id: id })
      if (error) throw error
      setDeudasTarjetas(Array.isArray(data) ? data : [])
    } catch (err) {
      console.error('Error cargando deudas:', err)
    }
  }

  function esTitular(jugadorId, equipoId) {
    const plan = equipoId === partido?.equipo_local_id ? planillaLocal : planillaVisitante
    return plan.find(pl => pl.jugador_id === jugadorId)?.es_titular ?? false
  }

  function esCapitan(jugadorId, equipoId) {
    const plan = equipoId === partido?.equipo_local_id ? planillaLocal : planillaVisitante
    return plan.find(pl => pl.jugador_id === jugadorId)?.es_capitan ?? false
  }

  async function toggleTitular(jugadorId, equipoId) {
    if (partido.jugado) return toast.error('El acta ya está finalizada')
    if (rolUsuario !== 'vocal' && !esAdmin) return toast.error('Solo el vocal puede modificar la planilla')
    const { habilitado, motivo } = evaluarJugador(jugadorId)
    if (!habilitado) return toast.error(`No se puede habilitar: ${motivo}`)
    const plan = equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    const insc = plan.find(pl => pl.jugador_id === jugadorId)
    if (!insc) return
    const nuevoEstado = !insc.es_titular
    await db.planilla.update(insc.id, { es_titular: nuevoEstado, sync_status: 'pending' })
    if (equipoId === partido.equipo_local_id) {
      setPlanillaLocal(prev => prev.map(p => p.id === insc.id ? { ...p, es_titular: nuevoEstado } : p))
    } else {
      setPlanillaVisitante(prev => prev.map(p => p.id === insc.id ? { ...p, es_titular: nuevoEstado } : p))
    }
  }

  async function marcarCapitan(jugadorId, equipoId) {
    if (partido.jugado) return toast.error('El acta ya está finalizada')
    if (rolUsuario !== 'vocal') return toast.error('Solo el vocal puede designar capitán')
    const plan = equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    // Quitar capitanía a otros del mismo equipo
    for (const pl of plan) {
      if (pl.es_capitan && pl.jugador_id !== jugadorId) {
        await db.planilla.update(pl.id, { es_capitan: false, sync_status: 'pending' })
      }
    }
    const insc = plan.find(pl => pl.jugador_id === jugadorId)
    if (!insc) return
    const nuevo = !insc.es_capitan
    await db.planilla.update(insc.id, { es_capitan: nuevo, sync_status: 'pending' })
    if (equipoId === partido.equipo_local_id) {
      setPlanillaLocal(prev => prev.map(p => ({
        ...p,
        es_capitan: p.jugador_id === jugadorId ? nuevo : (p.es_capitan && nuevo ? false : p.es_capitan)
      })))
    } else {
      setPlanillaVisitante(prev => prev.map(p => ({
        ...p,
        es_capitan: p.jugador_id === jugadorId ? nuevo : (p.es_capitan && nuevo ? false : p.es_capitan)
      })))
    }
    toast.success(nuevo ? 'Capitán designado' : 'Capitanía removida')
  }

  function abrirModalDorsal(jugadorId, equipoId, jugadorNombre) {
    if (partido.jugado) return toast.error('El acta ya está finalizada')
    if (rolUsuario !== 'vocal') return toast.error('Solo el vocal puede cambiar el dorsal')
    const plan = equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    const insc = plan.find(pl => pl.jugador_id === jugadorId)
    setDorsalInput(insc?.dorsal ? String(insc.dorsal) : '')
    setModalDorsal({ jugadorId, equipoId, jugadorNombre, dorsalActual: insc?.dorsal })
  }

  async function guardarDorsal() {
    const num = parseInt(dorsalInput, 10)
    if (!num || num < 1 || num > 99) return toast.error('Dorsal debe ser entre 1 y 99')
    const plan = modalDorsal.equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    const duplicado = plan.find(pl => pl.dorsal === num && pl.jugador_id !== modalDorsal.jugadorId)
    if (duplicado) return toast.error(`Dorsal ${num} ya usado por otro jugador de este equipo`)
    setGuardandoDorsal(true)
    try {
      const insc = plan.find(pl => pl.jugador_id === modalDorsal.jugadorId)
      if (!insc) throw new Error('No se encontró al jugador en la planilla')
      await db.planilla.update(insc.id, { dorsal: num, sync_status: 'pending' })
      if (modalDorsal.equipoId === partido.equipo_local_id) {
        setPlanillaLocal(prev => prev.map(p => p.jugador_id === modalDorsal.jugadorId ? { ...p, dorsal: num } : p))
      } else {
        setPlanillaVisitante(prev => prev.map(p => p.jugador_id === modalDorsal.jugadorId ? { ...p, dorsal: num } : p))
      }
      // Sincronizar a Supabase si hay red
      if (navigator.onLine) {
        const { error } = await supabase.from('planilla_partido').update({ dorsal: num }).eq('id', insc.id)
        if (error) throw error
        await db.planilla.update(insc.id, { sync_status: 'synced' })
      }
      toast.success('Dorsal actualizado')
      setModalDorsal(null)
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar dorsal')
    } finally {
      setGuardandoDorsal(false)
    }
  }

  function evaluarJugador(jugadorId) {
    const carnet = carnets.find(item => item.jugador_id === jugadorId)
    if (!carnet) return { habilitado: false, motivo: 'Sin carnet registrado' }
    if (!carnet.valido) return { habilitado: false, motivo: carnet.motivo_bloqueo || 'Carnet no válido' }
    const sancion = sanciones.find(item => item.jugador_id === jugadorId && item.activa)
    if (sancion) return { habilitado: false, motivo: `Sanción: ${sancion.motivo || sancion.tipo}` }
    return { habilitado: true, motivo: null }
  }

  function getEventosJugador(jugadorId) {
    return eventos.filter(evento => evento.jugador_id === jugadorId)
  }

  function getFaltasTotalesJugador(jugadorId) {
    return faltas.filter(falta => falta.jugador_id === jugadorId).length
  }

  function getFaltasJugadorPeriodo(jugadorId) {
    return faltas.filter(falta => falta.jugador_id === jugadorId && Number(falta.periodo || 1) === Number(periodoActual)).length
  }

  const { golesLocal, golesVisitante, faltasEqLocal, faltasEqVisitante } = useMemo(() => ({
    golesLocal: eventos.filter(evento => evento.tipo === 'gol' && evento.equipo_id === partido?.equipo_local_id).length,
    golesVisitante: eventos.filter(evento => evento.tipo === 'gol' && evento.equipo_id === partido?.equipo_visitante_id).length,
    faltasEqLocal: faltas.filter(falta => falta.equipo_id === partido?.equipo_local_id && Number(falta.periodo || 1) === Number(periodoActual)).length,
    faltasEqVisitante: faltas.filter(falta => falta.equipo_id === partido?.equipo_visitante_id && Number(falta.periodo || 1) === Number(periodoActual)).length
  }), [eventos, faltas, partido, periodoActual])

  async function registrarEvento(tipo, causa = null) {
    if (!jugadorSeleccionado || partido.jugado) return
    const jugador = jugadorSeleccionado.jugador
    const { habilitado, motivo } = evaluarJugador(jugador.id)
    if (!habilitado) return toast.error(`No se puede registrar el evento: ${motivo}`)

    let causaFinal = causa
    if (causaFinal === 'Otra causa...') {
      causaFinal = window.prompt('Escriba la causa:')
      if (!causaFinal?.trim()) return
      causaFinal = causaFinal.trim()
    }

    const minutoStr = window.prompt('Ingrese el minuto:', '1')
    if (minutoStr === null) return
    const minuto = Number.parseInt(minutoStr, 10)
    if (!Number.isInteger(minuto) || minuto < 0) return toast.error('Ingrese un minuto válido')

    try {
      const nuevoEvento = {
        partido_id: id,
        tipo,
        jugador_id: jugador.id,
        equipo_id: jugadorSeleccionado.equipoId,
        minuto,
        sync_status: 'pending',
        causa: causaFinal
      }
      const eventId = await db.eventos.add(nuevoEvento)
      setEventos(prev => [...prev, { ...nuevoEvento, id: eventId }])
      toast.success('Evento registrado')
      setJugadorSeleccionado(null)
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar evento')
    }
  }

  async function registrarFalta() {
    if (!jugadorSeleccionado || partido.jugado) return
    const jugador = jugadorSeleccionado.jugador
    const { habilitado, motivo } = evaluarJugador(jugador.id)
    if (!habilitado) return toast.error(`No se puede registrar la falta: ${motivo}`)

    const minutoStr = window.prompt('Ingrese el minuto de la falta:', '1')
    if (minutoStr === null) return
    const minuto = Number.parseInt(minutoStr, 10)
    if (!Number.isInteger(minuto) || minuto < 0) return toast.error('Ingrese un minuto válido')

    try {
      const nuevaFalta = {
        partido_id: id,
        jugador_id: jugador.id,
        equipo_id: jugadorSeleccionado.equipoId,
        tipo: 'personal',
        periodo: Number(periodoActual),
        minuto
      }
      const faltaId = await db.faltas.add(nuevaFalta)
      setFaltas(prev => [...prev, { ...nuevaFalta, id: faltaId }])
      const faltasTotales = getFaltasTotalesJugador(jugador.id) + 1
      if (faltasTotales >= 5) {
        toast.error('¡5ta Falta Personal! El jugador queda expulsado del partido.', { duration: 5000 })
      } else {
        toast.success('Falta registrada')
      }
      setJugadorSeleccionado(null)
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar falta')
    }
  }

  function iniciarCierre() {
    if (!window.confirm('¿Deseas finalizar el partido? Se procederá a firmar el acta.')) return
    setRelojCorriendo(false)
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
      await db.firmas.where('partido_id').equals(id).delete()
      for (const f of firmasFinales) {
        await db.firmas.add({
          partido_id: id,
          tipo_firmante: f.tipo,
          firma_base64: f.firma,
          de_acuerdo: f.deAcuerdo,
          motivo_desacuerdo: f.motivo,
          sync_status: 'pending'
        })
      }
      const firmasActualizadas = await db.firmas.where('partido_id').equals(id).toArray()
      setFirmas(firmasActualizadas)

      await db.partidos.update(id, { jugado: true, observaciones: textoNovedades, sync_status: 'pending' })
      setPartido(prev => ({ ...prev, jugado: true, observaciones: textoNovedades }))

      if (navigator.onLine) {
        try { await sincronizarPartido(id) } catch (e) { console.error(e) }
        await cargarDeudasTarjetas()
      }
      toast.success('Acta finalizada')
    } catch (err) {
      console.error(err)
      toast.error('Error al finalizar el acta')
    } finally {
      setFinalizando(false)
    }
  }

  function toggleReloj() { setRelojCorriendo(v => !v) }
  function reiniciarReloj() { setRelojCorriendo(false); setTiempoRestante(22 * 60) }
  function pasarSegundoTiempo() { setRelojCorriendo(false); setPeriodoActual(2); setTiempoRestante(22 * 60) }
  function formatearTiempo(s) {
    const m = Math.floor(s / 60); const seg = s % 60
    return `${String(m).padStart(2,'0')}:${String(seg).padStart(2,'0')}`
  }

  // ================= PDF =================
  function descargarPDF() {
    try {
      const doc = new jsPDF()
      const p = partido
      const sanitize = (s) => s ? String(s).trim() : ''

      const getDorsal = (jugadorId) => {
        const pl = planillaLocal.find(item => item.jugador_id === jugadorId)
          || planillaVisitante.find(item => item.jugador_id === jugadorId)
        return pl?.dorsal ? String(pl.dorsal) : '-'
      }

      const todosLosJugadores = [...jugadoresLocal, ...jugadoresVisitante]
      const getJugadorInfo = (jugadorId) => {
        const j = todosLosJugadores.find(item => item.id === jugadorId)
        const d = getDorsal(jugadorId)
        const dorsalStr = d !== '-' ? d : ''
        if (!j) return { dorsal: dorsalStr, nombreCompleto: '' }
        return { dorsal: dorsalStr, nombreCompleto: `${j.apellidos} ${j.nombres}` }
      }

      const dibujarEncabezado = (pagina) => {
        doc.setFont('helvetica', 'bold'); doc.setFontSize(14)
        doc.text('LIGA DEPORTIVA BARRIAL JOSE I. IZURIETA', 105, 15, { align: 'center' })
        doc.setFontSize(9); doc.setFont('helvetica', 'normal')
        doc.text('PUJILI - ECUADOR', 105, 20, { align: 'center' })
        doc.text('FUNDADA EL 09 DE MARZO DEL 2013', 20, 26)
        doc.text('ACUERDO MUNICIPAL NO. 034-GADMP-2013', 130, 26)
        doc.line(15, 28, 195, 28)
        doc.setFont('helvetica', 'bold'); doc.setFontSize(12)
        doc.text(`ACTA DE JUEGO - PAGINA ${pagina}`, 105, 35, { align: 'center' })
      }

      dibujarEncabezado(1)
      doc.setFontSize(9); doc.setFont('helvetica', 'normal')

      const fechaStr = p.fecha_inicio
        ? new Date(p.fecha_inicio + 'T00:00:00').toLocaleDateString('es-EC')
        : '--/--/----'

      doc.text(`VOCAL DE TURNO: ${sanitize(p.vocal_nombre) || '____________________'}`, 15, 45)
      doc.text('CIUDAD: Pujili', 100, 45)
      doc.text(`FECHA: ${fechaStr}`, 145, 45)
      doc.text(`HORA: ${p.hora?.slice(0,5) || '________'}`, 15, 51)

      doc.setFont('helvetica', 'bold')
      doc.text(`CLUB: ${sanitize(equipoLocal?.nombre?.toUpperCase())}`, 15, 60)
      doc.text(`CATEGORIA: ${sanitize(equipoLocal?.categoria?.toUpperCase())}`, 100, 60)

      const filasLocal = jugadoresLocal
        .filter(j => planillaLocal.some(pl => pl.jugador_id === j.id))
        .map(j => {
          const dorsal = getDorsal(j.id)
          const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
          const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
          const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
          return [dorsal, sanitize(`${j.apellidos} ${j.nombres}`), goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
        })

      autoTable(doc, {
        startY: 63,
        head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']],
        body: filasLocal, theme: 'grid',
        headStyles: { fillColor: [200,200,200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0:{cellWidth:15,halign:'center'}, 1:{cellWidth:110}, 2:{cellWidth:15,halign:'center'}, 3:{cellWidth:15,halign:'center'}, 4:{cellWidth:15,halign:'center'} }
      })

      let finalY = doc.lastAutoTable.finalY + 10
      doc.setFont('helvetica', 'bold')
      doc.text(`CLUB: ${sanitize(equipoVisitante?.nombre?.toUpperCase())}`, 15, finalY)
      doc.text(`CATEGORIA: ${sanitize(equipoVisitante?.categoria?.toUpperCase())}`, 100, finalY)

      const filasVisitante = jugadoresVisitante
        .filter(j => planillaVisitante.some(pl => pl.jugador_id === j.id))
        .map(j => {
          const dorsal = getDorsal(j.id)
          const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
          const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
          const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
          return [dorsal, sanitize(`${j.apellidos} ${j.nombres}`), goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
        })

      autoTable(doc, {
        startY: finalY + 3,
        head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']],
        body: filasVisitante, theme: 'grid',
        headStyles: { fillColor: [200,200,200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0:{cellWidth:15,halign:'center'}, 1:{cellWidth:110}, 2:{cellWidth:15,halign:'center'}, 3:{cellWidth:15,halign:'center'}, 4:{cellWidth:15,halign:'center'} }
      })

      doc.addPage()
      dibujarEncabezado(2)
      doc.setFontSize(9)
      doc.setFont('helvetica', 'normal')
      doc.text(`ÁRBITRO: ${sanitize(p.arbitro_nombre) || '________________________'}`, 15, 45)

      const tarjetas = eventos.filter(evento => evento.tipo === 'amarilla' || evento.tipo === 'roja')
      autoTable(doc, {
        startY: 52,
        head: [['CLUB', 'NO.', 'JUGADOR', 'TARJETA', 'MINUTO', 'CAUSA']],
        body: tarjetas.map(evento => {
          const jugador = getJugadorInfo(evento.jugador_id)
          const equipo = evento.equipo_id === p.equipo_local_id ? equipoLocal : equipoVisitante
          return [
            sanitize(equipo?.nombre),
            jugador.dorsal,
            sanitize(jugador.nombreCompleto),
            evento.tipo === 'amarilla' ? 'Amarilla' : 'Roja',
            evento.minuto ?? '',
            sanitize(evento.causa)
          ]
        }),
        theme: 'grid',
        headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 }
      })

      let novedadesY = doc.lastAutoTable.finalY + 10
      const novedades = doc.splitTextToSize(sanitize(p.observaciones || 'Sin novedades registradas.'), 175)
      if (novedadesY + novedades.length * 5 > 215) {
        doc.addPage()
        dibujarEncabezado(3)
        novedadesY = 50
      }
      doc.setFont('helvetica', 'bold')
      doc.text('NOVEDADES:', 15, novedadesY)
      doc.setFont('helvetica', 'normal')
      doc.text(novedades, 15, novedadesY + 6)

      let firmaY = novedadesY + 12 + novedades.length * 5
      if (firmaY + 28 > 285) {
        doc.addPage()
        dibujarEncabezado(3)
        firmaY = 50
      }
      const firmantes = [
        { tipo: 'local', texto: `CAPITÁN ${equipoLocal?.nombre || 'LOCAL'}` },
        { tipo: 'visitante', texto: `CAPITÁN ${equipoVisitante?.nombre || 'VISITANTE'}` },
        { tipo: 'arbitro', texto: 'ÁRBITRO' },
        { tipo: 'vocal', texto: 'VOCAL' }
      ]
      firmantes.forEach((firmante, index) => {
        const firma = firmas.find(item => item.tipo_firmante === firmante.tipo)
        const x = 15 + (index % 2) * 95
        const y = firmaY + Math.floor(index / 2) * 32
        if (firma?.firma_base64) {
          try {
            doc.addImage(firma.firma_base64, 'PNG', x + 20, y, 45, 16)
          } catch (error) {
            console.error('Error al dibujar firma en PDF:', error)
          }
        }
        doc.line(x, y + 18, x + 85, y + 18)
        doc.setFontSize(8)
        doc.setFont('helvetica', 'bold')
        doc.text(firmante.texto, x + 42, y + 23, { align: 'center' })
      })

      doc.save(`acta-${p.id || 'partido'}.pdf`)
    } catch (error) {
      console.error('Error al generar el PDF:', error)
    }
  }

  if (cargando) {
    return <div className="min-h-screen flex items-center justify-center font-bold">Cargando partido...</div>
  }

  if (!partido) {
    return (
      <div className="min-h-screen flex flex-col items-center justify-center gap-4 p-8 text-center">
        <p className="text-xl font-bold">Partido no encontrado</p>
        <button onClick={() => navigate('/partidos')} className="text-liga-azul underline">Volver a mis partidos</button>
      </div>
    )
  }

  function renderJugador(jugador, equipoId) {
    const { habilitado, motivo } = evaluarJugador(jugador.id)
    const titular = esTitular(jugador.id, equipoId)
    const plan = equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    const inscripcion = plan.find(item => item.jugador_id === jugador.id)
    const eventosJugador = getEventosJugador(jugador.id)
    const faltasTotales = getFaltasTotalesJugador(jugador.id)
    const faltasPeriodo = getFaltasJugadorPeriodo(jugador.id)
    const expulsadoPorFaltas = esFutsala && faltasTotales >= 5
    const bloqueado = !habilitado || expulsadoPorFaltas

    return (
      <div
        key={jugador.id}
        onClick={() => {
          if (partido.jugado) return toast.error('El acta ya está finalizada')
          if (expulsadoPorFaltas) return toast.error('Este jugador fue expulsado por acumulación de 5 faltas.')
          setJugadorSeleccionado({ jugador, equipoId, habilitado, motivo })
        }}
        className={`p-3 flex justify-between items-center cursor-pointer transition-colors ${bloqueado ? 'bg-red-50 opacity-80' : titular ? 'bg-green-50 hover:bg-green-100' : 'hover:bg-gray-100'}`}
      >
        <div className="flex items-center gap-3 min-w-0">
          <div className="w-8 h-8 shrink-0 rounded-full bg-gray-200 flex items-center justify-center text-xs font-bold text-gray-600 overflow-hidden relative">
            {bloqueado && <div className="absolute inset-0 bg-black/40 flex items-center justify-center"><Lock size={12} className="text-white" /></div>}
            {jugador.foto_url
              ? <img src={jugador.foto_url} alt="" className="w-full h-full object-cover" />
              : <User size={16} />}
          </div>
          <div className="min-w-0">
            <p className="font-semibold text-sm text-gray-800 flex items-center gap-1">
              <span className="truncate">{jugador.apellidos}</span>
              {titular && habilitado && <CheckCircle size={12} className="text-green-600 shrink-0" />}
              {inscripcion?.es_capitan && <span className="text-xs text-amber-600">C</span>}
            </p>
            <p className="text-xs text-gray-500 truncate">
              {jugador.nombres}
              {inscripcion?.dorsal ? ` · #${inscripcion.dorsal}` : ''}
              {faltasPeriodo > 0 && !expulsadoPorFaltas && <span className="text-orange-500 font-bold ml-1">(Faltas: {faltasPeriodo})</span>}
            </p>
          </div>
        </div>
        <div className="flex gap-1 items-center shrink-0">
          {expulsadoPorFaltas && <span className="text-[10px] font-bold text-red-600 mr-2 flex items-center gap-1"><Ban size={12} /> 5 Faltas</span>}
          {!expulsadoPorFaltas && !habilitado && <span className="text-[10px] font-bold text-red-600 mr-2">{motivo}</span>}
          {eventosJugador.map(evento => {
            if (evento.tipo === 'gol') return <Circle key={evento.id} size={16} className="text-green-600 fill-green-600" />
            if (evento.tipo === 'amarilla') return <span key={evento.id} className="w-3 h-4 bg-yellow-400 rounded-sm" />
            if (evento.tipo === 'roja') return <span key={evento.id} className="w-3 h-4 bg-red-600 rounded-sm" />
            return null
          })}
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-gray-100 pb-20">
      <header className="bg-liga-azul text-white p-4 flex items-center gap-3 sticky top-0 z-10 shadow-md">
        <button onClick={() => navigate('/partidos')} className="p-2 bg-white/10 rounded-md hover:bg-white/20" aria-label="Volver a mis partidos">
          <ArrowLeft size={20} />
        </button>
        <div>
          <h1 className="font-bold">Partido en Vivo</h1>
          <p className="text-xs text-liga-amarillo capitalize">
            Sesión: {rolUsuario} {esAdmin && '· Administración'} {esFutsala && `(Futsala - Periodo ${periodoActual})`}
          </p>
        </div>
      </header>

      <main className="max-w-4xl mx-auto p-4 space-y-4">
        <section className="bg-white rounded-lg shadow-md p-4">
          <div className="flex justify-between items-center text-gray-500 text-sm mb-2 px-4">
            <span className="flex items-center gap-1"><Clock size={14} /> {partido.hora?.slice(0, 5) || '--:--'}</span>
            <span className="flex items-center gap-1"><MapPin size={14} /> {partido.cancha || 'Sin cancha'}</span>
          </div>

          <div className="flex justify-between items-center mt-4">
            <div className="flex-1 text-right pr-4">
              <p className="text-lg font-bold text-gray-800 leading-tight">{equipoLocal?.nombre}</p>
              {esFutsala && <p className="text-xs text-red-500 font-semibold">Faltas Eq ({periodoActual}T): {faltasEqLocal} / 6</p>}
            </div>
            <div className="bg-gray-800 px-6 py-3 rounded-lg text-4xl font-black text-white shadow-inner">{golesLocal} - {golesVisitante}</div>
            <div className="flex-1 text-left pl-4">
              <p className="text-lg font-bold text-gray-800 leading-tight">{equipoVisitante?.nombre}</p>
              {esFutsala && <p className="text-xs text-red-500 font-semibold">Faltas Eq ({periodoActual}T): {faltasEqVisitante} / 6</p>}
            </div>
          </div>

          {deudasTarjetas.length > 0 && (
            <p className="mt-3 flex items-center justify-center gap-2 text-sm text-amber-700">
              <DollarSign size={16} /> Deudas de tarjetas pendientes: {deudasTarjetas.length}
            </p>
          )}

          {esFutsala && !partido.jugado && (
            <div className="mt-4 border-t pt-3 flex items-center justify-center gap-4">
              <div className="text-2xl font-mono font-bold text-liga-azul bg-gray-100 px-4 py-1 rounded-md">{formatearTiempo(tiempoRestante)}</div>
              <button onClick={toggleReloj} className={`p-2 rounded-full text-white ${relojCorriendo ? 'bg-red-500' : 'bg-green-500'}`} aria-label={relojCorriendo ? 'Pausar reloj' : 'Iniciar reloj'}>
                {relojCorriendo ? <Pause size={20} /> : <Play size={20} />}
              </button>
              <button onClick={reiniciarReloj} className="p-2 rounded-full bg-gray-500 text-white" aria-label="Reiniciar reloj"><RotateCcw size={20} /></button>
              {periodoActual === 1 && (
                <button onClick={pasarSegundoTiempo} className="text-xs bg-liga-amarillo text-black font-bold px-3 py-1 rounded shadow">
                  Iniciar 2do Tiempo
                </button>
              )}
            </div>
          )}
        </section>

        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <section className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-liga-azul text-white p-3 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2"><Shield size={18} /> {equipoLocal?.nombre}</h2>
            </div>
            <div className="divide-y divide-gray-100">{jugadoresLocal.map(jugador => renderJugador(jugador, partido.equipo_local_id))}</div>
          </section>
          <section className="bg-white rounded-lg shadow-md overflow-hidden">
            <div className="bg-gray-800 text-white p-3 flex justify-between items-center">
              <h2 className="font-bold flex items-center gap-2"><Shield size={18} /> {equipoVisitante?.nombre}</h2>
            </div>
            <div className="divide-y divide-gray-100">{jugadoresVisitante.map(jugador => renderJugador(jugador, partido.equipo_visitante_id))}</div>
          </section>
        </div>

        <section className="mt-8">
          <button
            onClick={iniciarCierre}
            disabled={finalizando || partido.jugado}
            className={`w-full py-4 rounded-xl font-bold text-lg shadow-lg flex items-center justify-center gap-2 ${partido.jugado ? 'bg-gray-300 text-gray-500 cursor-not-allowed' : 'bg-liga-rojo text-white hover:bg-red-700'}`}
          >
            {finalizando ? 'Procesando...' : partido.jugado ? 'Acta Finalizada' : 'Finalizar Partido y Firmar Acta'}
          </button>
          {partido.jugado && (
            <button onClick={descargarPDF} className="w-full mt-3 py-4 rounded-xl font-bold text-lg shadow-lg bg-gray-800 text-white hover:bg-black transition-colors flex items-center justify-center gap-2">
              <Printer size={20} /> Descargar / Imprimir Acta PDF
            </button>
          )}
        </section>
      </main>

      {jugadorSeleccionado && (
        <div className="fixed inset-0 bg-black/60 z-50 flex items-end sm:items-center justify-center">
          <div className="bg-white w-full sm:max-w-sm rounded-t-2xl sm:rounded-xl p-5 animate-in slide-in-from-bottom-5 max-h-[90vh] overflow-y-auto">
            <div className="flex justify-between items-center mb-4 pb-2 border-b">
              <div>
                <h2 className="font-bold text-gray-800 text-lg">{jugadorSeleccionado.jugador.apellidos}</h2>
                <p className="text-sm text-gray-500">{jugadorSeleccionado.jugador.nombres}</p>
                {!jugadorSeleccionado.habilitado && <p className="text-xs text-red-600 font-bold mt-1">BLOQUEADO: {jugadorSeleccionado.motivo}</p>}
              </div>
              <button onClick={() => setJugadorSeleccionado(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200" aria-label="Cerrar"><X size={20} /></button>
            </div>

            {rolUsuario === 'vocal' && (
              <div className="mb-4 space-y-2">
                <button
                  onClick={() => toggleTitular(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId)}
                  disabled={!jugadorSeleccionado.habilitado}
                  className={`w-full py-2 rounded-lg font-bold border-2 flex items-center justify-center gap-2 ${!jugadorSeleccionado.habilitado ? 'bg-gray-200 border-gray-300 text-gray-400 cursor-not-allowed' : esTitular(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId) ? 'bg-green-50 border-green-600 text-green-700' : 'bg-gray-50 border-gray-300 text-gray-600'}`}
                >
                  <CheckCircle size={18} />
                  {esTitular(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId) ? 'Es Titular (Quitar)' : 'Marcar como Titular'}
                </button>
                <button
                  onClick={() => marcarCapitan(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId)}
                  className="w-full py-2 rounded-lg font-bold border border-amber-400 text-amber-700 bg-amber-50"
                >
                  {esCapitan(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId) ? 'Quitar capitanía' : 'Designar capitán'}
                </button>
                <button
                  onClick={() => abrirModalDorsal(jugadorSeleccionado.jugador.id, jugadorSeleccionado.equipoId, `${jugadorSeleccionado.jugador.apellidos} ${jugadorSeleccionado.jugador.nombres}`)}
                  className="w-full py-2 rounded-lg font-bold border border-gray-300 text-gray-700 flex items-center justify-center gap-2"
                >
                  <Pencil size={16} /> Cambiar dorsal
                </button>
              </div>
            )}

            <div className="grid grid-cols-1 gap-2 pt-2 border-t">
              <p className="text-xs text-center text-gray-500 mb-1">Registrar evento:</p>
              <button onClick={() => registrarEvento('gol')} disabled={!jugadorSeleccionado.habilitado} className="bg-green-600 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                <Circle size={20} className="fill-white" /> ¡GOL!
              </button>
              {esFutsala && (
                <button onClick={registrarFalta} disabled={!jugadorSeleccionado.habilitado} className="bg-orange-500 text-white py-3 rounded-lg font-bold flex items-center justify-center gap-2 disabled:opacity-50">
                  <AlertTriangle size={20} /> Registrar Falta ({periodoActual}T)
                </button>
              )}
              <select
                defaultValue=""
                onChange={event => { if (event.target.value) registrarEvento('amarilla', event.target.value) }}
                disabled={!jugadorSeleccionado.habilitado}
                className="w-full bg-yellow-400 text-yellow-900 py-3 rounded-lg font-bold text-center cursor-pointer disabled:opacity-50"
              >
                <option value="">Tarjeta amarilla (elegir causa)</option>
                {CAUSAS_COMUNES.map(causa => <option key={causa} value={causa}>{causa}</option>)}
                <option value="Otra causa...">Otra causa...</option>
              </select>
              <select
                defaultValue=""
                onChange={event => { if (event.target.value) registrarEvento('roja', event.target.value) }}
                disabled={!jugadorSeleccionado.habilitado}
                className="w-full bg-red-600 text-white py-3 rounded-lg font-bold text-center cursor-pointer disabled:opacity-50"
              >
                <option value="">Tarjeta roja (elegir causa)</option>
                {CAUSAS_COMUNES.map(causa => <option key={causa} value={causa}>{causa}</option>)}
                <option value="Otra causa...">Otra causa...</option>
              </select>
            </div>
          </div>
        </div>
      )}

      {modalDorsal && (
        <div className="fixed inset-0 bg-black/60 z-[60] flex items-center justify-center p-4">
          <div className="bg-white w-full max-w-sm rounded-xl p-5 shadow-xl">
            <div className="flex justify-between items-center mb-4">
              <h2 className="font-bold">Cambiar dorsal</h2>
              <button onClick={() => setModalDorsal(null)} className="p-1 text-gray-500" aria-label="Cerrar"><X size={20} /></button>
            </div>
            <p className="text-sm text-gray-600 mb-3">{modalDorsal.jugadorNombre}</p>
            <label htmlFor="dorsal" className="block text-sm font-medium mb-1">Número (1-99)</label>
            <input id="dorsal" type="number" min="1" max="99" value={dorsalInput} onChange={event => setDorsalInput(event.target.value)} className="w-full border rounded-lg p-2 mb-4" />
            <div className="flex gap-2">
              <button onClick={() => setModalDorsal(null)} className="flex-1 py-2 border rounded-lg">Cancelar</button>
              <button onClick={guardarDorsal} disabled={guardandoDorsal} className="flex-1 py-2 bg-liga-azul text-white rounded-lg disabled:opacity-50">
                {guardandoDorsal ? 'Guardando...' : 'Guardar'}
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
