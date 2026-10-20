import Dexie from 'dexie';

// Creamos la base de datos local en el celular
export const db = new Dexie('LigaIzurietaDB');

// Definimos las tablas (solo guardaremos los partidos asignados)
db.version(1).stores({
  partidos: 'id, fecha_id, hora, equipo_local_id, equipo_visitante_id, jugado', // Partidos descargados
  jugadores: 'id, equipo_id, apellidos, nombres, cedula, foto_url, estado_carnet, motivos_bloqueo', // Jugadores de esos equipos
  eventos: '++id, partido_id, tipo, jugador_id, equipo_id, minuto, sync_status', // Goles y tarjetas guardados offline
  syncQueue: '++id, action, data' // Cola de cosas por subir a la nube
});