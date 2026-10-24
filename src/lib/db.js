import Dexie from 'dexie';

export const db = new Dexie('LigaIzurietaPWA');

// Versión 1
db.version(1).stores({
  partidos: 'id, fecha_id, arbitro_id, vocal_id, jugado',
  equipos: 'id, nombre',
  jugadores: 'id, cedula, apellidos',
  planilla: 'id, partido_id, equipo_id, jugador_id',
  carnets: 'id, jugador_id, valido',
  sanciones: 'id, jugador_id, partido_id, etapa_id',
  eventos: '++id, partido_id, tipo, jugador_id, sync_status',
  syncQueue: '++id, action, data, tabla, creado_en'
});

// Versión 2 (Agregamos la tabla firmas)
db.version(2).stores({
  partidos: 'id, fecha_id, arbitro_id, vocal_id, jugado',
  equipos: 'id, nombre',
  jugadores: 'id, cedula, apellidos',
  planilla: 'id, partido_id, equipo_id, jugador_id',
  carnets: 'id, jugador_id, valido',
  sanciones: 'id, jugador_id, partido_id, etapa_id',
  eventos: '++id, partido_id, tipo, jugador_id, sync_status',
  syncQueue: '++id, action, data, tabla, creado_en',
  firmas: '++id, partido_id, tipo_firmante'
});