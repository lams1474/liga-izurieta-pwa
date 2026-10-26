import { supabase } from './supabase'
import { db } from './db'

export async function sincronizarPartido(partidoId) {
  const partido = await db.partidos.get(partidoId)
  const eventos = await db.eventos.where('partido_id').equals(partidoId).toArray()
  const faltas = await db.faltas.where('partido_id').equals(partidoId).toArray()
  const firmas = await db.firmas.where('partido_id').equals(partidoId).toArray()

  if (!partido) throw new Error('Partido no encontrado en memoria')

  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_visitante_id).length

  // 1. ACTUALIZAR EL PARTIDO PRIMERO (Para que pase a Historial pase lo que pase)
  const { error: errPartido } = await supabase.from('partidos').update({
    jugado: true,
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    observaciones: partido.observaciones || null
  }).eq('id', partidoId)

  if (errPartido) throw new Error('Error actualizando partido: ' + errPartido.message)

  try {
    // 2. Crear o buscar el ACTA
    let actaId;
    const { data: actaExistente } = await supabase.from('actas').select('id').eq('partido_id', partidoId).maybeSingle()

    if (actaExistente) {
      actaId = actaExistente.id
      await supabase.from('firmas_acta').delete().eq('acta_id', actaId)
      await supabase.from('actas').update({ observaciones: partido.observaciones || null }).eq('id', actaId)
    } else {
      const { data: nuevaActa, error: errActa } = await supabase.from('actas').insert({
        partido_id: partidoId,
        estado: 'cerrada', 
        observaciones: partido.observaciones || null,
        cerrada_en: new Date().toISOString()
      }).select().single()

      if (errActa) throw new Error('Error creando acta: ' + errActa.message)
      actaId = nuevaActa.id
    }

    // 3. Limpiar datos viejos
    await supabase.from('goles').delete().eq('partido_id', partidoId)
    await supabase.from('sanciones_jugador').delete().eq('partido_id', partidoId)
    await supabase.from('faltas_partido').delete().eq('partido_id', partidoId)

    // 4. Sincronizar FALTAS
    for (const f of faltas) {
      await supabase.from('faltas_partido').insert({
        partido_id: partidoId,
        jugador_id: f.jugador_id,
        equipo_id: f.equipo_id,
        tipo: f.tipo,
        periodo: Number(f.periodo || 1), // Si no tiene periodo, asumimos 1
        minuto: f.minuto
      })
    }

    // 5. Sincronizar EVENTOS
    for (const ev of eventos) {
      if (ev.tipo === 'gol') {
        await supabase.from('goles').insert({
          partido_id: partidoId, jugador_id: ev.jugador_id, minuto: ev.minuto, tipo: 'normal'
        })
      } else if (ev.tipo === 'amarilla' || ev.tipo === 'roja') {
        const { data: pData } = await supabase.from('partidos').select('fecha_id, fechas(etapa_id)').eq('id', partidoId).single()
        const etapaId = pData?.fechas?.etapa_id

        await supabase.from('sanciones_jugador').insert({
          jugador_id: ev.jugador_id, equipo_id: ev.equipo_id, partido_id: partidoId,
          etapa_id: etapaId, tipo: ev.tipo, motivo: ev.causa || 'No especificada',
          fechas_sancion: ev.tipo === 'roja' ? 1 : 0, fechas_cumplidas: 0, activa: true
        })
      }
    }

    // 6. Sincronizar FIRMAS
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

  } catch (error) {
    console.error("Error en sincronización secundaria (faltas/eventos/firmas):", error)
    // No lanzamos el error para que el partido quede como jugado y sincronizado localmente
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