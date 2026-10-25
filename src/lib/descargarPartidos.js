import { supabase } from './supabase'
import { db } from './db'

export async function descargarMisPartidos() {
  const { data: { session }, error: errAuth } = await supabase.auth.getSession()
  if (errAuth || !session) throw new Error('No hay sesión activa')
  const user = session.user

  const { data: arbitroRow } = await supabase
    .from('arbitros')
    .select('id')
    .eq('usuario_id', user.id)
    .maybeSingle()

  const orFilters = [`vocal_id.eq.${user.id}`]
  if (arbitroRow?.id) orFilters.push(`arbitro_id.eq.${arbitroRow.id}`)

  // 1. Traer los partidos actuales de Supabase
  const { data: partidos, error: errPartidos } = await supabase
    .from('partidos')
    .select(`
      id, fecha_id, hora, cancha, equipo_local_id, equipo_visitante_id,
      arbitro_id, vocal_id, goles_local, goles_visitante, jugado, observaciones
    `)
    .or(orFilters.join(','))
    .eq('jugado', false)

  if (errPartidos) throw errPartidos

  // 2. NUEVA LÓGICA: Limpiar partidos viejos en Dexie que ya no están en Supabase
  const partidosLocales = await db.partidos.toArray()
  const partidosNubeIds = (partidos || []).map(p => p.id)
  const partidosABorrar = partidosLocales.filter(p => !partidosNubeIds.includes(p.id))

  if (partidosABorrar.length > 0) {
    await db.transaction('rw', db.partidos, db.planilla, db.eventos, async () => {
      for (const p of partidosABorrar) {
        await db.partidos.delete(p.id)
        await db.planilla.where('partido_id').equals(p.id).delete()
        await db.eventos.where('partido_id').equals(p.id).delete()
      }
    })
    console.log(`Se eliminaron ${partidosABorrar.length} partidos que ya no existen en la nube.`)
  }

  if (!partidos || partidos.length === 0) {
    return { partidos: 0, jugadores: 0, equipos: 0, planilla: 0, carnets: 0 }
  }

  // ... El resto de tu código para descargar equipos, planilla, jugadores, etc. se mantiene igual ...
  
  const partidoIds = partidos.map(p => p.id)
  const equipoIds = [...new Set(partidos.flatMap(p => [p.equipo_local_id, p.equipo_visitante_id]))]

  const { data: equipos } = await supabase.from('equipos').select('id, nombre, disciplina, categoria, escudo_url, colores').in('id', equipoIds)

  const { data: jugadorEquipo } = await supabase.from('jugador_equipo').select('jugador_id, equipo_id, dorsal, posicion').in('equipo_id', equipoIds).eq('activo', true)
  const jugadorIds = [...new Set((jugadorEquipo || []).map(je => je.jugador_id))]
  const idsToFetch = jugadorIds.length ? jugadorIds : ['00000000-0000-0000-0000-000000000000']

  const { data: jugadores } = await supabase.from('jugadores').select('id, nombres, apellidos, cedula, foto_url, fecha_nacimiento, es_menor').in('id', idsToFetch)
  const { data: carnets } = await supabase.from('carnets').select('id, jugador_id, equipo_id, valido, motivo_bloqueo').in('jugador_id', idsToFetch)
  const { data: sanciones } = await supabase.from('sanciones_jugador').select('id, jugador_id, partido_id, etapa_id, tipo, fechas_sancion, fechas_cumplidas, activa').in('jugador_id', idsToFetch).eq('activa', true)
  
  const { data: planillaAdmin } = await supabase.from('planilla_partido').select('id, partido_id, equipo_id, jugador_id, es_titular, dorsal').in('partido_id', partidoIds)

  const planillaLocal = []
  partidos.forEach(p => {
    [p.equipo_local_id, p.equipo_visitante_id].forEach(eqId => {
      const jugadoresEquipo = jugadorEquipo?.filter(je => je.equipo_id === eqId) || []
      jugadoresEquipo.forEach(je => {
        const jugador = jugadores?.find(j => j.id === je.jugador_id)
        if (!jugador) return
        const adminInsc = planillaAdmin?.find(pa => pa.partido_id === p.id && pa.jugador_id === je.jugador_id)
        planillaLocal.push({
          id: adminInsc?.id || crypto.randomUUID(),
          partido_id: p.id, equipo_id: eqId, jugador_id: je.jugador_id,
          es_titular: adminInsc ? adminInsc.es_titular : false,
          dorsal: je.dorsal || null, posicion: je.posicion || null
        })
      })
    })
  })

  await db.transaction('rw', db.partidos, db.equipos, db.jugadores, db.planilla, db.carnets, db.sanciones, async () => {
    await db.partidos.bulkPut(partidos)
    await db.equipos.bulkPut(equipos || [])
    await db.jugadores.bulkPut(jugadores || [])
    await db.planilla.bulkPut(planillaLocal)
    await db.carnets.bulkPut(carnets || [])
    await db.sanciones.bulkPut(sanciones || [])
  })

  return {
    partidos: partidos.length,
    equipos: equipos?.length || 0,
    jugadores: jugadores?.length || 0,
    planilla: planillaLocal.length,
    carnets: carnets?.length || 0
  }
}