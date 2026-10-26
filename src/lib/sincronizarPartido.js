import { supabase } from './supabase'
import { db } from './db'

export async function sincronizarPartido(partidoId) {
  const partido = await db.partidos.get(partidoId)
  const eventos = await db.eventos.where('partido_id').equals(partidoId).toArray()
  const firmas = await db.firmas.where('partido_id').equals(partidoId).toArray()

  if (!partido) throw new Error('Partido no encontrado en memoria')

  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_visitante_id).length

  // 1. Crear o buscar el ACTA
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

  // 2. Limpiar e Insertar los Eventos (Goles y Tarjetas)
  await supabase.from('goles').delete().eq('partido_id', partidoId)
  await supabase.from('sanciones_jugador').delete().eq('partido_id', partidoId)

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
        etapa_id: etapaId, tipo: ev.tipo, motivo: 'Registrado en cancha', fechas_sancion: ev.tipo === 'roja' ? 1 : 0,
        fechas_cumplidas: 0, activa: true
      })
    }
    await db.eventos.update(ev.id, { sync_status: 'synced' })
  }

  // 3. ACTUALIZAR EL PARTIDO (Antes de las firmas, por si fallan)
  const { error: errPartido } = await supabase.from('partidos').update({
    jugado: true,
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    observaciones: partido.observaciones || null
  }).eq('id', partidoId)

  if (errPartido) throw new Error('Error actualizando partido: ' + errPartido.message)

  // 4. Insertar Firmas (Traduciendo 'local' a 'capitan_local')
  for (const f of firmas) {
    let tipoValido = f.tipo_firmante
    if (tipoValido === 'local') tipoValido = 'capitan_local'
    if (tipoValido === 'visitante') tipoValido = 'capitan_visitante'

    try {
      await supabase.from('firmas_acta').insert({
        acta_id: actaId,
        firmante_tipo: tipoValido,
        firma_digital: f.firma_base64,
      })
      await db.firmas.update(f.id, { sync_status: 'synced' })
    } catch (err) {
      console.error("Error insertando firma:", err)
    }
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