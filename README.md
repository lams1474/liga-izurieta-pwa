# ⚽ Liga Deportiva Barrial José Ignacio Izurieta — PWA Vocal / Árbitro

Aplicación Web Progresiva (PWA) de control de partidos en vivo, registro de planillas, captura de firmas digitales, generación de actas oficiales en PDF y sincronización offline/online con **Supabase** y el **Admin Liga**.

---

## 📌 Descripción del Sistema

La **Liga Deportiva Barrial José Ignacio Izurieta** (Pujilí – Ecuador) opera mediante un ecosistema de aplicaciones interconectadas que comparten la misma base de datos en Supabase:

1. **Admin Liga (Panel Administrativo Web):** Gestión de campeonatos, equipos, jugadores, programación de fechas, sanciones acumuladas y contabilidad.
2. **PWA Vocal / Árbitro (Este Repositorio):** Control de partidos en vivo, marcación de titulares/suplentes, registro de goles, tarjetas amarillas/rojas, faltas acumulativas, firma digital del acta y descarga del PDF oficial.
3. **App de Clubes / Delegados:** Consulta de planillas, carnets digitales de jugadores y programación de encuentros.
4. **Portal / App Pública de Resultados:** Tabla de posiciones, goleadores y estado de partidos en tiempo real.

---

## 🚀 Características Principales de esta PWA

- **📱 Funcionamiento 100% Offline (Dexie.js / IndexedDB):** Descarga los partidos asignados y permite registrar eventos sin conexión a Internet en el campo de juego.
- **⏱️ Cronómetro y Control Futsal / Fútbol:** Manejo de periodos, tiempo corrido/pausado y faltas acumulativas por equipo.
- **📋 Gestión de Planilla en Vivo:** Selección de jugadores titulares y suplentes con validación instantánea de habilitación/carnet y sanciones activas.
- **🟨🟥 Registro de Eventos:** Marcación de goles, tarjetas amarillas (causas comunes) y tarjetas rojas (expulsiones).
- **✍️ Firma Digital del Acta:** Captura interactiva de firmas digitales para el Capitán Local, Capitán Visitante, Vocal de Turno y Árbitro, con registro de acuerdo/desacuerdo y observaciones.
- **📄 Generación de Acta Oficial en PDF:** Creación automática del Acta de Juego en PDF con jsPDF y AutoTable, incluyendo encabezado de la Liga, tablas de alineación, detalle de tarjetas por club y firmas digitales.
- **📡 Auto-Sincronización con Supabase / Admin Liga:** Envío automático de marcadores, goles, tarjetas, sanciones, faltas, firmas y planilla jugada al recuperar la conexión a Internet.

---

## 🛠️ Tecnologías Utilizadas

- **Frontend:** React 19 + Vite
- **Estilos:** Tailwind CSS + Lucide React (iconos)
- **Base de Datos Local (Offline):** Dexie.js (IndexedDB)
- **Backend & Autenticación:** Supabase (`@supabase/supabase-js`)
- **Generación de PDF:** `jspdf` + `jspdf-autotable`
- **Captura de Firmas:** `react-signature-canvas`
- **PWA Plugin:** `vite-plugin-pwa`
- **Notificaciones:** `react-hot-toast`

---

## 📂 Estructura del Proyecto

```text
src/
├── components/
│   ├── ActaPrintView.jsx     # Componente auxiliar de vista de acta
│   ├── FirmaModal.jsx        # Modal interactivo para captura de firmas digitales
│   └── ProtectedRoute.jsx    # Protección de rutas por autenticación y rol
├── hooks/
│   └── useAuth.js            # Hook de estado de autenticación de Supabase
├── lib/
│   ├── db.js                 # Configuración de esquemas y versiones de Dexie.js
│   ├── descargarPartidos.js  # Descarga de partidos, jugadores, carnets y sanciones desde Supabase
│   ├── sincronizarPartido.js # Sincronización de resultados, goles, sanciones, planilla y firmas a Supabase
│   └── supabase.js           # Cliente configurado de Supabase
├── pages/
│   ├── Login.jsx             # Inicio de sesión para Vocales, Árbitros y Admins
│   ├── Partidos.jsx          # Lista de partidos locales asignados y botón de descarga offline
│   └── PartidoVivo.jsx       # Interfaz en vivo del encuentro, cronómetro, eventos y PDF
├── App.jsx                   # Enrutamiento principal y listeners de red
└── main.jsx                  # Punto de entrada de React y SW de PWA
```

---

## ⚙️ Configuración e Instalación

### 1. Requisitos Previos

- Node.js (v18.0.0 o superior)
- npm (v9.0.0 o superior)

### 2. Variables de Entorno

Crea un archivo `.env` en la raíz del proyecto con las credenciales de tu proyecto en Supabase:

```env
VITE_SUPABASE_URL=https://tu-proyecto.supabase.co
VITE_SUPABASE_ANON_KEY=tu-anon-key-de-supabase
```

### 3. Instalación de Dependencias

```bash
npm install
```

### 4. Modo Desarrollo

```bash
npm run dev
```

Abre en tu navegador la URL que indica la consola (ej. `http://localhost:5173`).

### 5. Compilado para Producción

```bash
npm run build
```

Para previsualizar el compilado de producción:

```bash
npm run preview
```

---

## 🔄 Diagrama de Sincronización de Datos

```text
[ Supabase / Admin Liga ]
         │
         │  (1) Descargar partidos, planillas, carnets y sanciones
         ▼
[ Dexie.js (Memoria Local Celular) ]
         │
         │  (2) Registro de titulares, goles, tarjetas, faltas y firmas offline
         ▼
[ Partido en Vivo & Firma de Acta ]
         │
         │  (3) Sincronización automática al detectar conexión (online)
         ▼
[ Supabase ]
   ├── partidos (marcador, observaciones, estado jugado)
   ├── goles (minuto, jugador)
   ├── sanciones_jugador (tarjetas rojas y acumuladas)
   ├── faltas_partido (futsal)
   ├── actas & firmas_acta (firmas digitales)
   └── planilla_partido (titulares y dorsales)
```

---

## 📝 Licencia y Créditos

Desarrollado para la **Liga Deportiva Barrial José Ignacio Izurieta** (Pujilí - Ecuador).
*Todos los derechos reservados.*
