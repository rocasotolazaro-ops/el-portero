import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Decision, Nivel } from '../types'

// El Portero: antes de cada orden, un modelo pequeño la clasifica.
//   sencilla -> haiku   (preguntas cortas, retoques, traducciones breves...)
//   media    -> sonnet  (tareas normales de unos pocos pasos)
//   compleja -> se queda en el modelo de la sesión
// Solo baja de modelo, nunca sube, y solo en el hilo principal (los subagentes
// conservan el suyo).

const activo = atom({ plugin: 'el-portero', key: 'activo' } as const, true)
const ultima = atom({ plugin: 'el-portero', key: 'ultima' } as const, null)

const MODELO_POR_NIVEL: Record<Nivel, string | null> = {
  sencilla: 'haiku',
  media: 'sonnet',
  compleja: null,
}

// En conversaciones largas, cambiar de modelo pierde la caché del contexto y
// puede salir más caro que quedarse. Por encima de este número de mensajes,
// El Portero deja la orden en el modelo de la sesión.
const MAX_MENSAJES_PARA_CAMBIAR = 40

const SISTEMA = `Eres un clasificador de dificultad. Lees la orden que un usuario da a un asistente de IA y respondes SOLO con una palabra:
sencilla: saludo, pregunta factual corta, definición, traducción o reescritura breve, cálculo simple, un cambio pequeño y concreto.
media: tarea normal de pocos pasos: redactar un correo o texto medio, explicar algo con detalle, un script corto, resumir un documento, una búsqueda sencilla.
compleja: investigación amplia, programación de varios archivos o depuración difícil, análisis de datos, razonamiento delicado, documentos largos, planes de varias fases, temas legales, médicos o financieros, o cualquier duda.
Si dudas entre dos niveles, elige el más alto. Responde solo: sencilla, media o compleja.`

const rango = (modelo: string): number => {
  const m = modelo.toLowerCase()
  if (m.includes('haiku')) return 1
  if (m.includes('sonnet')) return 2
  return 3
}

const clasificar = async (
  $: EngineInterface,
  texto: string,
): Promise<Decision> => {
  const r = await $.model.complete({
    model: 'haiku',
    system: SISTEMA,
    prompt: `Orden del usuario:\n"""\n${texto.slice(0, 4000)}\n"""\nNivel:`,
    maxTokens: 10,
    effort: 'low',
    timeoutMs: 8000,
  })
  if (!r.isAnswered) {
    return { nivel: 'compleja', modelo: null, motivo: 'no se pudo clasificar' }
  }
  const palabra = r.text.trim().toLowerCase()
  const nivel: Nivel = palabra.startsWith('sencilla')
    ? 'sencilla'
    : palabra.startsWith('media')
      ? 'media'
      : 'compleja'

  return { nivel, modelo: MODELO_POR_NIVEL[nivel], motivo: 'clasificada' }
}

export const register: Register = on => {
  // Clasificación de la orden recién enviada, pendiente de su turno.
  let pendiente: Promise<Decision> | null = null
  // Decisión de cada turno del hilo principal, por id de turno.
  const porTurno = new Map<string, Promise<Decision>>()

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'portero',
      description: 'El Portero: /portero on, /portero off o /portero (estado)',
    })

    return next(e)
  })

  on('command.run', { command: 'portero' }, async ($, e) => {
    const arg = e.args.trim().toLowerCase()
    if (arg === 'on' || arg === 'off') {
      await update($, activo, () => arg === 'on')
      $.ui.status(arg === 'on' ? 'Portero: activo' : undefined)

      return {
        text:
          arg === 'on'
            ? 'El Portero está activo: las órdenes sencillas irán a un modelo más barato.'
            : 'El Portero está apagado: todo va al modelo de la sesión.',
      }
    }
    const estaActivo = await read($, activo)
    const d = await read($, ultima)
    const ultimaTxt = d
      ? `Última orden: ${d.nivel} → ${d.modelo ?? 'modelo de la sesión'} (${d.motivo}).`
      : 'Aún no ha clasificado ninguna orden.'

    return {
      text: `El Portero está ${estaActivo ? 'activo' : 'apagado'}. ${ultimaTxt}`,
    }
  })

  on('prompt.submit', async ($, e, next) => {
    pendiente = null
    const usar =
      e.command === undefined &&
      e.isMeta !== true &&
      e.attachments === undefined &&
      e.text.trim() !== '' &&
      (await read($, activo))

    if (usar) {
      // Se clasifica en paralelo: la orden sale ya y la espera se hace en el
      // primer paso del turno.
      pendiente = clasificar($, e.text).catch(() => ({
        nivel: 'compleja' as const,
        modelo: null,
        motivo: 'error al clasificar',
      }))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.start', async ($, e, next) => {
    if (e.agentId === undefined && pendiente !== null) {
      porTurno.set(e.turnId, pendiente)
      pendiente = null
    }

    return next(e)
  })

  on('turn.step', async function* ($, e, next) {
    const decidida = e.agentId === undefined ? porTurno.get(e.turnId) : undefined
    if (decidida === undefined) {
      return yield* next(e)
    }

    let d = await decidida
    if (d.modelo !== null && rango(d.modelo) >= rango(e.model)) {
      d = { ...d, modelo: null, motivo: 'la sesión ya usa un modelo igual o más barato' }
    }
    if (d.modelo !== null && e.messageCount > MAX_MENSAJES_PARA_CAMBIAR) {
      d = { ...d, modelo: null, motivo: 'conversación larga: se conserva la caché' }
    }

    if (e.index === 0) {
      await update($, ultima, () => d)
      $.ui.status(
        d.modelo !== null
          ? `Portero: ${d.nivel} → ${d.modelo}`
          : `Portero: ${d.nivel} → modelo de la sesión`,
      )
    }

    return yield* next(d.modelo !== null ? { ...e, model: d.modelo } : e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      porTurno.delete(e.turnId)
    }

    return next(e)
  })
}
