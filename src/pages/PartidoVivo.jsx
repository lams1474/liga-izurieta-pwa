import { useState, useEffect } from 'react'
import { useParams, useNavigate } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { db } from '../lib/db'
import toast from 'react-hot-toast'
import { ArrowLeft, Play, Pause, RotateCcw, Printer, Pencil, DollarSign, X, UserCheck } from 'lucide-react'
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
  const [esAdmin, setEsAdmin] = useState(false)

  const [jugadoresLocal, setJugadoresLocal] = useState([])
  const [jugadoresVisitante, setJugadoresVisitante] = useState([])
  const [eventos, setEventos] = useState([])
  const [faltas, setFaltas] = useState([])
  const [planillaLocal, setPlanillaLocal] = useState([])
  const [planillaVisitante, setPlanillaVisitante] = useState([])
  const [carnets, setCarnets] = useState([])
  const [firmas, setFirmas] = useState([])
  const [deudasTarjetas, setDeudasTarjetas] = useState([])

  const [jugadorSeleccionado, setJugadorSeleccionado] = useState(null)
  const [modalTarjeta, setModalTarjeta] = useState(null) // { tipo: 'amarilla' | 'roja' }
  const [causaTarjeta, setCausaTarjeta] = useState('')
  
  const [finalizando, setFinalizando] = useState(false)
  const [pasoFirma, setPasoFirma] = useState(null)
  const [firmasTemporales, setFirmasTemporales] = useState([])
  const [novedadesGenerales, setNovedadesGenerales] = useState('')

  const [periodoActual, setPeriodoActual] = useState(1)
  const [tiempoRestante, setTiempoRestante] = useState(22 * 60)
  const [relojCorriendo, setRelojCorriendo] = useState(false)

  const [modalDorsal, setModalDorsal] = useState(null)
  const [dorsalInput, setDorsalInput] = useState('')
  const [guardandoDorsal, setGuardandoDorsal] = useState(false)

  const [modalCobro, setModalCobro] = useState(null)
  const [montoCobro, setMontoCobro] = useState('')
  const [cobrando, setCobrando] = useState(false)

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
          .select(`fecha_id, vocal_id, arbitro_id, fecha:fechas(fecha_inicio), arbitro:arbitros(nombres, apellidos), vocal:usuarios(nombres, apellidos)`)
          .eq('id', id).single()

        setPartido(prev => ({
          ...prev,
          fecha_inicio: pData?.fecha?.fecha_inicio || null,
          vocal_nombre: pData?.vocal ? `${pData.vocal.nombres} ${pData.vocal.apellidos}` : null,
          arbitro_nombre: pData?.arbitro ? `${pData.arbitro.nombres} ${pData.arbitro.apellidos}` : null
        }))

        if (p.vocal_id === userId) setRolUsuario('vocal')
        else setRolUsuario('arbitro')

        const { data: usuarioData } = await supabase.from('usuarios').select('rol').eq('id', userId).single()
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

        setJugadoresLocal(await db.jugadores.bulkGet(planLoc.map(pl => pl.jugador_id)).then(j => j.filter(Boolean)))
        setJugadoresVisitante(await db.jugadores.bulkGet(planVis.map(pl => pl.jugador_id)).then(j => j.filter(Boolean)))

        setEventos(await db.eventos.where('partido_id').equals(id).toArray())
        setFaltas(await db.faltas.where('partido_id').equals(id).toArray())
        setCarnets(await db.carnets.toArray())
        setFirmas(await db.firmas.where('partido_id').equals(id).toArray())

        if (navigator.onLine) {
          const { data: deudas } = await supabase.rpc('obtener_deudas_tarjetas_partido', { p_partido_id: id })
          setDeudasTarjetas(deudas || [])
        }
      } catch (err) {
        console.error(err)
      } finally {
        setCargando(false)
      }
    }
    cargarDatosOffline()
  }, [id])

  function jugadorBloqueado(jugadorId) {
    const carnet = carnets.find(c => c.jugador_id === jugadorId)
    return {
      bloqueado: carnet && carnet.valido === false,
      motivo: carnet?.motivo_bloqueo || null
    }
  }

    async function toggleTitular(jugadorId, equipoId) {
    if (partido.jugado) return toast.error('El acta ya está finalizada')
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
    if (navigator.onLine) {
      await supabase.from('planilla_partido').update({ es_titular: nuevoEstado }).eq('id', insc.id)
    }
  }

  async function registrarEvento(tipo) {
    if (!jugadorSeleccionado || partido.jugado) return
    const { jugador, equipoId } = jugadorSeleccionado
    const bloq = jugadorBloqueado(jugador.id)
    if (bloq.bloqueado) return toast.error(`Jugador bloqueado: ${bloq.motivo}`)

    try {
      await db.eventos.add({
        partido_id: id, jugador_id: jugador.id, equipo_id: equipoId, tipo,
        minuto: Math.floor((22 * 60 - tiempoRestante) / 60) + (periodoActual === 1 ? 0 : 22),
        periodo: periodoActual, sync_status: 'pending'
      })
      setEventos(await db.eventos.where('partido_id').equals(id).toArray())
      setJugadorSeleccionado(null)
      toast.success(tipo === 'gol' ? '¡GOL!' : 'Evento registrado')
    } catch {
      toast.error('Error al registrar')
    }
  }

  async function registrarFalta() {
    if (!jugadorSeleccionado || partido.jugado) return
    const { jugador, equipoId } = jugadorSeleccionado
    const bloq = jugadorBloqueado(jugador.id)
    if (bloq.bloqueado) return toast.error(`Jugador bloqueado: ${bloq.motivo}`)

    const faltasJugador = faltas.filter(f => f.jugador_id === jugador.id && f.periodo === periodoActual && f.tipo === 'personal')
    if (faltasJugador.length >= 5) return toast.error('Límite de 5 faltas alcanzado')

    try {
      await db.faltas.add({
        partido_id: id, jugador_id: jugador.id, equipo_id: equipoId, tipo: 'personal',
        minuto: Math.floor((22 * 60 - tiempoRestante) / 60) + (periodoActual === 1 ? 0 : 22),
        periodo: periodoActual, sync_status: 'pending'
      })
      
      const nuevasFaltas = await db.faltas.where('partido_id').equals(id).toArray()
      setFaltas(nuevasFaltas)
      setJugadorSeleccionado(null)

      const faltasEquipo = nuevasFaltas.filter(f => f.equipo_id === equipoId && f.periodo === periodoActual && f.tipo === 'personal').length
      if (faltasEquipo >= 6) toast.error(`¡Equipo acumuló ${faltasEquipo} faltas! Tiro de castigo a 9m.`, { duration: 5000 })
      else toast.success('Falta registrada')
    } catch {
      toast.error('Error al registrar falta')
    }
  }

  // --- TARJETAS (Abre modal para causa) ---
  function abrirModalTarjeta(tipo) {
    if (partido.jugado) return toast.error('Acta finalizada')
    setCausaTarjeta('')
    setModalTarjeta({ tipo })
  }

  async function confirmarTarjeta() {
    if (!modalTarjeta || !jugadorSeleccionado) return
    const { jugador, equipoId } = jugadorSeleccionado
    const { tipo } = modalTarjeta

    try {
      await db.faltas.add({
        partido_id: id, jugador_id: jugador.id, equipo_id: equipoId, tipo: tipo,
        minuto: Math.floor((22 * 60 - tiempoRestante) / 60) + (periodoActual === 1 ? 0 : 22),
        periodo: periodoActual, causa: causaTarjeta || 'Sin causa especificada', sync_status: 'pending'
      })
      setFaltas(await db.faltas.where('partido_id').equals(id).toArray())
      setJugadorSeleccionado(null)
      setModalTarjeta(null)
      toast.success(`Tarjeta ${tipo} registrada`)
    } catch {
      toast.error('Error al registrar tarjeta')
    }
  }

  // --- DORSAL ---
  function abrirModalDorsal(jugadorId, equipoId, jugadorNombre, dorsalActual) {
    setDorsalInput(dorsalActual ? String(dorsalActual) : '')
    setModalDorsal({ jugadorId, equipoId, jugadorNombre })
  }

  async function guardarDorsal() {
    const num = parseInt(dorsalInput, 10)
    if (!num || num < 1 || num > 99) return toast.error('Dorsal inválido')
    const plan = modalDorsal.equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    if (plan.find(pl => pl.dorsal === num && pl.jugador_id !== modalDorsal.jugadorId)) return toast.error('Dorsal en uso')

    setGuardandoDorsal(true)
    try {
      const insc = plan.find(pl => pl.jugador_id === modalDorsal.jugadorId)
      await db.planilla.update(insc.id, { dorsal: num, sync_status: 'pending' })
      if (modalDorsal.equipoId === partido.equipo_local_id) {
        setPlanillaLocal(prev => prev.map(p => p.jugador_id === modalDorsal.jugadorId ? { ...p, dorsal: num } : p))
      } else {
        setPlanillaVisitante(prev => prev.map(p => p.jugador_id === modalDorsal.jugadorId ? { ...p, dorsal: num } : p))
      }
      if (navigator.onLine) {
        await supabase.from('planilla_partido').update({ dorsal: num }).eq('id', insc.id)
        await db.planilla.update(insc.id, { sync_status: 'synced' })
      }
      setModalDorsal(null); toast.success('Dorsal actualizado')
    } catch {
      toast.error('Error al guardar dorsal')
    } finally { setGuardandoDorsal(false) }
  }

  // --- CAPITAN ---
  async function marcarCapitan(jugadorId, equipoId) {
    if (partido.jugado) return toast.error('Acta finalizada')
    if (rolUsuario !== 'vocal') return toast.error('Solo el vocal designa capitán')
    const plan = equipoId === partido.equipo_local_id ? planillaLocal : planillaVisitante
    const yaEsCapitan = plan.find(pl => pl.jugador_id === jugadorId)?.es_capitan

    for (const pl of plan) {
      if (pl.es_capitan && pl.jugador_id !== jugadorId) {
        await db.planilla.update(pl.id, { es_capitan: false, sync_status: 'pending' })
      }
    }
    const insc = plan.find(pl => pl.jugador_id === jugadorId)
    if (insc) {
      await db.planilla.update(insc.id, { es_capitan: !yaEsCapitan, sync_status: 'pending' })
    }

    if (equipoId === partido.equipo_local_id) {
      setPlanillaLocal(prev => prev.map(p => ({ ...p, es_capitan: p.jugador_id === jugadorId ? !yaEsCapitan : false })))
    } else {
      setPlanillaVisitante(prev => prev.map(p => ({ ...p, es_capitan: p.jugador_id === jugadorId ? !yaEsCapitan : false })))
    }
    toast.success(yaEsCapitan ? 'Capitanía removida' : 'Capitán designado')
  }

  // --- COBRO ---
  async function confirmarCobro() {
    const monto = parseFloat(montoCobro)
    if (!monto || monto <= 0) return toast.error('Monto inválido')
    setCobrando(true)
    try {
      const { error } = await supabase.rpc('registrar_pago_sancion_jugador', { p_deuda_id: modalCobro.deuda_id, p_monto: monto })
      if (error) throw error
      toast.success('Pago registrado')
      setModalCobro(null)
      const { data } = await supabase.rpc('obtener_deudas_tarjetas_partido', { p_partido_id: id })
      setDeudasTarjetas(data || [])
    } catch {
      toast.error('Error al cobrar')
    } finally { setCobrando(false) }
  }

  // --- FIRMAS ---
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
          partido_id: id, tipo_firmante: f.tipo, firma_base64: f.firma,
          de_acuerdo: f.deAcuerdo, motivo_desacuerdo: f.motivo, sync_status: 'pending'
        })
      }

      await db.partidos.update(id, { jugado: true, observaciones: textoNovedades, sync_status: 'pending' })
      setPartido(prev => ({ ...prev, jugado: true, observaciones: textoNovedades }))

      if (navigator.onLine) {
        try { await sincronizarPartido(id) } catch (e) { console.error(e) }
      }
      toast.success('Acta finalizada')
    } catch {
      toast.error('Error al finalizar el acta')
    } finally {
      setFinalizando(false)
    }
  }

  // ================= PDF DE LA PWA =================
  function descargarPDF() {
    try {
      const doc = new jsPDF()
      const p = partido
      const sanitize = (s) => {
        if (!s) return '';
        return String(s).normalize("NFD").replace(/[\u0300-\u036f]/g, "").replace(/ñ/g, 'n').trim();
      }

      const dibujarEncabezado = (pagina) => {
        doc.setFont("helvetica", "bold"); doc.setFontSize(14)
        doc.text('LIGA DEPORTIVA BARRIAL JOSE I. IZURIETA', 105, 15, { align: 'center' })
        doc.setFontSize(9); doc.setFont("helvetica", "normal")
        doc.text('PUJILI - ECUADOR', 105, 20, { align: 'center' })
        doc.text('FUNDADA EL 09 DE MARZO DEL 2013', 20, 26)
        doc.text('ACUERDO MUNICIPAL NO. 034-GADMP-2013', 130, 26)
        doc.line(15, 28, 195, 28)
        doc.setFont("helvetica", "bold"); doc.setFontSize(12)
        doc.text(`ACTA DE JUEGO - PAGINA ${pagina}`, 105, 35, { align: 'center' })
      }

      dibujarEncabezado(1)
      doc.setFontSize(9); doc.setFont("helvetica", "normal")
      
      const fechaStr = p.fecha_inicio ? new Date(p.fecha_inicio + 'T00:00:00').toLocaleDateString('es-EC') : '--/--/----'
      doc.text(`VOCAL DE TURNO: ${sanitize(p.vocal_nombre) || '____________________'}`, 15, 45)
      doc.text('CIUDAD: Pujili', 100, 45)
      doc.text(`FECHA: ${fechaStr}`, 145, 45)
      doc.text(`HORA: ${p.hora?.slice(0,5) || '________'}`, 15, 51)
      doc.text(`ARBITRO: ${sanitize(p.arbitro_nombre) || '____________________'}`, 100, 51)

      doc.setFont("helvetica", "bold")
      doc.text(`CLUB: ${sanitize(equipoLocal?.nombre?.toUpperCase())}`, 15, 60)
      doc.text(`CATEGORIA: ${sanitize(equipoLocal?.categoria?.toUpperCase())}`, 100, 60)

      const filasLocal = jugadoresLocal.filter(j => planillaLocal.some(pl => pl.jugador_id === j.id)).map(j => {
        const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
        const amarillas = faltas.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
        const rojas = faltas.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
        return [planillaLocal.find(pl => pl.jugador_id === j.id)?.dorsal || '-', sanitize(`${j.apellidos} ${j.nombres}`), goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
      })

      autoTable(doc, {
        startY: 63, head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']], body: filasLocal, theme: 'grid',
        headStyles: { fillColor: [200,200,200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5, font: 'helvetica' },
        columnStyles: { 0:{cellWidth:15,halign:'center'}, 1:{cellWidth:110}, 2:{cellWidth:15,halign:'center'}, 3:{cellWidth:15,halign:'center'}, 4:{cellWidth:15,halign:'center'} }
      })

      let finalY = doc.lastAutoTable.finalY + 10
      doc.setFont("helvetica", "bold")
      doc.text(`CLUB: ${sanitize(equipoVisitante?.nombre?.toUpperCase())}`, 15, finalY)
      doc.text(`CATEGORIA: ${sanitize(equipoVisitante?.categoria?.toUpperCase())}`, 100, finalY)

      const filasVisitante = jugadoresVisitante.filter(j => planillaVisitante.some(pl => pl.jugador_id === j.id)).map(j => {
        const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
        const amarillas = faltas.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
        const rojas = faltas.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
        return [planillaVisitante.find(pl => pl.jugador_id === j.id)?.dorsal || '-', sanitize(`${j.apellidos} ${j.nombres}`), goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
      })

      autoTable(doc, {
        startY: finalY + 3, head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']], body: filasVisitante, theme: 'grid',
        headStyles: { fillColor: [200,200,200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5, font: 'helvetica' },
        columnStyles: { 0:{cellWidth:15,halign:'center'}, 1:{cellWidth:110}, 2:{cellWidth:15,halign:'center'}, 3:{cellWidth:15,halign:'center'}, 4:{cellWidth:15,halign:'center'} }
      })

      doc.addPage(); dibujarEncabezado(2); doc.setFontSize(9); doc.setFont("helvetica", "normal")
      
      let nextY = 45
      const tarjetasLocal = faltas.filter(f => f.equipo_id === p.equipo_local_id && (f.tipo === 'amarilla' || f.tipo === 'roja'))
      const tarjetasVisitante = faltas.filter(f => f.equipo_id === p.equipo_visitante_id && (f.tipo === 'amarilla' || f.tipo === 'roja'))

      const dibujarTarjetas = (startY, nombreClub, tarjetas) => {
        doc.setFont("helvetica", "bold")
        doc.text(`TARJETAS DEL CLUB: ${sanitize(nombreClub?.toUpperCase())}`, 15, startY)
        let y = startY + 6
        doc.setFont("helvetica", "normal")
        if(tarjetas.length === 0) {
           doc.text('Sin tarjetas registradas.', 15, y)
           return y + 10
        }
        tarjetas.forEach((t, i) => {
           const jug = [...jugadoresLocal, ...jugadoresVisitante].find(j => j.id === t.jugador_id)
           const dorsal = (t.equipo_id === p.equipo_local_id ? planillaLocal : planillaVisitante).find(pl => pl.jugador_id === t.jugador_id)?.dorsal || '-'
           doc.text(`MIN ${t.minuto}: ${sanitize(jug?.apellidos)} ${sanitize(jug?.nombres)} (${t.tipo.toUpperCase()}) - DORSAL ${dorsal} - CAUSA: ${sanitize(t.causa || 'No especificada')}`, 15, y + (i*6))
        })
        return y + (tarjetas.length * 6) + 10
      }

      nextY = dibujarTarjetas(nextY, equipoLocal?.nombre, tarjetasLocal)
      nextY = dibujarTarjetas(nextY, equipoVisitante?.nombre, tarjetasVisitante)

      doc.setFont("helvetica", "bold"); doc.text('NOVEDADES:', 15, nextY); doc.setFont("helvetica", "normal")
      const splitText = doc.splitTextToSize(sanitize(p.observaciones || 'Sin novedades.'), 175)
      doc.text(splitText, 15, nextY + 6)
      
      let lineY = nextY + 6 + (splitText.length * 5) + 10
      const firmaY = lineY + 85

      const fArbitro = firmas.find(f => f.tipo_firmante === 'arbitro')
      const fCapLocal = firmas.find(f => f.tipo_firmante === 'local')
      const fCapVisitante = firmas.find(f => f.tipo_firmante === 'visitante')
      const fVocal = firmas.find(f => f.tipo_firmante === 'vocal')

      const capLocalPlan = planillaLocal.find(pl => pl.es_capitan)
      const capVisitPlan = planillaVisitante.find(pl => pl.es_capitan)
      const nombreCapLocal = capLocalPlan ? `${jugadoresLocal.find(j => j.id === capLocalPlan.jugador_id)?.apellidos} ${jugadoresLocal.find(j => j.id === capLocalPlan.jugador_id)?.nombres}` : ''
      const nombreCapVisit = capVisitPlan ? `${jugadoresVisitante.find(j => j.id === capVisitPlan.jugador_id)?.apellidos} ${jugadoresVisitante.find(j => j.id === capVisitPlan.jugador_id)?.nombres}` : ''

      const drawImageSafely = (base64, x, y, w, h) => {
        try { 
          if (base64) {
            const cleanB64 = base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '').replace(/\s/g, '');
            doc.addImage(cleanB64, "PNG", x, y, w, h, undefined, 'FAST') 
          }
        } catch (e) { console.error("Error dibujando firma:", e) }
      }

      const xPositions = [15, 65, 115, 165]
      const firmantes = [
        { nombre: `CAPITAN ${sanitize(equipoLocal?.nombre?.toUpperCase())}`, firma: fCapLocal, persona: nombreCapLocal },
        { nombre: `CAPITAN ${sanitize(equipoVisitante?.nombre?.toUpperCase())}`, firma: fCapVisitante, persona: nombreCapVisit },
        { nombre: 'ARBITRO', firma: fArbitro, persona: sanitize(p.arbitro_nombre) },
        { nombre: 'VOCAL', firma: fVocal, persona: sanitize(p.vocal_nombre) }
      ]

      firmantes.forEach((item, index) => {
        const x = xPositions[index]
        drawImageSafely(item.firma?.firma_base64, x, firmaY - 20, 30, 15)
        doc.line(x, firmaY, x + 30, firmaY)
        doc.setFontSize(7); doc.setFont("helvetica", "bold")
        doc.text(item.nombre, x + 15, firmaY + 4, { align: 'center' })
        if (item.persona) { doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.text(sanitize(item.persona), x + 15, firmaY + 8, { align: 'center' }) }
      })

      const pdfBlob = doc.output('blob')
      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a')
      a.href = url; a.download = `acta-${p.id?.slice(0,8) || 'partido'}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) { console.error('Error generando PDF:', err); toast.error('Error al generar el acta PDF') }
  }

  if (cargando) return <div className="p-8 text-center text-gray-500">Cargando...</div>

  return (
    <div className="min-h-screen bg-gray-900 text-white pb-32 font-sans">
      <header className="bg-black/50 backdrop-blur-md border-b border-gray-800 p-4 flex items-center gap-3 sticky top-0 z-10 shadow-lg">
        <button onClick={() => navigate('/partidos')} className="p-2 bg-gray-800 rounded-lg hover:bg-gray-700 transition-colors"><ArrowLeft size={20} className="text-liga-amarillo" /></button>
        <div className="flex-1">
          <p className="text-xs text-liga-amarillo font-bold uppercase tracking-wider">PARTIDO EN VIVO</p>
          <h1 className="font-black text-lg">{equipoLocal?.nombre} vs {equipoVisitante?.nombre}</h1>
        </div>
      </header>

      <main className="p-4 max-w-2xl mx-auto space-y-4">
        
        {/* MARCADOR FUTURISTA */}
        <div className="bg-gray-800 rounded-2xl shadow-2xl p-6 border border-blue-500/30 text-center relative overflow-hidden">
          <div className="absolute top-0 left-0 w-full h-1 bg-gradient-to-r from-blue-500 via-purple-500 to-liga-amarillo"></div>
          <div className="text-5xl font-black text-transparent bg-clip-text bg-gradient-to-r from-blue-400 to-liga-amarillo mb-2">
            {Math.floor(tiempoRestante/60)}:{(tiempoRestante%60).toString().padStart(2,'0')}
          </div>
          <p className="text-sm text-gray-400 font-semibold mb-4">Periodo {periodoActual}</p>
          <div className="flex justify-center gap-3">
             <button onClick={() => setRelojCorriendo(!relojCorriendo)} className={`p-3 rounded-full text-white shadow-lg transition-all ${relojCorriendo ? 'bg-red-500 hover:bg-red-600 shadow-red-500/50' : 'bg-green-500 hover:bg-green-600 shadow-green-500/50'}`}>{relojCorriendo ? <Pause size={24}/> : <Play size={24}/>}</button>
             <button onClick={() => { setRelojCorriendo(false); setTiempoRestante(22*60); setPeriodoActual(1) }} className="p-3 rounded-full bg-gray-700 text-white hover:bg-gray-600 transition-all"><RotateCcw size={24}/></button>
             {periodoActual === 1 && <button onClick={() => { setRelojCorriendo(false); setTiempoRestante(22*60); setPeriodoActual(2) }} className="text-xs bg-liga-amarillo text-black font-bold px-4 py-2 rounded-lg shadow-lg hover:bg-yellow-400 transition-colors">Iniciar 2do Tiempo</button>}
          </div>
        </div>

        {/* LISTA DE JUGADORES */}
        {[equipoLocal, equipoVisitante].map((eq, idx) => {
          if (!eq) return null
          const esLocal = idx === 0
          const jugadores = esLocal ? jugadoresLocal : jugadoresVisitante
          const planilla = esLocal ? planillaLocal : planillaVisitante
          const equipoId = esLocal ? partido.equipo_local_id : partido.equipo_visitante_id
          const faltasEq = faltas.filter(f => f.equipo_id === equipoId && f.periodo === periodoActual && f.tipo === 'personal').length

          return (
            <div key={eq.id} className="bg-gray-800 rounded-2xl shadow-xl border border-gray-700 overflow-hidden mb-4">
              <div className="bg-gray-900 p-3 flex justify-between items-center border-b border-gray-700">
                <h3 className="font-bold text-sm text-blue-400">{eq.nombre}</h3>
                <span className={`text-xs font-bold px-2 py-1 rounded-md ${faltasEq >= 6 ? 'bg-red-500/20 text-red-400' : 'bg-gray-700 text-gray-300'}`}>Faltas Eq: {faltasEq}</span>
              </div>
              <div className="divide-y divide-gray-700">
                {jugadores.map(j => {
                  const insc = planilla.find(pl => pl.jugador_id === j.id)
                  const faltasJug = faltas.filter(f => f.jugador_id === j.id && f.periodo === periodoActual && f.tipo === 'personal').length
                  const golesJug = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
                  const amarillasJug = faltas.filter(f => f.jugador_id === j.id && f.tipo === 'amarilla').length
                  const rojasJug = faltas.filter(f => f.jugador_id === j.id && f.tipo === 'roja').length
                  const puedeEditar = rolUsuario === 'vocal' && !partido.jugado
                  
                  return (
                    <div key={j.id} className="flex items-center gap-2 p-3 hover:bg-gray-750 transition-colors">
                      
                      {/* BOTÓN DORSAL */}
                      <button
                        onClick={() => puedeEditar && abrirModalDorsal(j.id, equipoId, `${j.apellidos} ${j.nombres}`, insc?.dorsal)}
                        disabled={!puedeEditar}
                        className={`w-10 h-10 rounded-xl flex items-center justify-center font-black text-lg shadow-inner ${puedeEditar ? 'bg-gray-700 text-liga-amarillo hover:bg-gray-600' : 'bg-gray-800 text-gray-500'}`}
                      >
                        {insc?.dorsal || '-'}
                      </button>

                      {puedeEditar && (
                        <button onClick={() => abrirModalDorsal(j.id, equipoId, `${j.apellidos} ${j.nombres}`, insc?.dorsal)} className="p-1 text-gray-500 hover:text-blue-400">
                          <Pencil size={16} />
                        </button>
                      )}

                      {/* NOMBRE Y EVENTOS */}
                      <button
                        onClick={() => !partido.jugado && setJugadorSeleccionado({ jugador: j, equipoId })}
                        disabled={partido.jugado}
                        className="flex-1 text-left disabled:opacity-50"
                      >
                        <p className="text-sm font-bold uppercase text-gray-200">{j.apellidos} {j.nombres}</p>
                        <div className="flex gap-2 mt-1 text-xs">
                          {golesJug > 0 && <span className="text-green-400 font-bold">⚽ {golesJug}</span>}
                          {amarillasJug > 0 && <span className="text-yellow-400 font-bold">🟨 {amarillasJug}</span>}
                          {rojasJug > 0 && <span className="text-red-400 font-bold">🟥 {rojasJug}</span>}
                          {faltasJug > 0 && <span className="text-orange-400 font-bold">Faltas: {faltasJug}/5</span>}
                        </div>
                      </button>

                      {/* BOTÓN CAPITÁN */}
                      {puedeEditar && (
                        <button
                          onClick={(e) => { e.stopPropagation(); marcarCapitan(j.id, equipoId) }}
                          className={`p-2 rounded-lg ${insc?.es_capitan ? 'bg-liga-amarillo text-black' : 'bg-gray-700 text-gray-400'}`}
                        >
                          <UserCheck size={16} />
                        </button>
                      )}

                      {/* BOTÓN TITULAR/SUPLENTE */}
                      <button
                        onClick={(e) => { e.stopPropagation(); toggleTitular(j.id, equipoId) }}
                        disabled={!puedeEditar}
                        className={`text-xs px-3 py-2 rounded-lg font-bold disabled:opacity-50 ${insc?.es_titular ? 'bg-blue-600 text-white' : 'bg-gray-700 text-gray-400'}`}
                      >
                        {insc?.es_titular ? 'TIT' : 'SUP'}
                      </button>
                    </div>
                  )
                })}
              </div>
            </div>
          )
        })}

        {/* COBRO DE TARJETAS */}
        {deudasTarjetas.length > 0 && (
          <div className="bg-gray-800 rounded-2xl shadow-xl border border-gray-700 overflow-hidden mb-4">
            <div className="bg-green-900/50 p-3 border-b border-gray-700 flex items-center gap-2">
              <DollarSign size={18} className="text-green-400" />
              <h3 className="font-bold text-sm text-green-400">Cobro de Tarjetas</h3>
            </div>
            <div className="divide-y divide-gray-700">
              {deudasTarjetas.map(d => (
                <div key={d.deuda_id} className="flex justify-between items-center p-3 text-sm">
                  <div>
                    <p className="font-bold text-gray-200">{d.jugador_nombre}</p>
                    <p className="text-xs text-gray-400">{d.tipo_sancion.toUpperCase()} - ${d.monto}</p>
                  </div>
                  {d.cancelado ? (
                    <span className="text-green-500 font-bold text-xs bg-green-500/10 px-2 py-1 rounded">CANCELADO</span>
                  ) : (
                    <button onClick={() => { setMontoCobro(d.monto.toString()); setModalCobro(d) }} className="bg-green-600 hover:bg-green-500 text-white px-4 py-2 rounded-lg text-xs font-bold transition-colors">Cobrar</button>
                  )}
                </div>
              ))}
            </div>
          </div>
        )}

        {/* BOTÓN DESCARGA PDF (Solo Admin) */}
        {partido.jugado && esAdmin && (
          <button onClick={descargarPDF} className="w-full py-4 rounded-xl font-bold text-lg shadow-lg bg-blue-600 text-white hover:bg-blue-500 flex items-center justify-center gap-2 transition-colors">
            <Printer size={20} /> Descargar / Imprimir Acta PDF
          </button>
        )}
      </main>

      {/* BOTÓN FINALIZAR FLOTANTE */}
      <div className="fixed bottom-0 left-0 right-0 p-4 bg-gray-900 border-t border-gray-700 shadow-2xl z-20">
        <button onClick={iniciarCierre} disabled={partido.jugado || finalizando} className={`w-full py-4 rounded-xl font-black text-lg shadow-lg transition-all ${partido.jugado ? 'bg-gray-800 text-gray-500' : 'bg-red-600 text-white hover:bg-red-500'}`}>
          {finalizando ? 'Procesando...' : partido.jugado ? 'Acta Finalizada' : 'Finalizar Partido y Firmar Acta'}
        </button>
      </div>

      {/* MODAL JUGADOR (Eventos) */}
      {jugadorSeleccionado && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-t-3xl sm:rounded-2xl w-full max-w-sm p-5 border border-gray-700 shadow-2xl">
            <div className="flex justify-between items-center mb-4">
              <div>
                <h3 className="font-bold text-lg text-white leading-tight">{jugadorSeleccionado.jugador.apellidos} {jugadorSeleccionado.jugador.nombres}</h3>
                <p className="text-xs text-liga-amarillo font-semibold">Periodo {periodoActual}</p>
              </div>
              <button onClick={() => setJugadorSeleccionado(null)} className="p-2 bg-gray-700 rounded-full hover:bg-gray-600 text-gray-300"><X size={20}/></button>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <button onClick={() => registrarEvento('gol')} className="bg-green-600 hover:bg-green-500 text-white p-4 rounded-xl font-black text-lg shadow-lg flex flex-col items-center gap-1 transition-colors">
                <span className="text-2xl">⚽</span> Gol
              </button>
              <button onClick={() => abrirModalTarjeta('amarilla')} className="bg-yellow-500 hover:bg-yellow-400 text-black p-4 rounded-xl font-black text-lg shadow-lg flex flex-col items-center gap-1 transition-colors">
                <span className="text-2xl">🟨</span> Amarilla
              </button>
              <button onClick={() => abrirModalTarjeta('roja')} className="bg-red-600 hover:bg-red-500 text-white p-4 rounded-xl font-black text-lg shadow-lg flex flex-col items-center gap-1 transition-colors">
                <span className="text-2xl">🟥</span> Roja
              </button>
              <button onClick={registrarFalta} className="bg-orange-500 hover:bg-orange-400 text-white p-4 rounded-xl font-black text-lg shadow-lg flex flex-col items-center gap-1 transition-colors">
                <span className="text-2xl">⚠️</span> Falta
              </button>
            </div>
            
            <div className="mt-5 text-xs space-y-2 max-h-32 overflow-y-auto bg-gray-900 p-3 rounded-xl border border-gray-700">
              <p className="font-bold text-gray-400 uppercase">Historial:</p>
              {eventos.filter(e => e.jugador_id === jugadorSeleccionado.jugador.id).map(e => (
                <p key={e.id} className="text-green-400 font-semibold flex items-center gap-2"><span className="w-2 h-2 rounded-full bg-green-400"></span> GOL — min {e.minuto} (P{e.periodo})</p>
              ))}
              {faltas.filter(f => f.jugador_id === jugadorSeleccionado.jugador.id).map(f => (
                <p key={f.id} className={`font-semibold flex items-center gap-2 ${f.tipo === 'amarilla' ? 'text-yellow-400' : f.tipo === 'roja' ? 'text-red-400' : 'text-orange-400'}`}>
                  <span className={`w-2 h-2 rounded-full ${f.tipo === 'amarilla' ? 'bg-yellow-400' : f.tipo === 'roja' ? 'bg-red-400' : 'bg-orange-400'}`}></span>
                  {f.tipo.toUpperCase()} — min {f.minuto} (P{f.periodo})
                </p>
              ))}
              {eventos.filter(e => e.jugador_id === jugadorSeleccionado.jugador.id).length === 0 && faltas.filter(f => f.jugador_id === jugadorSeleccionado.jugador.id).length === 0 && (
                <p className="text-gray-500 italic">Sin eventos registrados</p>
              )}
            </div>
          </div>
        </div>
      )}

      {/* MODAL CAUSA TARJETA */}
      {modalTarjeta && (
        <div className="fixed inset-0 bg-black/80 z-[60] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-5 border border-gray-700 shadow-2xl">
            <h3 className="font-bold text-lg text-white mb-2">Causa de la Tarjeta {modalTarjeta.tipo.toUpperCase()}</h3>
            <p className="text-xs text-gray-400 mb-4">Escribe el motivo (Ej: Juego brusco, Insultos, etc.)</p>
            <input
              type="text"
              value={causaTarjeta}
              onChange={(e) => setCausaTarjeta(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white focus:outline-none focus:border-liga-amarillo"
              placeholder="Motivo..."
              autoFocus
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalTarjeta(null)} className="flex-1 py-3 border border-gray-600 text-gray-300 rounded-xl font-semibold hover:bg-gray-700 transition-colors">Cancelar</button>
              <button onClick={confirmarTarjeta} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold hover:bg-blue-500 transition-colors">Guardar</button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL DORSAL */}
      {modalDorsal && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-5 border border-gray-700 shadow-2xl">
            <h3 className="font-bold text-lg text-white mb-1">Cambiar dorsal</h3>
            <p className="text-xs text-gray-400 mb-3">{modalDorsal.jugadorNombre}</p>
            <input
              type="number" min="1" max="99" value={dorsalInput} onChange={(e) => setDorsalInput(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white text-3xl font-black text-center focus:outline-none focus:border-liga-amarillo" autoFocus
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalDorsal(null)} className="flex-1 py-3 border border-gray-600 text-gray-300 rounded-xl font-semibold hover:bg-gray-700 transition-colors">Cancelar</button>
              <button onClick={guardarDorsal} disabled={guardandoDorsal} className="flex-1 py-3 bg-blue-600 text-white rounded-xl font-bold disabled:opacity-50 hover:bg-blue-500 transition-colors">
                {guardandoDorsal ? '...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL COBRO */}
      {modalCobro && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4 backdrop-blur-sm">
          <div className="bg-gray-800 rounded-2xl w-full max-w-sm p-5 border border-gray-700 shadow-2xl">
            <h3 className="font-bold text-lg text-white mb-1">Registrar pago</h3>
            <p className="text-xs text-gray-400 mb-1">{modalCobro.jugador_nombre} — {modalCobro.tipo_sancion?.toUpperCase()}</p>
            <p className="text-xs text-liga-amarillo font-bold mb-3">Pendiente: ${(modalCobro.monto - modalCobro.monto_pagado).toFixed(2)}</p>
            <input
              type="number" min="0.01" step="0.01" value={montoCobro} onChange={(e) => setMontoCobro(e.target.value)}
              className="w-full px-4 py-3 bg-gray-900 border border-gray-600 rounded-xl text-white text-2xl font-bold text-center focus:outline-none focus:border-green-500" autoFocus
            />
            <div className="flex gap-3 mt-5">
              <button onClick={() => setModalCobro(null)} className="flex-1 py-3 border border-gray-600 text-gray-300 rounded-xl font-semibold hover:bg-gray-700 transition-colors">Cancelar</button>
              <button onClick={confirmarCobro} disabled={cobrando} className="flex-1 py-3 bg-green-600 text-white rounded-xl font-bold disabled:opacity-50 hover:bg-green-500 transition-colors">
                {cobrando ? '...' : 'Cobrar'}
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