# SIGABIM API — Backend

> **Node.js + Express + TypeScript**  
> Desplegado en **Render** · Base de datos en **Supabase** (PostgreSQL)

---

## Índice

1. [Requisitos](#1-requisitos)
2. [Estructura del proyecto](#2-estructura-del-proyecto)
3. [Configuración de Supabase](#3-configuración-de-supabase)
4. [Instalación local](#4-instalación-local)
5. [Variables de entorno](#5-variables-de-entorno)
6. [Comandos disponibles](#6-comandos-disponibles)
7. [Referencia de la API](#7-referencia-de-la-api)
8. [Despliegue en Render](#8-despliegue-en-render)
9. [Consideraciones de producción](#9-consideraciones-de-producción)

---

## 1. Requisitos

| Herramienta | Versión mínima |
|---|---|
| Node.js | **18.x** o superior |
| npm | **9.x** o superior |
| Cuenta en [Supabase](https://supabase.com) | Gratis |
| Cuenta en [Render](https://render.com) | Gratis |

---

## 2. Estructura del proyecto

```
SIGABIM_API/
├── src/
│   ├── controllers/
│   │   └── inventario.controller.ts  ← Lógica: parseo Excel + Supabase + paginación
│   ├── lib/
│   │   ├── supabase.ts               ← Cliente Supabase (SERVICE_KEY)
│   │   └── supabase-schema.sql       ← Script SQL para crear las tablas
│   ├── middleware/
│   │   └── upload.ts                 ← Multer (memoryStorage, límite 50 MB)
│   ├── routes/
│   │   ├── index.ts
│   │   └── inventario.routes.ts      ← Definición de endpoints
│   └── index.ts                      ← Entry point: Express + CORS + middlewares
├── uploads/                          ← Directorio temporal (solo desarrollo)
├── Dockerfile
├── tsconfig.json
├── .env                              ← Variables locales (NO subir a git)
└── .env.example                      ← Plantilla de variables
```

---

## 3. Configuración de Supabase

> Este paso es **obligatorio** antes de poder usar la API.

### 3.1 Crear el proyecto en Supabase

1. Ve a [app.supabase.com](https://app.supabase.com) → **New Project**
2. Elige nombre, contraseña y región (preferiblemente `us-east-1` o la más cercana)
3. Espera a que el proyecto se inicialice (~2 minutos)

### 3.2 Ejecutar el schema de base de datos

1. En el panel de Supabase ve a **SQL Editor** → **New Query**
2. Copia y pega el contenido completo de [`src/lib/supabase-schema.sql`](src/lib/supabase-schema.sql)
3. Haz clic en **Run** (▶)

Esto crea las tablas:

| Tabla | Propósito |
|---|---|
| `inventarios` | Metadatos de cada archivo Excel importado |
| `inventario_registros` | Filas del Excel (paginadas, con índice por `fila_num`) |

### 3.3 Obtener las credenciales

En Supabase ve a **Settings → API**:

| Variable | Dónde encontrarla |
|---|---|
| `SUPABASE_URL` | **Project URL** (ej. `https://xxxx.supabase.co`) |
| `SUPABASE_SERVICE_KEY` | **service_role** secret key (NO la `anon` key) |

> ⚠️ Usa **siempre** la `service_role` key en el backend, nunca la `anon` key. La `service_role` omite Row Level Security y tiene acceso completo.

---

## 4. Instalación local

```bash
# 1. Entra a la carpeta del backend
cd SIGABIM_API

# 2. Instala las dependencias
npm install

# 3. Copia el archivo de ejemplo de variables de entorno
copy .env.example .env        # Windows
# cp .env.example .env        # Mac/Linux

# 4. Edita el .env con tus credenciales de Supabase (ver sección 5)

# 5. Inicia el servidor de desarrollo con hot-reload
npm run dev
```

El servidor estará disponible en **http://localhost:3001**

Verifica que funciona:
```bash
curl http://localhost:3001/health
# Respuesta esperada: { "status": "ok", "service": "SIGABIM API", ... }
```

---

## 5. Variables de entorno

Crea un archivo `.env` en la raíz de `SIGABIM_API/` con el siguiente contenido:

```env
# Puerto del servidor (Render lo asigna automáticamente en producción)
PORT=3001

# Entorno
NODE_ENV=development

# URL del frontend (para CORS)
# Desarrollo: http://localhost:5173
# Producción: https://tu-app.vercel.app
CORS_ORIGIN=http://localhost:5173

# ── Supabase ─────────────────────────────────────────────────────────────────
# Obtener en: https://app.supabase.com → Tu proyecto → Settings → API
SUPABASE_URL=https://xxxxxxxxxxxxxxxx.supabase.co
SUPABASE_SERVICE_KEY=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9...
```

> ⚠️ **NUNCA subas el `.env` a Git.** El archivo `.gitignore` ya lo excluye por defecto. Usa `.env.example` para documentar las variables sin valores reales.

---

## 6. Comandos disponibles

```bash
# Desarrollo con hot-reload (ts-node-dev)
npm run dev

# Compilar TypeScript a JavaScript en dist/
npm run build

# Ejecutar el build compilado (producción)
npm start
```

---

## 7. Referencia de la API

Base URL local: `http://localhost:3001/api`

### Health check

```
GET /health
```
```json
{ "status": "ok", "service": "SIGABIM API", "version": "1.0.0" }
```

---

### Inventarios

#### Listar todos (solo metadatos)
```
GET /api/inventarios
```
```json
{
  "success": true,
  "data": [
    {
      "id": "inv_1720000000000",
      "archivo": "inventario_2024.xlsx",
      "hoja": "Hoja1",
      "fechaImportacion": "2024-07-06T18:00:00.000Z",
      "cabeceras": ["Código", "Descripción", "..."],
      "totalRegistros": 34521
    }
  ]
}
```

---

#### Subir archivo Excel
```
POST /api/inventarios/upload
Content-Type: multipart/form-data

Campo:  file        → archivo .xlsx o .xls (máx. 50 MB)
Campo:  sheetIndex  → número de hoja (0 = primera, opcional)
```

**Estructura esperada del Excel:**

| Columna 1 | Columna 2 | Columna 3+ |
|---|---|---|
| Sección | Categoría | *metadatos (filas 1-2, se ignoran)* |
| Sección | Categoría | **Encabezados (fila 3)** |
| Sección | Categoría | Datos (fila 4 en adelante) |

```json
{
  "success": true,
  "message": "Archivo procesado correctamente. 34521 registro(s) importado(s).",
  "data": { "id": "inv_...", "totalRegistros": 34521, ... }
}
```

---

#### Obtener página de registros (scroll infinito)
```
GET /api/inventarios/:id/rows?page=1&limit=100
```

| Parámetro | Tipo | Default | Máximo |
|---|---|---|---|
| `page` | number | 1 | — |
| `limit` | number | 100 | 500 |

```json
{
  "success": true,
  "data": {
    "registros": [
      {
        "seccion": "Estructura",
        "categoria": "Columnas",
        "datos": { "Código": "E-001", "Descripción": "Columna HEB-200", ... }
      }
    ],
    "page": 1,
    "limit": 100,
    "totalRegistros": 34521,
    "hasMore": true
  }
}
```

---

#### Obtener metadatos de un inventario
```
GET /api/inventarios/:id
```

---

#### Eliminar inventario
```
DELETE /api/inventarios/:id
```
Elimina el inventario y todos sus registros en cascada (via `ON DELETE CASCADE` en Supabase).

---

## 8. Despliegue en Render

### 8.1 Preparar el repositorio

Sube la carpeta `SIGABIM_API/` a su propio repositorio de GitHub.

Asegúrate de que el `.gitignore` incluya:
```
node_modules/
dist/
.env
uploads/
```

### 8.2 Crear el servicio en Render

1. Ve a [render.com](https://render.com) → **New** → **Web Service**
2. Conecta tu repositorio de GitHub (`SIGABIM_API`)
3. Configura el servicio:

   | Campo | Valor |
   |---|---|
   | **Name** | `sigabim-api` (o el que prefieras) |
   | **Environment** | `Node` |
   | **Region** | La más cercana a tu Supabase |
   | **Branch** | `main` |
   | **Build Command** | `npm install && npm run build` |
   | **Start Command** | `npm start` |
   | **Plan** | Free (o el que necesites) |

### 8.3 Configurar variables de entorno en Render

En el servicio → **Environment** → agrega cada variable:

| Variable | Valor |
|---|---|
| `NODE_ENV` | `production` |
| `SUPABASE_URL` | `https://xxxx.supabase.co` |
| `SUPABASE_SERVICE_KEY` | `eyJ...` (tu service_role key) |
| `CORS_ORIGIN` | `https://tu-app.vercel.app` |

> ℹ️ `PORT` **no** necesitas configurarla — Render la asigna automáticamente.

### 8.4 Deploy

Haz clic en **Create Web Service**. Render instalará dependencias, compilará TypeScript y arrancará el servidor.

La URL de tu API será algo como: `https://sigabim-api.onrender.com`

Verifica: `https://sigabim-api.onrender.com/health`

> ⚠️ En el plan gratuito de Render, el servicio se **suspende tras 15 minutos de inactividad** y tarda ~30 segundos en despertar en la primera petición. Para producción real considera el plan pago.

---

## 9. Consideraciones de producción

### Sistema de archivos efímero
Render **no** tiene sistema de archivos persistente. Por eso:
- El upload usa `memoryStorage` (el Excel nunca se escribe en disco)
- Todos los datos se guardan en **Supabase** (PostgreSQL), que sí persiste

### Archivos Excel grandes (34k+ filas)
El controlador usa **batch inserts de 500 filas** para insertar los registros en Supabase sin exceder los límites de payload. Para un Excel de 34,000 filas se realizan ~68 inserts en secuencia.

Tiempo esperado de procesamiento:
| Tamaño | Tiempo aprox. |
|---|---|
| 5,000 filas | ~3–5 segundos |
| 15,000 filas | ~8–12 segundos |
| 34,000 filas | ~20–35 segundos |

### CORS
La variable `CORS_ORIGIN` debe ser exactamente la URL de tu frontend en Vercel (sin barra final):
```
CORS_ORIGIN=https://sigabim.vercel.app   ✅
CORS_ORIGIN=https://sigabim.vercel.app/  ❌
```

### Límites de tamaño
| Límite | Valor |
|---|---|
| Tamaño máximo de archivo Excel | 50 MB |
| Body JSON máximo | 100 MB |
| Filas por batch insert | 500 |
| Máximo de filas por página (API) | 500 |

---

## Dependencias principales

| Paquete | Versión | Propósito |
|---|---|---|
| `express` | ^4.18.2 | Framework HTTP |
| `@supabase/supabase-js` | latest | Cliente de base de datos |
| `xlsx` | ^0.18.5 | Parseo de archivos Excel |
| `multer` | ^1.4.5 | Upload de archivos (memoryStorage) |
| `cors` | ^2.8.5 | Cabeceras CORS |
| `morgan` | ^1.10.0 | Logging de peticiones HTTP |
| `dotenv` | ^16.3.1 | Carga de variables de entorno |
| `typescript` | ^5.3.3 | Tipado estático |
| `ts-node-dev` | ^2.0.0 | Hot-reload en desarrollo |
