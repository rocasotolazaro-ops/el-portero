# El Portero

Mod para Claude que clasifica cada orden antes de responderla y la envía a un modelo más barato cuando es sencilla, para ahorrar créditos.

- **sencilla** (saludos, preguntas cortas, traducciones, cambios pequeños) → Haiku
- **media** (un correo, una explicación, un script corto) → Sonnet
- **compleja** o dudosa → el modelo de la sesión

Solo baja de modelo, nunca sube. No toca subagentes, comandos ni mensajes con imágenes. En conversaciones de más de 40 mensajes deja el modelo de la sesión para no perder la caché del contexto.

## Instalación

1. Sube esta carpeta a un repositorio de GitHub (por ejemplo `tu-usuario/el-portero`).
2. En Claude ejecuta: `/plugin install el-portero --marketplace tu-usuario/el-portero`

## Uso

- `/portero` muestra el estado y la última decisión
- `/portero off` lo apaga
- `/portero on` lo vuelve a encender

La línea de estado muestra cada decisión, por ejemplo `Portero: sencilla → haiku`.
