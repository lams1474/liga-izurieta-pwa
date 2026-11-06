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

  // Contar goles
  const golesLocal = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_local_id).length
  const golesVisitante = eventos.filter(e => e.tipo === 'gol' && e.equipo_id === partido.equipo_visitante_id).length

  // 1. ACTUALIZAR EL PARTIDO EN SUPABASE
  console.log("1. Actualizando marcador y fecha...")
  const { error: errPartido } = await supabase.from('partidos').update({
    jugado: true,
    goles_local: golesLocal,
    goles_visitante: golesVisitante,
    observaciones: partido.observaciones || null,
    hora: partido.hora || null 
  }).eq('id', partidoId)

  if (errPartido) {
    console.error("ERROR AL ACTUALIZAR PARTIDO:", errPartido.message)
    throw new Error('Error actualizando partido: ' + errPartido.message)
  }

  // Obtener el etapa_id del partido (para las sanciones)
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
        const { error } = await supabase.from('goles').insert({
          partido_id: partidoId, 
          jugador_id: ev.jugador_id, 
          minuto: Number(ev.minuto) || 0, 
          tipo: 'normal'
        })
        if (error) console.error("ERROR AL GUARDAR GOL:", error.message)
      }
    }

    // Sincronizar tarjetas y faltas
    console.log("3. Sincronizando tarjetas y faltas...")
    
    await supabase.from('faltas_partido').delete().eq('partido_id', partidoId)
    await supabase.from('sanciones_jugador').delete().eq('partido_id', partidoId)
    
    for (const ev of eventos) {
      if (ev.tipo === 'amarilla' || ev.tipo === 'roja') {
        
        // A. Guardar en faltas_partido
        const { error: errFalta } = await supabase.from('faltas_partido').insert({
          partido_id: partidoId,
          jugador_id: ev.jugador_id,
          equipo_id: ev.equipo_id,
          tipo: ev.tipo,
          periodo: Number(ev.periodo) || 1,
          minuto: Number(ev.minuto) || 0
        })
        
        if (errFalta) console.error("❌ ERROR AL GUARDAR TARJETA EN FALTAS_PARTIDO:", errFalta.message)

        // B. Guardar en sanciones_jugador (Para que salga en Pagos)
        const { error: errSancion } = await supabase.from('sanciones_jugador').insert({
          jugador_id: ev.jugador_id, 
          equipo_id: ev.equipo_id, 
          partido_id: partidoId,
          etapa_id: etapaId, 
          tipo: ev.tipo, 
          motivo: ev.causa || 'No especificada',
          fechas_sancion: ev.tipo === 'roja' ? 1 : 0,
          fechas_cumplidas: 0, 
          activa: true
        })
        
        if (errSancion) console.error("❌ ERROR AL GUARDAR SANCIÓN:", errSancion.message)
      }
    }

    for (const f of faltas) {
      const { error } = await supabase.from('faltas_partido').insert({
        partido_id: partidoId,
        jugador_id: f.jugador_id,
        equipo_id: f.equipo_id,
        tipo: 'personal',
        periodo: Number(f.periodo) || 1,
        minuto: Number(f.minuto) || 0
      })
      if (error) console.error("Error guardando falta:", error.message)
    }

    // Sincronizar Planilla
        const jugadoresConvocados = planilla.filter(p => p.dorsal && p.dorsal > 0)
    console.log("Jugadores a sincronizar:", jugadoresConvocados.length)
    
    for (const p of jugadoresConvocados) {
      // IMPORTANTE: No enviamos 'id', dejamos que Supabase genere el UUID
      const { error } = await supabase.from('planilla_partido').insert({
        partido_id: partidoId,
        equipo_id: p.equipo_id,
        jugador_id: p.jugador_id,
        dorsal: Number(p.dorsal) || 0,
        es_titular: p.es_titular,
        es_capitan: p.es_capitan
      })
      if (error) console.error("Error guardando planilla:", error.message)
    }
    console.log("✅ Planilla insertada:", jugadoresConvocados.length, "jugadores")

    // Sincronizar firmas
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
      const { data: nuevaActa, error: errActa } = await supabase.from('actas').insert({
        partido_id: partidoId,
        estado: 'cerrada',
        observaciones: partido.observaciones || null,
        cerrada_en: new Date().toISOString()
      }).select().single()
      
      if (errActa) {
        console.error("ERROR AL CREAR ACTA:", errActa.message)
      } else {
        actaId = nuevaActa.id
      }
    }

    for (const f of firmas) {
      let tipoValido = f.tipo_firmante
      if (tipoValido === 'local') tipoValido = 'capitan_local'
      if (tipoValido === 'visitante') tipoValido = 'capitan_visitante'

      // IMPORTANTE: En Dexie la firma se llama 'firma_base64' o 'firma'
      const firmaData = f.firma_digital || f.firma_base64 || f.firma

      const { error } = await supabase.from('firmas_acta').insert({
        acta_id: actaId,
        firmante_tipo: tipoValido,
        firma_digital: firmaData
      })
      if (error) console.error("Error guardando firma:", error.message)
    }

    console.log("✅ Sincronización completada")
  } catch (error) {
    console.error("⚠️ Error en sincronización secundaria:", error)
    alert("ERROR GENERAL: " + error.message)
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