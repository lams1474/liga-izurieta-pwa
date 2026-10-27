import { supabase } from './supabase'
import { db } from './db'

export async function sincronizarPartido(partidoId) {
  console.log("🚀 Iniciando sincronización del partido:", partidoId)
  
  const partido = await db.partidos.get(partidoId)
  const eventos = await db.eventos.where('partido_id').equals(partidoId).toArray()
  const faltas = await db.faltas.where('partido_id').equals(partidoId).toArray()
  const firmas = await db.firmas.where('partido_id').equals(partidoId).toArray()
  const planilla = await db.planilla.where('partido_id').equals(partidoId).toArray()

  if (!partido) throw new Error('Partido no encontrado en memoria local')

  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_visitante_id).length

  // 1. ACTUALIZAR EL PARTIDO EN SUPABASE
  console.log("1. Actualizando marcador...")
  const { error: errPartido } = await supabase.from('partidos').update({
    jugado: true,
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    observaciones: partido.observaciones || null
  }).eq('id', partidoId)

  if (errPartido) throw new Error('Error actualizando partido: ' + errPartido.message)

  // Obtener el etapa_id del partido
  let etapaId = null
  try {
    const { data: pData } = await supabase.from('partidos').select('fecha_id, fechas(etapa_id)').eq('id', partidoId).single()
    etapaId = pData?.fechas?.etapa_id
  } catch (e) {
    console.error("No se pudo obtener el etapa_id", e)
  }

  let syncExitoso = true

  // 2. RESTO DE LA SINCRONIZACIÓN
  try {
    // Sincronizar goles
    console.log("2. Sincronizando goles...")
    const { error: errDelGoles } = await supabase.from('goles').delete().eq('partido_id', partidoId)
    if (errDelGoles) console.error("Error al borrar goles:", errDelGoles)

    for (const ev of eventos) {
      if (ev.tipo === 'gol') {
        const { error: errGol } = await supabase.from('goles').insert({
          partido_id: partidoId, jugador_id: ev.jugador_id, minuto: ev.minuto, tipo: 'normal'
        })
        if (errGol) {
          console.error("Error insertando gol:", errGol)
          syncExitoso = false
        }
      }
    }

    // Sincronizar tarjetas y sanciones
    console.log("3. Sincronizando tarjetas y sanciones...")
    const { error: errDelSanc } = await supabase.from('sanciones_jugador').delete().eq('partido_id', partidoId)
    if (errDelSanc) console.error("Error al borrar sanciones:", errDelSanc)

    const amarillasPorJugador = {}
    for (const ev of eventos) {
      if (ev.tipo === 'amarilla') {
        amarillasPorJugador[ev.jugador_id] = (amarillasPorJugador[ev.jugador_id] || 0) + 1
      }
    }

    for (const ev of eventos) {
      if (ev.tipo === 'amarilla' || ev.tipo === 'roja') {
        try {
          const esRoja = ev.tipo === 'roja'
          const conteoAmarillas = amarillasPorJugador[ev.jugador_id] || 0
          const esDobleAmarilla = ev.tipo === 'amarilla' && conteoAmarillas >= 2
          const generaSancionActiva = esRoja || esDobleAmarilla

          const { error: errSancion } = await supabase.from('sanciones_jugador').insert({
            jugador_id: ev.jugador_id, 
            equipo_id: ev.equipo_id, 
            partido_id: partidoId,
            etapa_id: etapaId, 
            tipo: esDobleAmarilla ? 'doble_amarilla' : ev.tipo,
            motivo: ev.causa || 'No especificada',
            fechas_sancion: generaSancionActiva ? 1 : 0,
            fechas_cumplidas: 0, 
            activa: generaSancionActiva
          })
          if (errSancion) {
            console.error("Error insertando sanción:", errSancion)
            syncExitoso = false
          }
        } catch (e) {
          console.error("Error crítico insertando sanción:", e)
          syncExitoso = false
        }
      }
    }

    // Sincronizar faltas
    console.log("4. Sincronizando faltas...")
    const { error: errDelFaltas } = await supabase.from('faltas_partido').delete().eq('partido_id', partidoId)
    if (errDelFaltas) console.error("Error al borrar faltas:", errDelFaltas)

    for (const f of faltas) {
      const { error: errFalta } = await supabase.from('faltas_partido').insert({
        partido_id: partidoId,
        jugador_id: f.jugador_id,
        equipo_id: f.equipo_id,
        tipo: f.tipo,
        periodo: Number(f.periodo || 1),
        minuto: f.minuto
      })
      if (errFalta) {
        console.error("Error insertando falta:", errFalta)
        syncExitoso = false
      }
    }

    // Sincronizar firmas
    console.log("5. Sincronizando firmas...")
    let actaId;
    const { data: actaExistente } = await supabase.from('actas').select('id').eq('partido_id', partidoId).maybeSingle()

    if (actaExistente) {
      actaId = actaExistente.id
      await supabase.from('firmas_acta').delete().eq('acta_id', actaId)
    } else {
      const { data: nuevaActa, error: errActa } = await supabase.from('actas').insert({
        partido_id: partidoId,
        estado: 'cerrada',
        observaciones: partido.observaciones || null,
        cerrada_en: new Date().toISOString()
      }).select().single()

      if (errActa) {
        console.error("Error creando acta:", errActa)
        syncExitoso = false
      } else {
        actaId = nuevaActa?.id
      }
    }

    if (actaId) {
      for (const f of firmas) {
        let tipoValido = f.tipo_firmante
        if (tipoValido === 'local') tipoValido = 'capitan_local'
        if (tipoValido === 'visitante') tipoValido = 'capitan_visitante'

        const { error: errFirma } = await supabase.from('firmas_acta').insert({
          acta_id: actaId,
          firmante_tipo: tipoValido,
          firma_digital: f.firma_base64,
        })
        if (errFirma) {
          console.error("Error insertando firma:", errFirma)
          syncExitoso = false
        }
      }
    }

    // Sincronizar planilla_partido
    console.log("6. Sincronizando planilla...")
    if (planilla && planilla.length > 0) {
      await supabase.from('planilla_partido').delete().eq('partido_id', partidoId)
      const filasPlanilla = planilla.map(pl => ({
        partido_id: partidoId,
        equipo_id: pl.equipo_id,
        jugador_id: pl.jugador_id,
        es_titular: pl.es_titular || false,
        dorsal: pl.dorsal || null
      }))
      const { error: errPlanilla } = await supabase.from('planilla_partido').insert(filasPlanilla)
      if (errPlanilla) {
        console.error("Error al sincronizar planilla:", errPlanilla)
        syncExitoso = false
      }
    }

    if (syncExitoso) {
      console.log("✅ Sincronización completada exitosamente")
    } else {
      console.warn("⚠️ Sincronización parcial con algunos errores")
    }
  } catch (error) {
    console.error("⚠️ Error en sincronización secundaria:", error)
    syncExitoso = false
  }

  await db.partidos.update(partidoId, {
    jugado: true,
    sincronizado: syncExitoso,
    goles_local: golesLocal,
    goles_visitante: golesVisitante
  })

  if (!syncExitoso) {
    throw new Error('La sincronización se completó con errores. Se reintentará cuando haya conexión.')
  }

  return { golesLocal, golesVisitante }
}

export function iniciarAutoSincronizacion() {
  window.addEventListener('online', async () => {
    const partidos = await db.partidos.toArray()
    const pendientes = partidos.filter(p => p.jugado && !p.sincronizado)
    for (const p of pendientes) {
      try { await sincronizarPartido(p.id) } catch (error) { console.error(error) }
    }
  })
}