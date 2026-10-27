# Laboratorio de Evidencias · despliegue en Vercel

Cuaderno de análisis de datos criminales que corre en el navegador (sin instalar nada), con:
- **Analista IA** gratuito para cualquier visitante, a través de un modelo de NVIDIA NIM. La clave vive solo en el servidor.
- **Veredictos** de los estudiantes guardados en una base de datos (Upstash Redis, gratuita) y una página `/profesor.html` para verlos y descargarlos en CSV.

## Pasos (unos 15 minutos)

### 1. Clave de NVIDIA
1. Entra a https://build.nvidia.com e inicia sesión (cuenta gratuita).
2. Abre cualquier modelo (por ejemplo `meta/llama-3.1-70b-instruct`) → **Get API Key** → copia la clave (`nvapi-...`).
3. Revisa en tu cuenta cuántos créditos gratuitos tienes; cada consulta del laboratorio gasta uno.

### 2. Subir el proyecto a Vercel
Opción A (sin terminal): sube esta carpeta a un repositorio de GitHub y en https://vercel.com → **Add New → Project** → importa el repositorio. No hay que cambiar ninguna opción de build.

Opción B (terminal): `npm i -g vercel` y, dentro de esta carpeta, `vercel` (la primera vez) y luego `vercel --prod`.

### 3. Base de datos para los veredictos
En el proyecto de Vercel → pestaña **Storage** → **Create Database** → **Upstash for Redis** (plan gratuito) → **Connect to project**. Vercel crea solas las variables `KV_REST_API_URL` y `KV_REST_API_TOKEN`. No hay que instalar nada más.

### 4. Variables de entorno
Proyecto → **Settings → Environment Variables**:

| Variable | Obligatoria | Para qué |
|---|---|---|
| `NVIDIA_API_KEY` | sí (para la IA) | la clave del paso 1 |
| `CLAVE_PROFESOR` | sí (para ver veredictos) | la contraseña que escribes en `/profesor.html` |
| `CLAVE_CLASE` | no | si la defines, los estudiantes deben escribirla una vez (pestaña «Analista IA») para usar la IA; evita que desconocidos gasten tus créditos |
| `NVIDIA_MODEL` | no | fuerza un modelo concreto. Si no se define, el servidor consulta los modelos disponibles de tu clave y elige uno solo (NVIDIA retira modelos con frecuencia y responden «410 Gone»; si el elegido muere, pasa al siguiente) |
| `NVIDIA_MODEL_QUICK` | no | igual, para las explicaciones rápidas («¿Qué hace?») |
| `LIMITE_POR_MINUTO` | no | consultas de IA por minuto por estudiante (20; se cuenta por dispositivo, no por IP) |
| `LIMITE_POR_MINUTO_RED` | no | consultas de IA por minuto desde una misma red, p. ej. el wifi del salón (200) |
| `LIMITE_POR_DIA` | no | consultas de IA por día para toda la clase (3000; cada pregunta puede gastar 2 o 3 si la IA tiene que corregir su código) |

Después de guardar variables, haz **Redeploy** (Deployments → ⋯ → Redeploy) para que apliquen.

### 5. Probar
- `https://tu-proyecto.vercel.app/api/modelos` muestra qué modelos tiene tu clave y cuáles usará el laboratorio (útil si la IA da error).
  Con `?probar=1&clave=TU_CLAVE_PROFESOR` además le hace una pregunta de prueba a cada modelo candidato y muestra cuánto tarda y qué responde. Si un modelo falla, tarda más de 25 s o responde vacío, el servidor lo deja «en pausa» unos minutos y usa el siguiente (aparece en `en_pausa`).
- Abre `https://tu-proyecto.vercel.app` → pestaña **Analista IA** debe mostrar el chat (si falta la clave, muestra un aviso).
- Escribe un nombre en «Tu nombre o código», un veredicto, y pulsa **Enviar al profesor**.
- Pulsa el botón **Profesor** (arriba, junto a las sesiones), escribe `CLAVE_PROFESOR` → debe aparecer el veredicto. **Descargar CSV** baja el historial completo. (También existe `/profesor.html` como página aparte.)

## Cómo se cuida que el código de la IA funcione
El laboratorio no es Python completo (no hay sklearn, matplotlib, for, etc.). Por eso, antes de mostrar una respuesta, el navegador **ejecuta cada bloque de código de la IA en una copia del cuaderno**. Si falla, le devuelve el error a la IA para que lo corrija (hasta 2 veces) y marca cada bloque con «✓ probado en el laboratorio», «esqueleto: llena los espacios ___» o «⚠ no funcionó aquí» con el motivo. Los datos reales del estudiante no se modifican durante la prueba.

## Cómo se identifica a cada estudiante
No se usa la dirección IP: en el wifi de un salón todos comparten la misma, y los celulares la cambian a cada rato. En su lugar:
- El nombre o código que escribe el estudiante se **normaliza** en el servidor (sin tildes, mayúsculas ni espacios de más), así «Ana Pérez», «ana perez» y «ANA  PEREZ» cuentan como la misma persona.
- Tras el primer envío, el nombre queda **fijo en ese dispositivo** (botón «Cambiar» si se equivocó) y cada envío lleva además un identificador del dispositivo, que va en el CSV por si dos personas escribieron el mismo nombre.
- Recomendación práctica: pídeles que usen siempre el mismo dato, idealmente el código de estudiante.

## Probar en tu computador (opcional)
```
cp .env.ejemplo .env     # y edita las claves
node dev-server.js       # http://localhost:3000
```
Sin Redis configurado, los veredictos se guardan en `laboratorio-veredictos.json` en esta carpeta (solo para pruebas; en Vercel ese archivo no persiste, por eso hace falta la base de datos).

## Cambiar de proveedor de IA
La función `api/preguntar.js` usa el formato de OpenAI. Para Groq o cualquier API compatible basta con definir `NVIDIA_BASE_URL` (p. ej. `https://api.groq.com/openai/v1/chat/completions`), `NVIDIA_API_KEY` con la clave de ese servicio y `NVIDIA_MODEL` con el nombre del modelo.

## Estructura
```
public/index.html     laboratorio (un solo archivo)
public/data/*.csv     bases limpias
public/profesor.html  panel de veredictos
api/ping.js           dice qué está configurado
api/modelos.js        lista los modelos de NVIDIA disponibles para tu clave
api/preguntar.js      proxy a NVIDIA con límites de uso
api/veredictos.js     guarda (POST) y lista (GET, con clave) los veredictos
api/_lib.js           Redis/archivo local y límites
dev-server.js         servidor local de prueba
```
