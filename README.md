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
| `NVIDIA_MODEL` | no | por defecto `meta/llama-3.1-70b-instruct` |
| `NVIDIA_MODEL_QUICK` | no | modelo para «¿Qué hace?» (más rápido); por defecto `meta/llama-3.1-8b-instruct` |
| `LIMITE_POR_MINUTO` | no | consultas de IA por minuto por persona (15) |
| `LIMITE_POR_DIA` | no | consultas de IA por día para toda la clase (1500) |

Después de guardar variables, haz **Redeploy** (Deployments → ⋯ → Redeploy) para que apliquen.

### 5. Probar
- Abre `https://tu-proyecto.vercel.app` → pestaña **Analista IA** debe mostrar el chat (si falta la clave, muestra un aviso).
- Escribe un nombre en «Tu nombre o código», un veredicto, y pulsa **Enviar al profesor**.
- Abre `https://tu-proyecto.vercel.app/profesor.html`, escribe `CLAVE_PROFESOR` → debe aparecer el veredicto. **Descargar CSV** baja el historial completo.

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
api/preguntar.js      proxy a NVIDIA con límites de uso
api/veredictos.js     guarda (POST) y lista (GET, con clave) los veredictos
api/_lib.js           Redis/archivo local y límites
dev-server.js         servidor local de prueba
```
