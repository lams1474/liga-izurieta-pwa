import { supabase } from './supabase'
import { db } from './db'

export async function sincronizarPartido(partidoId) {
  console.log("🚀 Iniciando sincronización del partido:", partidoId)
  
  const partido = await db.partidos.get(partidoId)
  const eventos = await db.eventos.where('partido_id').equals(partidoId).toArray()
  const faltas = await db.faltas.where('partido_id').equals(partidoId).toArray()
  const firmas = await db.firmas.where('partido_id').equals(partidoId).toArray()
  const planilla = await db.planilla.where('partido_id').equals(partidoId).toArray()

  if (!partido) throw new Error('Partido no encontrado')

  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_visitante_id).length

  // 1. PARTIDO
  console.log("1. Actualizando partido...")
  await supabase.from('partidos').update({
    jugado: true,
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    observaciones: partido.observaciones || null,
    hora: partido.hora || null 
  }).eq('id', partidoId)

  try {
    // 2. GOLES
    console.log("2. Sincronizando goles...")
    await supabase.from('goles').delete().eq('partido_id', partidoId)
    for (const ev of eventos) {
      if (ev.tipo === 'gol') {
        await supabase.from('goles').insert({
          partido_id: partidoId, 
          jugador_id: ev.jugador_id, 
          minuto: Number(ev.minuto) || 0, 
          tipo: 'normal'
        })
      }
    }

    // 3. LIMPIAR TARJETAS Y SANCIONES ANTES DE INSERTAR
    console.log("3. Sincronizando tarjetas y faltas...")
    await supabase.from('faltas_partido').delete().eq('partido_id', partidoId)
    await supabase.from('sanciones_jugador').delete().eq('partido_id', partidoId)
    await supabase.from('sanciones').delete().eq('partido_id', partidoId)

    // Procesamos SOLO las faltas (donde están las tarjetas con su causa)
    for (const f of faltas) {
      // A. Guardar en faltas_partido CON SU CAUSA (para que el trigger la lea)
      await supabase.from('faltas_partido').insert({
        partido_id: partidoId,
        jugador_id: f.jugador_id,
        equipo_id: f.equipo_id,
        tipo: f.tipo,
        periodo: Number(f.periodo) || 1,
        minuto: Number(f.minuto) || 0,
        causa: f.causa || 'No especificada' // <--- ESTO ARREGLA EL ACTA
      })
    }

    // 4. PLANILLA
    console.log("4. Sincronizando planilla...")
    await supabase.from('planilla_partido').delete().eq('partido_id', partidoId)

    const jugadoresUnicos = []
    const vistos = new Set()
    for (const p of planilla) {
      if (!vistos.has(p.jugador_id)) {
        vistos.add(p.jugador_id)
        jugadoresUnicos.push(p)
      }
    }

    console.log(`Enviando ${jugadoresUnicos.length} jugadores`)

    for (const p of jugadoresUnicos) {
      await supabase.from('planilla_partido').upsert({
        partido_id: partidoId,
        equipo_id: p.equipo_id,
        jugador_id: p.jugador_id,
        dorsal: Number(p.dorsal) || 0,
        es_titular: p.es_titular || false,
        es_capitan: p.es_capitan || false
      }, { onConflict: 'partido_id, jugador_id' })
    }

    // 5. FIRMAS
    console.log("5. Sincronizando firmas...")
    let actaId;
    const { data: actaExistente } = await supabase.from('actas').select('id').eq('partido_id', partidoId).maybeSingle()

    if (actaExistente) {
      actaId = actaExistente.id
      await supabase.from('actas').update({
        estado: 'cerrada',
        observaciones: partido.observaciones || null,
        cerrada_en: new Date().toISOString()
      }).eq('id', actaId)
      await supabase.from('firmas_acta').delete().eq('acta_id', actaId)
    } else {
      const { data: nuevaActa } = await supabase.from('actas').insert({
        partido_id: partidoId,
        estado: 'cerrada',
        observaciones: partido.observaciones || null,
        cerrada_en: new Date().toISOString()
      }).select().single()
      if (nuevaActa) actaId = nuevaActa.id
    }

    if (actaId) {
      for (const f of firmas) {
        let tipoValido = f.tipo_firmante === 'local' ? 'capitan_local' : f.tipo_firmante === 'visitante' ? 'capitan_visitante' : f.tipo_firmante
        await supabase.from('firmas_acta').insert({
          acta_id: actaId,
          firmante_tipo: tipoValido,
          firma_digital: f.firma_digital || f.firma_base64 || f.firma
        })
      }
    }

    console.log("✅ Sincronización completada")
  } catch (error) {
    console.error("⚠️ Error en sincronización:", error)
  }

  await db.partidos.update(partidoId, { jugado: true, sincronizado: true, goles_local: golesLocal, goles_visitante: golesVisitante })
  return { golesLocal, golesVisitante }
}