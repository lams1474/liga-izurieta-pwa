import { useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'

export function useAuth() {
  // session === undefined → cargando | null → sin sesión | objeto → logueado
  const [session, setSession] = useState(undefined)
  const [user, setUser] = useState(null)

  useEffect(() => {
    // 1) Sesión inicial (persiste tras recargar / cerrar pestaña)
    supabase.auth.getSession().then(({ data: { session } }) => {
      setSession(session)
      setUser(session?.user ?? null)
    })

    // 2) Escuchar login / logout / refresh de token
    const { data: { subscription } } = supabase.auth.onAuthStateChange(
      (_event, session) => {
        setSession(session)
        setUser(session?.user ?? null)
      }
    )

    return () => subscription.unsubscribe()
  }, [])

  return { session, user, loading: session === undefined }
}