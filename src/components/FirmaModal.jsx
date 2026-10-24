import { useRef, useState } from 'react'
import SignatureCanvas from 'react-signature-canvas'
import { X, Eraser, Check } from 'lucide-react'
import toast from 'react-hot-toast'

export default function FirmaModal({ isOpen, onClose, onSave, tipoFirmante, titulo }) {
  const sigCanvas = useRef(null)
  const [isSaving, setIsSaving] = useState(false)
  
  const [deAcuerdo, setDeAcuerdo] = useState(true)
  const [motivo, setMotivo] = useState('')
  const [novedades, setNovedades] = useState('')

  if (!isOpen) return null

  const esCapitan = tipoFirmante === 'local' || tipoFirmante === 'visitante'
  const esArbitroOVocal = tipoFirmante === 'vocal' || tipoFirmante === 'arbitro'

  function limpiar() {
    if (sigCanvas.current) sigCanvas.current.clear()
  }

  function guardar() {
    if (!deAcuerdo && !motivo.trim()) {
      return toast.error('Por favor, escriba el motivo del desacuerdo')
    }
    if (!sigCanvas.current || sigCanvas.current.isEmpty()) {
      return toast.error('Por favor, firme en el recuadro')
    }

    setIsSaving(true)
    
    try {
      // Usamos getCanvas() en lugar de getTrimmedCanvas() para evitar errores de la librería
      const firmaBase64 = sigCanvas.current.getCanvas().toDataURL('image/png')
      
      onSave({
        firma: firmaBase64,
        deAcuerdo,
        motivo: !deAcuerdo ? motivo : null,
        novedades: esArbitroOVocal ? novedades : null
      })
    } catch (error) {
      console.error("Error al generar la firma:", error)
      toast.error('Hubo un problema al guardar la firma. Intenta borrar y firmar de nuevo.')
    } finally {
      // El bloque finally asegura que el botón SIEMPRE se desbloquee
      setIsSaving(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/80 z-[100] flex items-center justify-center p-4">
      <div className="bg-white rounded-xl shadow-2xl w-full max-w-md overflow-hidden animate-in zoom-in-95 max-h-[95vh] flex flex-col">
        
        <div className="bg-liga-azul text-white p-4 flex justify-between items-center shrink-0">
          <div>
            <h3 className="font-bold text-lg leading-tight">Firma del Acta</h3>
            <p className="text-xs text-liga-amarillo">{titulo}</p>
          </div>
          <button onClick={onClose} className="p-1 hover:bg-white/20 rounded-md"><X size={20} /></button>
        </div>

        <div className="p-4 overflow-y-auto space-y-4">
          
          {/* OPCIONES PARA CAPITANES */}
          {esCapitan && (
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <p className="text-sm font-semibold text-gray-800 mb-2">¿Está de acuerdo con el resultado y sanciones?</p>
              <div className="flex gap-2">
                <button 
                  onClick={() => setDeAcuerdo(true)} 
                  className={`flex-1 py-2 rounded-md font-bold transition-colors ${deAcuerdo ? 'bg-green-600 text-white' : 'bg-white text-gray-600 border border-gray-300'}`}
                >
                  Sí, de acuerdo
                </button>
                <button 
                  onClick={() => setDeAcuerdo(false)} 
                  className={`flex-1 py-2 rounded-md font-bold transition-colors ${!deAcuerdo ? 'bg-red-600 text-white' : 'bg-white text-gray-600 border border-gray-300'}`}
                >
                  No, en desacuerdo
                </button>
              </div>
              {!deAcuerdo && (
                <div className="mt-3">
                  <label className="text-xs font-semibold text-red-600">Motivo del desacuerdo *</label>
                  <textarea 
                    value={motivo}
                    onChange={(e) => setMotivo(e.target.value)}
                    className="w-full mt-1 px-3 py-2 border border-red-300 rounded-md focus:outline-none focus:ring-2 focus:ring-red-500 text-sm"
                    rows="2"
                    placeholder="Escriba el motivo aquí..."
                  />
                </div>
              )}
            </div>
          )}

          {/* NOVEDADES PARA ARBITRO Y VOCAL */}
          {esArbitroOVocal && (
            <div className="bg-gray-50 p-3 rounded-lg border border-gray-200">
              <label className="text-sm font-semibold text-gray-800 mb-1 block">Novedades del Partido</label>
              <textarea 
                value={novedades}
                onChange={(e) => setNovedades(e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-md focus:outline-none focus:ring-2 focus:ring-liga-azul text-sm"
                rows="3"
                placeholder="Ej: Suspendido por lluvia, lesión grave, etc. (Opcional)"
              />
            </div>
          )}

          {/* RECUADRO DE FIRMA */}
          <div>
            <p className="text-sm text-gray-500 mb-2 text-center">Firme con el dedo o el mouse</p>
            <div className="border-2 border-dashed border-gray-300 rounded-lg overflow-hidden bg-gray-50">
              <SignatureCanvas 
                ref={sigCanvas} 
                penColor="black"
                canvasProps={{ className: "w-full h-48" }} 
              />
            </div>
          </div>
        </div>

        <div className="p-4 bg-gray-50 flex gap-2 shrink-0 border-t">
          <button 
            onClick={limpiar} 
            className="flex-1 py-3 border border-gray-300 rounded-lg font-semibold text-gray-700 flex items-center justify-center gap-2 hover:bg-gray-100"
          >
            <Eraser size={18} /> Borrar
          </button>
          <button 
            onClick={guardar} 
            disabled={isSaving}
            className="flex-1 py-3 bg-liga-verde text-white rounded-lg font-bold flex items-center justify-center gap-2 hover:bg-green-700 disabled:opacity-50"
          >
            <Check size={18} /> {isSaving ? '...' : 'Confirmar'}
          </button>
        </div>
      </div>
    </div>
  )
}