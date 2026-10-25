import { forwardRef } from 'react'

const ActaPrintView = forwardRef(({ 
  partido, equipoLocal, equipoVisitante, jugadoresLocal, jugadoresVisitante, eventos, firmas 
}, ref) => {
  
  if (!partido) return null

  const getEstadisticas = (jugadorId) => {
    const evs = eventos.filter(e => e.jugador_id === jugadorId)
    return { 
      goles: evs.filter(e => e.tipo === 'gol').length, 
      amarillas: evs.filter(e => e.tipo === 'amarilla').length, 
      rojas: evs.filter(e => e.tipo === 'roja').length 
    }
  }

  const renderTablaEquipo = (equipo, jugadores) => {
    const filas = [...jugadores]
    while (filas.length < 19) {
      filas.push({ id: `vacio-${filas.length}`, apellidos: '', nombres: '', esVacio: true })
    }

    return (
      <div className="mb-6">
        <h3 className="font-bold text-sm bg-gray-200 p-1 border border-black uppercase">
          CLUB: {equipo?.nombre || '---'}
        </h3>
        <table className="w-full border-collapse border border-black text-xs">
          <thead>
            <tr className="bg-gray-100">
              <th className="border border-black p-1 w-8">No.</th>
              <th className="border border-black p-1 text-left">NOMBRES DE JUGADORES</th>
              <th className="border border-black p-1 w-8">GOL</th>
              <th className="border border-black p-1 w-8">T.A.</th>
              <th className="border border-black p-1 w-8">T.R.</th>
            </tr>
          </thead>
          <tbody>
            {filas.map((j, index) => {
              const stats = j.esVacio ? { goles: '', amarillas: '', rojas: '' } : getEstadisticas(j.id)
              return (
                <tr key={j.id}>
                  <td className="border border-black text-center p-0.5">{index + 1}</td>
                  <td className="border border-black p-0.5 uppercase">
                    {j.esVacio ? '' : `${j.apellidos} ${j.nombres}`}
                  </td>
                  <td className="border border-black text-center p-0.5 font-bold">{stats.goles || ''}</td>
                  <td className="border border-black text-center p-0.5 bg-yellow-100 font-bold">{stats.amarillas || ''}</td>
                  <td className="border border-black text-center p-0.5 bg-red-100 font-bold">{stats.rojas || ''}</td>
                </tr>
              )
            })}
          </tbody>
        </table>
        
        <div className="mt-2 text-xs space-y-1 border border-black p-2">
          <p><strong>DT:</strong> _______________________________________________________________</p>
          <p><strong>AT:</strong> _______________________________________________________________</p>
          <p><strong>PF:</strong> _______________________________________________________________</p>
        </div>
      </div>
    )
  }

  const firmaArbitro = firmas.find(f => f.tipo_firmante === 'arbitro')
  const firmaCapitanLocal = firmas.find(f => f.tipo_firmante === 'local')
  const firmaCapitanVisitante = firmas.find(f => f.tipo_firmante === 'visitante')
  const firmaVocal = firmas.find(f => f.tipo_firmante === 'vocal')

  return (
    <div ref={ref} className="bg-white text-black p-8 w-[210mm] min-h-[297mm] mx-auto font-sans">
      
      <div className="text-center mb-6 border-b-2 border-black pb-4">
        <h1 className="text-xl font-black uppercase">Liga Deportiva Barrial José Ignacio Izurieta</h1>
        <p className="text-xs">Pujilí – Ecuador</p>
        <p className="text-xs">Fundada el 09 de Marzo del 2013</p>
        <h2 className="text-lg font-bold mt-2">ACTA DE JUEGO</h2>
      </div>

      <div className="flex justify-between text-sm mb-4">
        <div>
          <p><strong>FECHA:</strong> {partido.hora ? partido.hora.slice(0,5) : '--:--'}</p>
          <p><strong>CANCHA:</strong> {partido.cancha || '---'}</p>
        </div>
        <div className="text-right">
          <p><strong>VOCAL DE TURNO:</strong> {firmaVocal ? 'Firmado Digitalmente' : '---'}</p>
          <p><strong>ÁRBITRO:</strong> {firmaArbitro ? 'Firmado Digitalmente' : '---'}</p>
        </div>
      </div>

      {renderTablaEquipo(equipoLocal, jugadoresLocal)}
      {renderTablaEquipo(equipoVisitante, jugadoresVisitante)}

      <div className="mt-4">
        <h3 className="font-bold text-sm border-b border-black mb-1">NOVEDADES:</h3>
        <div className="min-h-[80px] text-xs whitespace-pre-wrap">
          {partido.observaciones || 'Sin novedades registradas.'}
        </div>
      </div>

      <div className="mt-12 grid grid-cols-2 gap-8 text-center text-xs">
        <div>
          <div className="h-16 flex items-end justify-center mb-1">
            {firmaCapitanLocal && <img src={firmaCapitanLocal.firma_base64} alt="Firma" className="max-h-16" />}
          </div>
          <div className="border-t border-black pt-1">
            <p className="font-bold uppercase">CAPITÁN {equipoLocal?.nombre}</p>
            <p>{firmaCapitanLocal?.de_acuerdo ? 'ACUERDO' : 'DESACUERDO'}</p>
          </div>
        </div>
        <div>
          <div className="h-16 flex items-end justify-center mb-1">
            {firmaCapitanVisitante && <img src={firmaCapitanVisitante.firma_base64} alt="Firma" className="max-h-16" />}
          </div>
          <div className="border-t border-black pt-1">
            <p className="font-bold uppercase">CAPITÁN {equipoVisitante?.nombre}</p>
            <p>{firmaCapitanVisitante?.de_acuerdo ? 'ACUERDO' : 'DESACUERDO'}</p>
          </div>
        </div>
      </div>

      <div className="mt-12 flex justify-around text-center text-xs">
        <div>
          <div className="h-16 flex items-end justify-center mb-1">
            {firmaArbitro && <img src={firmaArbitro.firma_base64} alt="Firma" className="max-h-16" />}
          </div>
          <div className="border-t border-black pt-1 w-48">
            <p className="font-bold uppercase">FIRMA DEL ÁRBITRO</p>
          </div>
        </div>
        <div>
          <div className="h-16 flex items-end justify-center mb-1">
            {firmaVocal && <img src={firmaVocal.firma_base64} alt="Firma" className="max-h-16" />}
          </div>
          <div className="border-t border-black pt-1 w-48">
            <p className="font-bold uppercase">FIRMA DEL VOCAL</p>
          </div>
        </div>
      </div>

    </div>
  )
})

export default ActaPrintView