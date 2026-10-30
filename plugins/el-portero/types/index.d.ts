export type Nivel = 'sencilla' | 'media' | 'compleja'

export type Decision = {
  nivel: Nivel
  // Modelo al que se envía la orden; null = se queda en el modelo de la sesión.
  modelo: string | null
  motivo: string
}

declare module 'claude-code' {
  interface PluginState {
    'el-portero': { activo: boolean; ultima: Decision | null }
  }
}
