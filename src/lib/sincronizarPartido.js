import { supabase } from './supabase'
import { db } from './db'

export async function sincronizarPartido(partidoId) {
  const partido = await db.partidos.get(partidoId)
  const eventos = await db.eventos.where('partido_id').equals(partidoId).toArray()
  const eventosPendientes = eventos.filter(e => e.sync_status === 'pending')
  const firmas = await db.firmas.where('partido_id').equals(partidoId).toArray()
  const firmasPendientes = firmas.filter(f => f.sync_status === 'pending')

  if (!partido) throw new Error('Partido no encontrado en memoria')

  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_visitante_id).length

  // 1. Actualizar partido (Marcador y Novedades)
  const { error: errPartido } = await supabase.from('partidos').update({
    jugado: true,
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    observaciones: partido.observaciones || null
  }).eq('id', partidoId)

  if (errPartido) throw new Error('Error actualizando partido: ' + errPartido.message)

  // 2. Sincronizar Eventos
  for (const ev of eventosPendientes) {
    if (ev.tipo === 'gol') {
      await supabase.from('goles').insert({ partido_id: partidoId, jugador_id: ev.jugador_id, minuto: ev.minuto, tipo: 'normal' })
    } else if (ev.tipo === 'amarilla' || ev.tipo === 'roja') {
      await supabase.from('sanciones_jugador').insert({
        jugador_id: ev.jugador_id, equipo_id: ev.equipo_id, partido_id: partidoId, tipo: ev.tipo,
        motivo: 'Registrado en cancha', fechas_sancion: ev.tipo === 'roja' ? 1 : 0, fechas_cumplidas: 0, activa: true
      })
    }
    await db.eventos.update(ev.id, { sync_status: 'synced' })
  }

  // 3. Sincronizar Firmas
  for (const f of firmasPendientes) {
    await supabase.from('firmas_acta').insert({
      partido_id: partidoId,
      firmante_tipo: f.tipo_firmante,
      firma_digital: f.firma_base64,
      // de_acuerdo: f.de_acuerdo,
      // motivo: f.motivo_desacuerdo
    })
    await db.firmas.update(f.id, { sync_status: 'synced' })
  }

  await db.partidos.update(partidoId, { jugado: true, sincronizado: true, goles_local: golesLocal, goles_visitante: golesVisitante })
  return { golesLocal, golesVisitante, eventosSubidos: eventosPendientes.length, firmasSubidas: firmasPendientes.length }
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