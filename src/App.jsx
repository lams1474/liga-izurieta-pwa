import { useEffect } from 'react'
import { BrowserRouter, Routes, Route, Navigate } from 'react-router-dom'
import { Toaster } from 'react-hot-toast'
import Login from './pages/Login'
import Partidos from './pages/Partidos'
import PartidoVivo from './pages/PartidoVivo'
import ProtectedRoute from './components/ProtectedRoute'
import { db } from './lib/db'
import { iniciarAutoSincronizacion } from './lib/sincronizarPartido'

function App() {
  useEffect(() => {
    // Abrir base de datos local
    db.open().then(() => {
      console.log('✅ Base de datos local (Dexie) lista y conectada');
    }).catch(err => {
      console.error('❌ Error abriendo Dexie:', err);
    });

    // Iniciar escuchador de red para subir partidos pendientes
    iniciarAutoSincronizacion();

  }, []);

  return (
    <BrowserRouter>
      <Toaster position="top-right" />
      <Routes>
        <Route path="/login" element={<Login />} />
        
        <Route path="/partidos" element={
          <ProtectedRoute><Partidos /></ProtectedRoute>
        } />

        <Route path="/partido/:id" element={
          <ProtectedRoute><PartidoVivo /></ProtectedRoute>
        } />
        
        <Route path="*" element={<Navigate to="/login" replace />} />
      </Routes>
    </BrowserRouter>
  )
}

export default App