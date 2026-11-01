import { useState, useEffect, useMemo } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import toast from 'react-hot-toast'
import {
  ArrowLeft, Clock, MapPin, Shield, User, X, Lock,
  Printer, AlertTriangle, Play, Pause, RotateCcw, Ban, DollarSign
} from 'lucide-react'
import { sincronizarPartido } from '../lib/sincronizarPartido'
import FirmaModal from '../components/FirmaModal'
import jsPDF from 'jspdf'
import autoTable from 'jspdf-autotable'

// ✅ FIX: constante usada por el selector de causa de tarjetas
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
  // ✅ FIX: guard anti doble-clic al registrar faltas
  const [registrandoFalta, setRegistrandoFalta] = useState(false)
  // ✅ FIX: guard anti doble-clic al registrar eventos (goles/tarjetas)
  const [registrandoEvento, setRegistrandoEvento] = useState(false)

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

  // ✅ FIX Punto 2: estado para cobro manual de tarjetas
  const [cobrandoTarjeta, setCobrandoTarjeta] = useState(null)

  // ✅ FIX: límite de faltas según disciplina (usado por registrarFalta)
  const LIMITE_FALTAS = esFutsala ? 5 : 6

  // ✅ FIX: ajustar tiempo inicial cuando se detecta futsala
  useEffect(() => {
    if (esFutsala) setTiempoRestante(20 * 60)
  }, [esFutsala])

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

  // ✅ FIX: ahora SÍ se usa (en renderJugador) para mostrar faltas del período actual
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
    // ✅ FIX: guard anti doble-clic
    if (registrandoEvento) return
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

    setRegistrandoEvento(true)
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
    } finally {
      setRegistrandoEvento(false)
    }
  }

  async function registrarFalta() {
    // ✅ FIX: guard anti doble-clic (bug de duplicados en faltas_partido)
    if (registrandoFalta) return
    if (!jugadorSeleccionado || partido.jugado) return
    const jugador = jugadorSeleccionado.jugador
    const { habilitado, motivo } = evaluarJugador(jugador.id)
    if (!habilitado) return toast.error(`No se puede registrar la falta: ${motivo}`)

    const minutoStr = window.prompt('Ingrese el minuto de la falta:', '1')
    if (minutoStr === null) return
    const minuto = Number.parseInt(minutoStr, 10)
    if (!Number.isInteger(minuto) || minuto < 0) return toast.error('Ingrese un minuto válido')

    setRegistrandoFalta(true)
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
      // ✅ FIX: usa LIMITE_FALTAS (5 futsala / 6 fútbol)
      if (faltasTotales >= LIMITE_FALTAS) {
        toast.error(`¡${LIMITE_FALTAS}ta Falta Personal! El jugador queda expulsado del partido.`, { duration: 5000 })
      } else {
        toast.success('Falta registrada')
      }
      setJugadorSeleccionado(null)
    } catch (err) {
      console.error(err)
      toast.error('Error al guardar falta')
    } finally {
      setRegistrandoFalta(false)
    }
  }

  // ✅ FIX Punto 2: cobro manual de tarjetas
  async function cobrarTarjeta(deuda) {
    if (cobrandoTarjeta) return
    if (!window.confirm(`¿Registrar pago de $${deuda.monto ?? deuda.valor ?? '?'} por tarjeta de ${deuda.jugador_nombre || 'jugador'}?`)) return
    // ✅ FIX: unificado ?? en ambos lados (antes había || aquí y ?? arriba)
    setCobrandoTarjeta(deuda.id ?? deuda.jugador_id)
    try {
      const { error } = await supabase.rpc('registrar_pago_deuda_jugador', {
        p_jugador_id: deuda.jugador_id,
        p_monto: deuda.monto ?? deuda.valor,
        p_tipo: deuda.tipo || 'tarjeta'
      })
      if (error) throw error
      toast.success('Pago registrado')
      await cargarDeudasTarjetas()
    } catch (err) {
      console.error(err)
      toast.error('Error al registrar el pago: ' + (err.message || 'desconocido'))
    } finally {
      setCobrandoTarjeta(null)
    }
  }

  function iniciarCierre() {
    // ✅ FIX: guard por si el acta ya estaba cerrada
    if (partido?.jugado) return toast.error('El acta ya está finalizada')
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
      // ✅ FIX: trim defensivo por si FirmaModal devuelve ''
      const textoFinal = (datosFirma.novedades?.trim() || novedadesGenerales || '').trim()
      await ejecutarFinalizacion(nuevasFirmas, textoFinal)
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
  function reiniciarReloj() {
    setRelojCorriendo(false)
    // ✅ FIX: respeta el tiempo según disciplina
    setTiempoRestante(esFutsala ? 20 * 60 : 22 * 60)
  }
  function pasarSegundoTiempo() {
    setRelojCorriendo(false)
    setPeriodoActual(2)
    setTiempoRestante(esFutsala ? 20 * 60 : 22 * 60)
  }
  function formatearTiempo(s) {
    const m = Math.floor(s / 60); const seg = s % 60
    return `${String(m).padStart(2, '0')}:${String(seg).padStart(2, '0')}`
  }

  // ================= PDF =================
  function descargarPDF() {
    try {
      // ✅ FIX: validación defensiva además del botón condicionado
      if (!partido?.jugado) return toast.error('El acta aún no está finalizada')

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

      // ✅ FIX Punto 5: helper para obtener nombre del capitán por equipo
      const getNombreCapitan = (equipoId) => {
        const plan = equipoId === p.equipo_local_id ? planillaLocal : planillaVisitante
        const cap = plan.find(pl => pl.es_capitan)
        if (!cap) return ''
        const jug = todosLosJugadores.find(j => j.id === cap.jugador_id)
        return jug ? `${jug.nombres} ${jug.apellidos}` : ''
      }

      // ✅ FIX: helper extraído (elimina duplicación filasLocal/filasVisitante)
      const construirFilas = (jugadores, planilla) =>
        jugadores
          .filter(j => planilla.some(pl => pl.jugador_id === j.id))
          .map(j => {
            const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
            const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
            const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
            return [
              getDorsal(j.id),
              sanitize(`${j.apellidos} ${j.nombres}`),
              goles > 0 ? goles.toString() : '',
              amarillas > 0 ? 'X' : '',
              rojas > 0 ? 'X' : ''
            ]
          })

      // ✅ FIX: config de tabla extraída (elimina duplicación autoTable)
      const configTablaJugadores = (startY, body) => ({
        startY,
        head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']],
        body, theme: 'grid',
        headStyles: { fillColor: [200, 200, 200], textColor: [0, 0, 0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: {
          0: { cellWidth: 15, halign: 'center' },
          1: { cellWidth: 110 },
          2: { cellWidth: 15, halign: 'center' },
          3: { cellWidth: 15, halign: 'center' },
          4: { cellWidth: 15, halign: 'center' }
        }
      })

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
      doc.text(`HORA: ${p.hora?.slice(0, 5) || '________'}`, 15, 51)

      doc.setFont('helvetica', 'bold')
      doc.text(`CLUB: ${sanitize(equipoLocal?.nombre?.toUpperCase())}`, 15, 60)
      doc.text(`CATEGORIA: ${sanitize(equipoLocal?.categoria?.toUpperCase())}`, 100, 60)

      // ✅ FIX: usa helpers extraídos
      autoTable(doc, configTablaJugadores(63, construirFilas(jugadoresLocal, planillaLocal)))

      let finalY = doc.lastAutoTable.finalY + 10
      doc.setFont('helvetica', 'bold')
      doc.text(`CLUB: ${sanitize(equipoVisitante?.nombre?.toUpperCase())}`, 15, finalY)
      doc.text(`CATEGORIA: ${sanitize(equipoVisitante?.categoria?.toUpperCase())}`, 100, finalY)

      autoTable(doc, configTablaJugadores(finalY + 3, construirFilas(jugadoresVisitante, planillaVisitante)))

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

      // ================= NOVEDADES =================
      let novedadesY = doc.lastAutoTable.finalY + 10
      doc.setFont('helvetica', 'bold')
      doc.text('NOVEDADES:', 15, novedadesY)
      doc.setFont('helvetica', 'normal')
      const textoNovedades = sanitize(p.observaciones) || 'Sin novedades registradas.'
      const lineasNovedades = doc.splitTextToSize(textoNovedades, 175)
      doc.text(lineasNovedades, 15, novedadesY + 5)

      // ================= PUNTO 5: FIRMAS CON NOMBRES =================
      // ✅ FIX Punto 5: nombres bajo cada firma + bloque bajado 3 cm
      const firmasY = novedadesY + 5 + (lineasNovedades.length * 4) + 30

      const capitanLocal = getNombreCapitan(p.equipo_local_id)
      const capitanVisitante = getNombreCapitan(p.equipo_visitante_id)
      const nombreVocal = sanitize(p.vocal_nombre) || '____________________'
      const nombreArbitro = sanitize(p.arbitro_nombre) || '____________________'

      const firma = (x, y, etiqueta, nombre) => {
        doc.line(x, y, x + 55, y)
        doc.setFontSize(8)
        doc.setFont('helvetica', 'bold')
        doc.text(etiqueta, x + 27.5, y + 4, { align: 'center' })
        doc.setFont('helvetica', 'normal')
        doc.text(nombre || '____________________', x + 27.5, y + 8, { align: 'center', maxWidth: 55 })
      }

      firma(15, firmasY, `CAPITÁN ${sanitize(equipoLocal?.nombre) || 'LOCAL'}`, capitanLocal)
      firma(75, firmasY, `CAPITÁN ${sanitize(equipoVisitante?.nombre) || 'VISITANTE'}`, capitanVisitante)
      firma(135, firmasY, 'VOCAL DE TURNO', nombreVocal)
      firma(15, firmasY + 25, 'ÁRBITRO', nombreArbitro)

      // ✅ FIX: detecta formato real de la firma (PNG/JPEG) en vez de forzar PNG
      const firmaDe = (tipo) => firmas.find(f => f.tipo_firmante === tipo)?.firma_base64
      const pintarFirmaDigital = (tipo, x, y) => {
        const b64 = firmaDe(tipo)
        if (!b64) return
        try {
          const formato = b64.startsWith('data:image/jpeg') ? 'JPEG' : 'PNG'
          doc.addImage(b64, formato, x + 5, y - 12, 45, 12)
        } catch (e) {
          console.warn('Firma inválida', e)
        }
      }
      pintarFirmaDigital('local', 15, firmasY)
      pintarFirmaDigital('visitante', 75, firmasY)
      pintarFirmaDigital('vocal', 135, firmasY)
      pintarFirmaDigital('arbitro', 15, firmasY + 25)

      doc.save(`acta_${sanitize(equipoLocal?.nombre)}_vs_${sanitize(equipoVisitante?.nombre)}.pdf`)
    } catch (err) {
      console.error(err)
      toast.error('Error al generar el PDF')
    }
  }

    // ================= HELPERS DE RENDER =================
  function renderJugador(jugador, equipoId) {
    const plan = equipoId === partido?.equipo_local_id ? planillaLocal : planillaVisitante
    const insc = plan.find(pl => pl.jugador_id === jugador.id)
    const dorsal = insc?.dorsal || '-'
    const titular = esTitular(jugador.id, equipoId)
    const capitan = esCapitan(jugador.id, equipoId)
    const { habilitado, motivo } = evaluarJugador(jugador.id)
    const goles = getEventosJugador(jugador.id).filter(e => e.tipo === 'gol').length
    const amarillas = getEventosJugador(jugador.id).filter(e => e.tipo === 'amarilla').length
    const rojas = getEventosJugador(jugador.id).filter(e => e.tipo === 'roja').length
    // ✅ FIX: usa getFaltasJugadorPeriodo (coherente con el marcador, que filtra por período)
    const faltasJugador = getFaltasJugadorPeriodo(jugador.id)
    const seleccionado = jugadorSeleccionado?.jugador?.id === jugador.id

    return (
      <div
        key={jugador.id}
        className={`flex items-center gap-2 p-2 rounded border cursor-pointer transition
          ${seleccionado ? 'border-blue-500 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'}
          ${!habilitado ? 'opacity-60' : ''}`}
        onClick={() => {
          if (!habilitado) return toast.error(motivo)
          setJugadorSeleccionado(seleccionado ? null : { jugador, equipoId })
        }}
      >
        <button
          onClick={(e) => { e.stopPropagation(); abrirModalDorsal(jugador.id, equipoId, `${jugador.apellidos} ${jugador.nombres}`) }}
          className="w-8 h-8 flex items-center justify-center bg-gray-800 text-white rounded font-bold text-sm"
          title="Cambiar dorsal"
        >
          {dorsal}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-medium truncate flex items-center gap-1">
            {jugador.apellidos} {jugador.nombres}
            {capitan && <span className="text-yellow-600 text-xs">(C)</span>}
            {titular && <span className="text-green-600 text-xs">●</span>}
          </div>
          <div className="text-xs text-gray-500 flex gap-2">
            {goles > 0 && <span>⚽ {goles}</span>}
            {amarillas > 0 && <span className="text-yellow-600">🟨 {amarillas}</span>}
            {rojas > 0 && <span className="text-red-600">🟥 {rojas}</span>}
            {faltasJugador > 0 && <span className="text-orange-600">F {faltasJugador}</span>}
          </div>
        </div>
        {rolUsuario === 'vocal' && !partido?.jugado && (
          <div className="flex gap-1" onClick={(e) => e.stopPropagation()}>
            <button
              onClick={() => toggleTitular(jugador.id, equipoId)}
              className={`p-1 rounded ${titular ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}
              title="Titular"
            >
              <User size={14} />
            </button>
            <button
              onClick={() => marcarCapitan(jugador.id, equipoId)}
              className={`p-1 rounded ${capitan ? 'bg-yellow-100 text-yellow-700' : 'bg-gray-100 text-gray-500'}`}
              title="Capitán"
            >
              <Shield size={14} />
            </button>
          </div>
        )}
      </div>
    )
  }

  // ✅ FIX: selector de causa para tarjetas (usa CAUSAS_COMUNES)
  function pedirCausaTarjeta() {
    const lista = CAUSAS_COMUNES.map((c, i) => `${i + 1}. ${c}`).join('\n')
    const resp = window.prompt(
      `Causa de la tarjeta:\n${lista}\n\nEscribe el número o la causa:`,
      '1'
    )
    if (!resp) return null
    const idx = parseInt(resp, 10) - 1
    return CAUSAS_COMUNES[idx] || resp.trim()
  }

  function handleTarjeta(tipo) {
    const causa = pedirCausaTarjeta()
    if (!causa) return
    registrarEvento(tipo, causa)
  }

  if (cargando) {
    return (
      <div className="flex items-center justify-center h-screen">
        <div className="animate-spin rounded-full h-12 w-12 border-b-2 border-blue-600" />
      </div>
    )
  }

  if (!partido) {
    return (
      <div className="p-6 text-center">
        <p>Partido no encontrado</p>
        <button onClick={() => navigate(-1)} className="mt-4 text-blue-600">Volver</button>
      </div>
    )
  }

  // ================= RENDER PRINCIPAL =================
  return (
    <div className="min-h-screen bg-gray-100 pb-32">
      {/* Header */}
      <div className="bg-white shadow p-4 flex items-center justify-between sticky top-0 z-20">
        <button onClick={() => navigate(-1)} className="p-2 hover:bg-gray-100 rounded">
          <ArrowLeft size={20} />
        </button>
        <div className="text-center">
          <div className="text-xs text-gray-500 flex items-center justify-center gap-1">
            <MapPin size={12} /> Pujilí
            <span className="mx-1">·</span>
            <Clock size={12} /> {partido.hora?.slice(0, 5) || '--:--'}
          </div>
          <div className="text-sm font-semibold">
            {equipoLocal?.nombre} vs {equipoVisitante?.nombre}
          </div>
        </div>
        <div className="flex gap-2">
          {/* ✅ FIX Punto 6: solo admin/secretaria descargan PDF */}
          {partido.jugado && esAdmin && (
            <button
              onClick={descargarPDF}
              className="flex items-center gap-1 bg-red-600 hover:bg-red-700 text-white px-3 py-2 rounded-lg text-sm"
            >
              <Printer size={16} /> PDF
            </button>
          )}
        </div>
      </div>

      {/* Marcador + Reloj */}
      <div className="bg-white mx-4 mt-4 rounded-lg shadow p-4">
        <div className="flex items-center justify-between">
          <div className="text-center flex-1">
            <div className="text-xs text-gray-500">LOCAL</div>
            <div className="text-sm font-bold truncate">{equipoLocal?.nombre}</div>
            <div className="text-4xl font-bold text-blue-600 mt-1">{golesLocal}</div>
            <div className="text-xs text-gray-500 mt-1">Faltas: {faltasEqLocal}</div>
          </div>

          <div className="flex-1 text-center">
            <div className="text-xs text-gray-500">
              {periodoActual === 1 ? '1er Tiempo' : '2do Tiempo'}
            </div>
            <div className="text-5xl font-mono font-bold my-2">{formatearTiempo(tiempoRestante)}</div>
            <div className="flex justify-center gap-2">
              <button
                onClick={toggleReloj}
                disabled={partido.jugado}
                className={`p-2 rounded-full text-white ${relojCorriendo ? 'bg-red-600' : 'bg-green-600'} disabled:opacity-50`}
              >
                {relojCorriendo ? <Pause size={18} /> : <Play size={18} />}
              </button>
              <button
                onClick={reiniciarReloj}
                disabled={partido.jugado}
                className="p-2 rounded-full bg-gray-600 text-white disabled:opacity-50"
              >
                <RotateCcw size={18} />
              </button>
              {periodoActual === 1 && (
                <button
                  onClick={pasarSegundoTiempo}
                  disabled={partido.jugado}
                  className="px-3 py-1 rounded bg-blue-600 text-white text-xs disabled:opacity-50"
                >
                  2do T.
                </button>
              )}
            </div>
          </div>

          <div className="text-center flex-1">
            <div className="text-xs text-gray-500">VISITANTE</div>
            <div className="text-sm font-bold truncate">{equipoVisitante?.nombre}</div>
            <div className="text-4xl font-bold text-red-600 mt-1">{golesVisitante}</div>
            <div className="text-xs text-gray-500 mt-1">Faltas: {faltasEqVisitante}</div>
          </div>
        </div>
      </div>

      {/* ✅ FIX Punto 2: Deudas de tarjetas con botón de cobro */}
      {deudasTarjetas.length > 0 && (
        <div className="mx-4 mt-4 p-3 bg-yellow-50 border border-yellow-300 rounded-lg">
          <div className="flex items-center gap-2 mb-2 text-yellow-800 font-semibold">
            <AlertTriangle size={16} /> Deudas de tarjetas pendientes
          </div>
          <ul className="space-y-2">
            {deudasTarjetas.map((d) => {
              const key = d.id ?? d.jugador_id
              const ocupado = cobrandoTarjeta === key
              return (
                <li key={key} className="flex items-center justify-between text-sm">
                  <span>
                    {d.jugador_nombre || 'Jugador'} — ${d.monto ?? d.valor ?? '?'} ({d.tipo || 'tarjeta'})
                  </span>
                  <button
                    onClick={() => cobrarTarjeta(d)}
                    disabled={ocupado}
                    className="flex items-center gap-1 bg-green-600 hover:bg-green-700 disabled:opacity-50 text-white px-3 py-1 rounded text-xs"
                  >
                    <DollarSign size={14} /> {ocupado ? 'Cobrando…' : 'Cobrar'}
                  </button>
                </li>
              )
            })}
          </ul>
        </div>
      )}

      {/* Jugadores */}
      <div className="mx-4 mt-4 grid grid-cols-1 md:grid-cols-2 gap-4">
        <div className="bg-white rounded-lg shadow p-3">
          <h3 className="font-semibold text-sm mb-2 text-blue-600">{equipoLocal?.nombre}</h3>
          <div className="space-y-1">
            {jugadoresLocal.map(j => renderJugador(j, partido.equipo_local_id))}
          </div>
        </div>
        <div className="bg-white rounded-lg shadow p-3">
          <h3 className="font-semibold text-sm mb-2 text-red-600">{equipoVisitante?.nombre}</h3>
          <div className="space-y-1">
            {jugadoresVisitante.map(j => renderJugador(j, partido.equipo_visitante_id))}
          </div>
        </div>
      </div>

      {/* Panel de acciones del jugador seleccionado */}
      {jugadorSeleccionado && !partido.jugado && (
        <div className="fixed bottom-0 left-0 right-0 bg-white shadow-2xl border-t p-3 z-30">
          <div className="flex items-center justify-between mb-2">
            <div className="text-sm font-semibold">
              {jugadorSeleccionado.jugador.apellidos} {jugadorSeleccionado.jugador.nombres}
            </div>
            <button onClick={() => setJugadorSeleccionado(null)} className="p-1">
              <X size={18} />
            </button>
          </div>
          <div className="grid grid-cols-4 gap-2">
            <button
              onClick={() => registrarEvento('gol')}
              disabled={registrandoEvento}
              className="bg-green-600 text-white p-2 rounded text-xs disabled:opacity-50"
            >
              ⚽ Gol
            </button>
            <button
              onClick={() => handleTarjeta('amarilla')}
              disabled={registrandoEvento}
              className="bg-yellow-500 text-white p-2 rounded text-xs disabled:opacity-50"
            >
              🟨 Amarilla
            </button>
            <button
              onClick={() => handleTarjeta('roja')}
              disabled={registrandoEvento}
              className="bg-red-600 text-white p-2 rounded text-xs disabled:opacity-50"
            >
              🟥 Roja
            </button>
            <button
              onClick={registrarFalta}
              disabled={registrandoFalta}
              className="bg-orange-600 text-white p-2 rounded text-xs disabled:opacity-50"
            >
              <Ban size={14} className="inline" /> Falta
            </button>
          </div>
        </div>
      )}

      {/* Botón finalizar */}
      {!partido.jugado && (rolUsuario === 'vocal' || esAdmin) && (
        <div className="fixed bottom-4 right-4 z-40">
          <button
            onClick={iniciarCierre}
            disabled={finalizando}
            className="flex items-center gap-2 bg-gray-900 hover:bg-black text-white px-4 py-3 rounded-full shadow-lg disabled:opacity-50"
          >
            <Lock size={18} /> {finalizando ? 'Finalizando…' : 'Finalizar Acta'}
          </button>
        </div>
      )}

      {/* Modal Dorsal */}
      {modalDorsal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-40 p-4">
          <div className="bg-white rounded-lg p-5 w-full max-w-sm">
            <h3 className="font-semibold mb-1">Cambiar dorsal</h3>
            <p className="text-sm text-gray-600 mb-3">{modalDorsal.jugadorNombre}</p>
            <input
              type="number"
              min="1"
              max="99"
              value={dorsalInput}
              onChange={(e) => setDorsalInput(e.target.value)}
              className="w-full border rounded px-3 py-2 mb-3"
              placeholder="1-99"
            />
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setModalDorsal(null)}
                disabled={guardandoDorsal}
                className="px-3 py-2 rounded border"
              >
                Cancelar
              </button>
              <button
                onClick={guardarDorsal}
                disabled={guardandoDorsal}
                className="px-3 py-2 rounded bg-blue-600 text-white disabled:opacity-50"
              >
                {guardandoDorsal ? 'Guardando…' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Modal Firma */}
      {pasoFirma && (
        <FirmaModal
          tipo={pasoFirma}
          onGuardar={handleGuardarFirma}
          onCancelar={() => setPasoFirma(null)}
        />
      )}
    </div>
  )
}
