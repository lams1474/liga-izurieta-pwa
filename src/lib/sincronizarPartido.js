import { supabase } from './supabase'
import { db } from './db'

export async function sincronizarPartido(partidoId) {
  console.log("🚀 Iniciando sincronización del partido:", partidoId)
  
  const partido = await db.partidos.get(partidoId)
  const eventos = await db.eventos.where('partido_id').equals(partidoId).toArray()
  const faltas = await db.faltas.where('partido_id').equals(partidoId).toArray()
  const firmas = await db.firmas.where('partido_id').equals(partidoId).toArray()

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

  // Obtener el etapa_id del partido (con protección)
  let etapaId = null
  try {
    const { data: pData } = await supabase.from('partidos').select('fecha_id, fechas(etapa_id)').eq('id', partidoId).single()
    etapaId = pData?.fechas?.etapa_id || null
  } catch (e) {
    console.error("No se pudo obtener el etapa_id", e)
  }

  // 2. RESTO DE LA SINCRONIZACIÓN
  try {
    // Sincronizar goles
    console.log("2. Sincronizando goles...")
    await supabase.from('goles').delete().eq('partido_id', partidoId)
    for (const ev of eventos) {
      if (ev.tipo === 'gol') {
        await supabase.from('goles').insert({
          partido_id: partidoId, jugador_id: ev.jugador_id, minuto: ev.minuto, tipo: 'normal'
        })
      }
    }

    // Sincronizar tarjetas y sanciones
    console.log("3. Sincronizando tarjetas...")
    await supabase.from('sanciones_jugador').delete().eq('partido_id', partidoId)
    for (const ev of eventos) {
      if (ev.tipo === 'amarilla' || ev.tipo === 'roja') {
        try {
          const { error: errSancion } = await supabase.from('sanciones_jugador').insert({
            jugador_id: ev.jugador_id, 
            equipo_id: ev.equipo_id, 
            partido_id: partidoId,
            etapa_id: etapaId, // Puede ser null, la BD lo aceptará
            tipo: ev.tipo, 
            motivo: ev.causa || 'No especificada',
            fechas_sancion: ev.tipo === 'roja' ? 1 : 0,
            fechas_cumplidas: 0, 
            activa: true
          })
          if (errSancion) console.error("❌ Error insertando sanción:", errSancion)
        } catch (e) {
          console.error("❌ Error crítico insertando sanción:", e)
        }
      }
    }

    // Sincronizar faltas
    console.log("4. Sincronizando faltas...")
    await supabase.from('faltas_partido').delete().eq('partido_id', partidoId)
    for (const f of faltas) {
      await supabase.from('faltas_partido').insert({
        partido_id: partidoId,
        jugador_id: f.jugador_id,
        equipo_id: f.equipo_id,
        tipo: f.tipo,
        periodo: Number(f.periodo || 1),
        minuto: f.minuto
      })
    }

    // Sincronizar firmas
    console.log("5. Sincronizando firmas...")
    let actaId;
    const { data: actaExistente } = await supabase.from('actas').select('id').eq('partido_id', partidoId).maybeSingle()

    if (actaExistente) {
      actaId = actaExistente.id
      await supabase.from('firmas_acta').delete().eq('acta_id', actaId)
    } else {
      const { data: nuevaActa } = await supabase.from('actas').insert({
        partido_id: partidoId,
        estado: 'cerrada',
        observaciones: partido.observaciones || null,
        cerrada_en: new Date().toISOString()
      }).select().single()
      actaId = nuevaActa.id
    }

    for (const f of firmas) {
      let tipoValido = f.tipo_firmante
      if (tipoValido === 'local') tipoValido = 'capitan_local'
      if (tipoValido === 'visitante') tipoValido = 'capitan_visitante'

      await supabase.from('firmas_acta').insert({
        acta_id: actaId,
        firmante_tipo: tipoValido,
        firma_digital: f.firma_base64,
      })
    }

    console.log("✅ Sincronización completada")
  } catch (error) {
    console.error("⚠️ Error en sincronización secundaria:", error)
  }

  await db.partidos.update(partidoId, { jugado: true, sincronizado: true, goles_local: golesLocal, goles_visitante: golesVisitante })
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