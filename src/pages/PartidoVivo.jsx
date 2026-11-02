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
  const [deudasTarjetas, setDeudasTarjetas] = useState([])

  const [jugadorSeleccionado, setJugadorSeleccionado] = useState(null)
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
      toast.success('Evento registrado')
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
    if (faltasJugador.length >= 5) return toast.error('Límite de 5 faltas alcanzado para este jugador')

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

  // ---- MODAL DORSAL ----
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

  // ---- CAPITAN ----
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

  // ---- COBRO ----
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

  // ---- FIRMAS ----
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

  // ================= PDF =================
  async function descargarPDF() {
    try {
      const firmas = await db.firmas.where('partido_id').equals(id).toArray()
      const doc = new jsPDF()
      const p = partido
      const sanitize = (s) => s ? String(s).trim() : ''

      const getDorsal = (jugadorId) => {
        const pl = planillaLocal.find(item => item.jugador_id === jugadorId) || planillaVisitante.find(item => item.jugador_id === jugadorId)
        return pl?.dorsal ? String(pl.dorsal) : '-'
      }

      const getJugadorInfo = (jugadorId) => {
        const j = [...jugadoresLocal, ...jugadoresVisitante].find(item => item.id === jugadorId)
        const dorsalStr = getDorsal(jugadorId) !== '-' ? getDorsal(jugadorId) : ''
        if (!j) return { dorsal: dorsalStr, nombreCompleto: '' }
        return { dorsal: dorsalStr, nombreCompleto: `${j.apellidos} ${j.nombres}` }
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

      doc.setFont("helvetica", "bold")
      doc.text(`CLUB: ${sanitize(equipoLocal?.nombre?.toUpperCase())}`, 15, 60)
      doc.text(`CATEGORIA: ${sanitize(equipoLocal?.categoria?.toUpperCase())}`, 100, 60)

      const filasLocal = jugadoresLocal.filter(j => planillaLocal.some(pl => pl.jugador_id === j.id)).map(j => {
        const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
        const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
        const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
        return [getDorsal(j.id), sanitize(`${j.apellidos} ${j.nombres}`), goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
      })

      autoTable(doc, {
        startY: 63, head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']], body: filasLocal, theme: 'grid',
        headStyles: { fillColor: [200,200,200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0:{cellWidth:15,halign:'center'}, 1:{cellWidth:110}, 2:{cellWidth:15,halign:'center'}, 3:{cellWidth:15,halign:'center'}, 4:{cellWidth:15,halign:'center'} }
      })

      let finalY = doc.lastAutoTable.finalY + 10
      doc.setFont("helvetica", "bold")
      doc.text(`CLUB: ${sanitize(equipoVisitante?.nombre?.toUpperCase())}`, 15, finalY)
      doc.text(`CATEGORIA: ${sanitize(equipoVisitante?.categoria?.toUpperCase())}`, 100, finalY)

      const filasVisitante = jugadoresVisitante.filter(j => planillaVisitante.some(pl => pl.jugador_id === j.id)).map(j => {
        const goles = eventos.filter(e => e.tipo === 'gol' && e.jugador_id === j.id).length
        const amarillas = eventos.filter(e => e.tipo === 'amarilla' && e.jugador_id === j.id).length
        const rojas = eventos.filter(e => e.tipo === 'roja' && e.jugador_id === j.id).length
        return [getDorsal(j.id), sanitize(`${j.apellidos} ${j.nombres}`), goles > 0 ? goles.toString() : '', amarillas > 0 ? 'X' : '', rojas > 0 ? 'X' : '']
      })

      autoTable(doc, {
        startY: finalY + 3, head: [['NO.', 'NOMBRES DE JUGADORES', 'GOL', 'T.A.', 'T.R.']], body: filasVisitante, theme: 'grid',
        headStyles: { fillColor: [200,200,200], textColor: [0,0,0], fontStyle: 'bold' },
        styles: { fontSize: 8, cellPadding: 1.5 },
        columnStyles: { 0:{cellWidth:15,halign:'center'}, 1:{cellWidth:110}, 2:{cellWidth:15,halign:'center'}, 3:{cellWidth:15,halign:'center'}, 4:{cellWidth:15,halign:'center'} }
      })

      doc.addPage(); dibujarEncabezado(2); doc.setFontSize(9); doc.setFont("helvetica", "normal")
      doc.text(`NOMBRE DEL SR. ARBITRO: ${sanitize(p.arbitro_nombre) || '________________________'}`, 15, 45)

      const tarjetasLocal = eventos.filter(ev => (ev.tipo === 'amarilla' || ev.tipo === 'roja') && ev.equipo_id === p.equipo_local_id)
      const tarjetasVisitante = eventos.filter(ev => (ev.tipo === 'amarilla' || ev.tipo === 'roja') && ev.equipo_id === p.equipo_visitante_id)

      const dibujarSeccionTarjetas = (startY, nombreClub, tarjetas) => {
        doc.setFont("helvetica", "bold")
        doc.text(`TARJETAS DEL CLUB: ${sanitize(nombreClub?.toUpperCase() || '')}`, 15, startY)
        let yAmarillas = startY + 6; let yRojas = startY + 45
        doc.text('TARJETAS AMARILLAS:', 15, yAmarillas); doc.setFont("helvetica", "normal"); yAmarillas += 5
        const amarillas = tarjetas.filter(t => t.tipo === 'amarilla')
        for(let i=0; i<6; i++) {
          const card = amarillas[i]
          if (card) {
            const info = getJugadorInfo(card.jugador_id)
            doc.text(`NO. ${info.dorsal || '___'}`, 15, yAmarillas + (i*6))
            doc.line(35, yAmarillas + (i*6), 130, yAmarillas + (i*6))
            doc.text(sanitize(info.nombreCompleto), 37, yAmarillas + (i*6) - 1)
            doc.text(`POR: ${sanitize(card.causa || '______')}`, 135, yAmarillas + (i*6))
          } else {
            doc.text(`NO. ______`, 15, yAmarillas + (i*6)); doc.line(35, yAmarillas + (i*6), 130, yAmarillas + (i*6)); doc.text(`POR: ________________`, 135, yAmarillas + (i*6))
          }
        }
        doc.setFont("helvetica", "bold"); doc.text('TARJETAS ROJAS:', 15, yRojas); doc.setFont("helvetica", "normal"); yRojas += 5
        const rojas = tarjetas.filter(t => t.tipo === 'roja')
        for(let i=0; i<4; i++) {
          const card = rojas[i]
          if (card) {
            const info = getJugadorInfo(card.jugador_id)
            doc.text(`NO. ${info.dorsal || '___'}`, 15, yRojas + (i*6))
            doc.line(35, yRojas + (i*6), 130, yRojas + (i*6))
            doc.text(sanitize(info.nombreCompleto), 37, yRojas + (i*6) - 1)
            doc.text(`POR: ${sanitize(card.causa || '______')}`, 135, yRojas + (i*6))
          } else {
            doc.text(`NO. ______`, 15, yRojas + (i*6)); doc.line(35, yRojas + (i*6), 130, yRojas + (i*6)); doc.text(`POR: ________________`, 135, yRojas + (i*6))
          }
        }
        return yRojas + 30
      }

      let nextY = dibujarSeccionTarjetas(55, equipoLocal?.nombre, tarjetasLocal)
      nextY = dibujarSeccionTarjetas(nextY, equipoVisitante?.nombre, tarjetasVisitante)

      doc.setFont("helvetica", "bold"); doc.text('NOVEDADES:', 15, nextY); doc.setFont("helvetica", "normal")
      const splitText = doc.splitTextToSize(sanitize(p.observaciones || 'Sin novedades registradas.'), 175)
      doc.text(splitText, 15, nextY + 6)
      
      let lineY = nextY + 6 + (splitText.length * 5) + 10
      const firmaY = lineY + 110 + 85 // Bajado 3cm

      const fArbitro = firmas.find(f => f.tipo_firmante === 'arbitro')
      const fCapLocal = firmas.find(f => f.tipo_firmante === 'local')
      const fCapVisitante = firmas.find(f => f.tipo_firmante === 'visitante')
      const fVocal = firmas.find(f => f.tipo_firmante === 'vocal')

      const capLocalPlan = planillaLocal.find(pl => pl.es_capitan)
      const capVisitPlan = planillaVisitante.find(pl => pl.es_capitan)
      const nombreCapLocal = capLocalPlan ? getJugadorInfo(capLocalPlan.jugador_id).nombreCompleto : ''
      const nombreCapVisit = capVisitPlan ? getJugadorInfo(capVisitPlan.jugador_id).nombreCompleto : ''

      const drawImageSafely = (base64, x, y, w, h) => {
        try { if (base64) doc.addImage(base64.replace(/^data:image\/(png|jpeg|jpg);base64,/, '').replace(/\s/g, ''), "png", x, y, w, h, undefined, 'FAST') } catch (e) { console.error(e) }
      }

      const xPositions = [15, 65, 115, 165]
      const firmantes = [
        { nombre: `CAPITÁN ${sanitize(equipoLocal?.nombre?.toUpperCase())}`, firma: fCapLocal, persona: nombreCapLocal },
        { nombre: `CAPITÁN ${sanitize(equipoVisitante?.nombre?.toUpperCase())}`, firma: fCapVisitante, persona: nombreCapVisit },
        { nombre: 'ÁRBITRO', firma: fArbitro, persona: p.arbitro_nombre || '' },
        { nombre: 'VOCAL', firma: fVocal, persona: p.vocal_nombre || '' }
      ]

      firmantes.forEach((item, index) => {
        const x = xPositions[index]
        drawImageSafely(item.firma?.firma_base64, x, firmaY - 20, 30, 15)
        doc.line(x, firmaY, x + 30, firmaY)
        doc.setFontSize(7); doc.setFont("helvetica", "bold")
        doc.text(item.nombre, x + 15, firmaY + 4, { align: 'center' })
        if (item.persona) { doc.setFont("helvetica", "normal"); doc.setFontSize(6); doc.text(sanitize(item.persona), x + 15, firmaY + 8, { align: 'center' }) }
      })

      doc.setFontSize(8); doc.text('VIVE EL FUTBOL SIN DROGAS Y SIN ALCOHOL', 15, 285); doc.text('CAMPEONATO 2026', 170, 285)

      const pdfBlob = doc.output('blob')
      const url = URL.createObjectURL(pdfBlob)
      const a = document.createElement('a')
      a.href = url; a.download = `acta-${p.id?.slice(0,8) || 'partido'}.pdf`
      document.body.appendChild(a); a.click(); document.body.removeChild(a)
      URL.revokeObjectURL(url)
    } catch (err) { console.error('Error generando PDF:', err); toast.error('Error al generar el acta PDF') }
  }

  if (cargando) return <div className="p-8 text-center">Cargando...</div>

  return (
    <div className="min-h-screen bg-gray-100 pb-32">
      <header className="bg-liga-azul text-white p-4 flex items-center gap-3 sticky top-0 z-10 shadow-md">
        <button onClick={() => navigate('/partidos')} className="p-2 bg-white/10 rounded-md"><ArrowLeft size={20} /></button>
        <div className="flex-1">
          <p className="text-xs text-liga-amarillo">PARTIDO EN VIVO</p>
          <h1 className="font-bold">{equipoLocal?.nombre} vs {equipoVisitante?.nombre}</h1>
        </div>
      </header>

      <main className="p-4 max-w-2xl mx-auto">
        <div className="bg-white rounded-xl shadow p-4 mb-4 text-center">
          <div className="text-3xl font-black">{Math.floor(tiempoRestante/60)}:{(tiempoRestante%60).toString().padStart(2,'0')}</div>
          <div className="flex justify-center gap-2 mt-2">
             <button onClick={() => setRelojCorriendo(!relojCorriendo)} className={`p-2 rounded-full text-white ${relojCorriendo ? 'bg-red-500' : 'bg-green-500'}`}>{relojCorriendo ? <Pause size={20}/> : <Play size={20}/>}</button>
             <button onClick={() => { setRelojCorriendo(false); setTiempoRestante(22*60); setPeriodoActual(1) }} className="p-2 rounded-full bg-gray-500 text-white"><RotateCcw size={20}/></button>
             {periodoActual === 1 && <button onClick={() => { setRelojCorriendo(false); setTiempoRestante(22*60); setPeriodoActual(2) }} className="text-xs bg-liga-amarillo text-black font-bold px-3 py-1 rounded shadow">Iniciar 2do Tiempo</button>}
          </div>
        </div>

        {[equipoLocal, equipoVisitante].map((eq, idx) => {
          if (!eq) return null
          const esLocal = idx === 0
          const jugadores = esLocal ? jugadoresLocal : jugadoresVisitante
          const planilla = esLocal ? planillaLocal : planillaVisitante
          const equipoId = esLocal ? partido.equipo_local_id : partido.equipo_visitante_id
          const faltasEq = faltas.filter(f => f.equipo_id === equipoId && f.periodo === periodoActual).length

          return (
            <div key={eq.id} className="bg-white rounded-xl shadow p-3 mb-4">
              <h3 className="font-bold text-sm mb-2 flex justify-between">
                <span>{eq.nombre}</span>
                <span className={faltasEq >= 6 ? 'text-red-600' : 'text-gray-500'}>Faltas Eq: {faltasEq}</span>
              </h3>
              {jugadores.map(j => {
                const insc = planilla.find(pl => pl.jugador_id === j.id)
                const faltasJug = faltas.filter(f => f.jugador_id === j.id && f.periodo === periodoActual).length
                const puedeEditar = rolUsuario === 'vocal' && !partido.jugado
                return (
                  <div key={j.id} className="flex items-center gap-2 p-2 border-b last:border-0 cursor-pointer hover:bg-gray-50" onClick={() => setJugadorSeleccionado({ jugador: j, equipoId })}>
                    <span className="w-8 h-8 bg-gray-200 rounded flex items-center justify-center font-bold">
                      {insc?.dorsal || '-'}
                    </span>
                    {puedeEditar && (
                      <button
                        onClick={(e) => { e.stopPropagation(); abrirModalDorsal(j.id, equipoId, `${j.apellidos} ${j.nombres}`, insc?.dorsal) }}
                        className="p-1 text-gray-400 hover:text-liga-azul"
                        title="Editar dorsal"
                      >
                        <Pencil size={14} />
                      </button>
                    )}
                    <span className="flex-1 text-xs uppercase">{j.apellidos} {j.nombres}</span>
                    {faltasJug > 0 && <span className="text-xs font-bold text-orange-500">{faltasJug}/5 Faltas</span>}
                    {insc?.es_capitan && <span className="text-xs bg-liga-amarillo px-1 rounded">CAP</span>}
                    {puedeEditar && (
                      <button
                        onClick={(e) => { e.stopPropagation(); marcarCapitan(j.id, equipoId) }}
                        className={`text-xs px-2 py-1 rounded ${insc?.es_capitan ? 'bg-liga-amarillo text-black' : 'bg-gray-100 text-gray-600'}`}
                        title={insc?.es_capitan ? 'Quitar capitanía' : 'Designar capitán'}
                      >
                        <UserCheck size={14} />
                      </button>
                    )}
                    {insc?.es_titular ? <span className="text-green-600 text-xs font-bold">TIT</span> : <span className="text-gray-400 text-xs">SUP</span>}
                  </div>
                )
              })}
            </div>
          )
        })}

        {deudasTarjetas.length > 0 && (
          <div className="bg-white rounded-xl shadow p-4 mb-4">
            <h3 className="font-bold text-sm mb-2 text-green-700 flex items-center gap-2"><DollarSign size={16} /> Cobro de Tarjetas</h3>
            {deudasTarjetas.map(d => (
              <div key={d.deuda_id} className="flex justify-between items-center p-2 border-b last:border-0 text-xs">
                <div>
                  <p className="font-bold">{d.jugador_nombre}</p>
                  <p>{d.tipo_sancion.toUpperCase()} - ${d.monto}</p>
                </div>
                {d.cancelado ? (
                  <span className="text-green-600 font-bold">CANCELADO</span>
                ) : (
                  <button onClick={() => { setMontoCobro(d.monto.toString()); setModalCobro(d) }} className="bg-green-600 text-white px-3 py-1 rounded">Cobrar</button>
                )}
              </div>
            ))}
          </div>
        )}

        {partido.jugado && esAdmin && (
          <button onClick={descargarPDF} className="w-full mt-3 py-4 rounded-xl font-bold text-lg shadow-lg bg-gray-800 text-white hover:bg-black flex items-center justify-center gap-2">
            <Printer size={20} /> Descargar / Imprimir Acta PDF
          </button>
        )}
      </main>

      <div className="fixed bottom-0 left-0 right-0 p-4 bg-white border-t shadow-lg z-20">
        <button onClick={iniciarCierre} disabled={partido.jugado || finalizando} className={`w-full py-3 rounded-xl font-bold ${partido.jugado ? 'bg-gray-300 text-gray-500' : 'bg-red-600 text-white hover:bg-red-700'}`}>
          {finalizando ? 'Procesando...' : partido.jugado ? 'Acta Finalizada' : 'Finalizar Partido y Firmar Acta'}
        </button>
      </div>

      {/* MODAL JUGADOR (Eventos) */}
      {jugadorSeleccionado && (
        <div className="fixed inset-0 bg-black/80 z-50 flex items-end sm:items-center justify-center p-4">
          <div className="bg-white rounded-t-2xl sm:rounded-xl w-full max-w-sm p-4">
            <div className="flex justify-between items-center mb-3">
              <div>
                <h3 className="font-bold text-lg leading-tight">{jugadorSeleccionado.jugador.apellidos} {jugadorSeleccionado.jugador.nombres}</h3>
                <p className="text-xs text-gray-500">Periodo {periodoActual}</p>
              </div>
              <button onClick={() => setJugadorSeleccionado(null)} className="p-2 bg-gray-100 rounded-full hover:bg-gray-200"><X size={20}/></button>
            </div>
            <div className="grid grid-cols-2 gap-2">
              <button onClick={() => registrarEvento('gol')} className="bg-green-600 text-white p-3 rounded-lg font-bold">Gol</button>
              <button onClick={() => registrarEvento('amarilla')} className="bg-yellow-500 text-black p-3 rounded-lg font-bold">Amarilla</button>
              <button onClick={() => registrarEvento('roja')} className="bg-red-600 text-white p-3 rounded-lg font-bold">Roja</button>
              <button onClick={registrarFalta} className="bg-orange-500 text-white p-3 rounded-lg font-bold">Falta</button>
            </div>
            <div className="mt-4 text-xs space-y-1 max-h-32 overflow-y-auto">
              <p className="font-bold">Eventos del jugador:</p>
              {eventos.filter(e => e.jugador_id === jugadorSeleccionado.jugador.id).map(e => (
                <p key={e.id} className="text-gray-600">{e.tipo.toUpperCase()} — min {e.minuto} (P{e.periodo})</p>
              ))}
              {faltas.filter(f => f.jugador_id === jugadorSeleccionado.jugador.id).map(f => (
                <p key={f.id} className="text-orange-600">FALTA — min {f.minuto} (P{f.periodo})</p>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* MODAL DORSAL */}
      {modalDorsal && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-bold text-lg mb-1">Cambiar dorsal</h3>
            <p className="text-xs text-gray-500 mb-3">{modalDorsal.jugadorNombre}</p>
            <input
              type="number" min="1" max="99" value={dorsalInput} onChange={(e) => setDorsalInput(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-2xl font-bold text-center" autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModalDorsal(null)} className="flex-1 py-2 border rounded-lg font-semibold">Cancelar</button>
              <button onClick={guardarDorsal} disabled={guardandoDorsal} className="flex-1 py-2 bg-liga-verde text-white rounded-lg font-bold disabled:opacity-50">
                {guardandoDorsal ? '...' : 'Guardar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* MODAL COBRO */}
      {modalCobro && (
        <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
          <div className="bg-white rounded-xl shadow-2xl w-full max-w-sm p-5">
            <h3 className="font-bold text-lg mb-1">Registrar pago</h3>
            <p className="text-xs text-gray-500 mb-1">{modalCobro.jugador_nombre} — {modalCobro.tipo_sancion?.toUpperCase()}</p>
            <p className="text-xs mb-3">Pendiente: ${(modalCobro.monto - modalCobro.monto_pagado).toFixed(2)}</p>
            <input
              type="number" min="0.01" step="0.01" value={montoCobro} onChange={(e) => setMontoCobro(e.target.value)}
              className="w-full px-3 py-2 border rounded-lg text-2xl font-bold text-center" autoFocus
            />
            <div className="flex gap-2 mt-4">
              <button onClick={() => setModalCobro(null)} className="flex-1 py-2 border rounded-lg font-semibold">Cancelar</button>
              <button onClick={confirmarCobro} disabled={cobrando} className="flex-1 py-2 bg-liga-verde text-white rounded-lg font-bold disabled:opacity-50">
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