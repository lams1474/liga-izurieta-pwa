import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { VitePWA } from 'vite-plugin-pwa'

export default defineConfig({
  plugins: [
    react(),
    VitePWA({
      registerType: 'autoUpdate', // Actualiza la app automáticamente en el celular
      includeAssets: ['favicon.ico'],
      manifest: {
        name: 'Liga Izurieta - Árbitros',
        short_name: 'Liga App',
        description: 'App offline para árbitros y vocales',
        theme_color: '#1e3a8a', // Tu azul de liga
        background_color: '#f3f4f6',
        display: 'standalone', // Hace que se vea como app nativa (pantalla completa)
        orientation: 'portrait',
        icons: [
          {
            src: 'pwa-192x192.png', // Ícono pequeño
            sizes: '192x192',
            type: 'image/png'
          },
          {
            src: 'pwa-512x512.png', // Ícono grande
            sizes: '512x512',
            type: 'image/png'
          }
        ]
      }
    })
  ]
})