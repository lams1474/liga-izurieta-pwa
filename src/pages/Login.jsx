import { useState, useEffect } from 'react'
import { supabase } from '../lib/supabase'
import { useNavigate } from 'react-router-dom'
import toast from 'react-hot-toast'
import { Lock, Mail, Shield } from 'lucide-react'

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [cargando, setCargando] = useState(false)
  const navigate = useNavigate()

  // ─── Si ya hay una sesión activa, saltamos el login ───
  useEffect(() => {
    supabase.auth.getSession().then(({ data: { session } }) => {
      if (session) {
        navigate('/partidos', { replace: true })
      }
    })
  }, [navigate])

  async function handleLogin(e) {
    e.preventDefault()
    setCargando(true)

    try {
      // 1. Autenticar con Supabase
      const { data, error } = await supabase.auth.signInWithPassword({
        email,
        password,
      })

      if (error) throw error

      // 2. Verificar que el usuario tenga un rol permitido
      const { data: usuario, error: errRol } = await supabase
        .from('usuarios')
        .select('rol')
        .eq('id', data.user.id)
        .single()

      if (errRol) throw errRol

      if (!usuario || !['arbitro', 'vocal', 'admin'].includes(usuario.rol)) {
        await supabase.auth.signOut()
        throw new Error('No tienes permisos para usar esta app.')
      }

      toast.success('Bienvenido')
      navigate('/partidos', { replace: true })
    } catch (err) {
      toast.error(err.message || 'Error al iniciar sesión')
    } finally {
      setCargando(false)
    }
  }

  return (
    <div className="min-h-screen bg-liga-azul flex flex-col items-center justify-center p-6 text-white">
      <div className="mb-8 text-center">
        <Shield size={64} className="text-liga-amarillo mx-auto mb-4" />
        <h1 className="text-3xl font-bold">Liga Izurieta</h1>
        <p className="text-liga-amarillo mt-1">App Vocal / Árbitro</p>
      </div>

      <form
        onSubmit={handleLogin}
        className="bg-white text-gray-800 p-6 rounded-lg shadow-xl w-full max-w-sm space-y-4"
      >
        <div>
          <label htmlFor="email" className="block text-sm font-semibold mb-1">
            Correo
          </label>
          <div className="relative">
            <Mail
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              id="email"
              name="email"
              type="email"
              required
              autoComplete="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded-md focus:ring-liga-azul"
              placeholder="arbitro@liga.com"
            />
          </div>
        </div>

        <div>
          <label htmlFor="password" className="block text-sm font-semibold mb-1">
            Contraseña
          </label>
          <div className="relative">
            <Lock
              size={18}
              className="absolute left-3 top-1/2 -translate-y-1/2 text-gray-400"
            />
            <input
              id="password"
              name="password"
              type="password"
              required
              autoComplete="current-password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              className="w-full pl-10 pr-3 py-2 border rounded-md focus:ring-liga-azul"
              placeholder="••••••••"
            />
          </div>
        </div>

        <button
          type="submit"
          disabled={cargando}
          className="w-full bg-liga-azul text-white py-2 rounded-md font-bold hover:bg-liga-azul/90 disabled:opacity-50"
        >
          {cargando ? 'Ingresando...' : 'Ingresar'}
        </button>
      </form>
    </div>
  )
}