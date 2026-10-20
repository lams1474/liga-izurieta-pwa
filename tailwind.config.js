/** @type {import('tailwindcss').Config} */
export default {
  content: [
    "./index.html",
    "./src/**/*.{js,ts,jsx,tsx}",
  ],
  theme: {
    extend: {
      colors: {
        'liga-azul': '#1e3a8a',
        'liga-rojo': '#dc2626',
        'liga-amarillo': '#fbbf24',
        'liga-verde': '#16a34a',
      },
    },
  },
  plugins: [],
}