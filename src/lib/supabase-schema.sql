-- ============================================================
-- SIGABIM — Schema de base de datos en Supabase (PostgreSQL)
-- Ejecutar este script en el SQL Editor de Supabase
-- ============================================================

-- ─── Tabla de inventarios (metadatos) ─────────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventarios (
  id                TEXT PRIMARY KEY,
  archivo           TEXT        NOT NULL,
  hoja              TEXT        NOT NULL,
  fecha_importacion TIMESTAMPTZ NOT NULL,
  cabeceras         JSONB       NOT NULL,  -- string[]
  total_registros   INTEGER     NOT NULL DEFAULT 0,
  created_at        TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tabla de registros (datos paginados) ─────────────────────────────────────
CREATE TABLE IF NOT EXISTS inventario_registros (
  id             BIGSERIAL   PRIMARY KEY,
  inventario_id  TEXT        NOT NULL REFERENCES inventarios(id) ON DELETE CASCADE,
  fila_num       INTEGER     NOT NULL,  -- orden original del Excel (1-indexed)
  seccion        TEXT,
  categoria      TEXT,
  datos          JSONB       NOT NULL   -- { [cabecera]: valor }
);

-- ─── Índices para búsqueda y paginación rápida ────────────────────────────────
CREATE INDEX IF NOT EXISTS idx_registros_inventario_id
  ON inventario_registros (inventario_id);

CREATE INDEX IF NOT EXISTS idx_registros_paginacion
  ON inventario_registros (inventario_id, fila_num);

-- ─── Habilitar Row Level Security (opcional pero recomendado) ─────────────────
-- Las tablas solo serán accesibles desde el backend usando el service_role key,
-- por lo que RLS no bloqueará nada al usar SERVICE_KEY.
ALTER TABLE inventarios          ENABLE ROW LEVEL SECURITY;
ALTER TABLE inventario_registros ENABLE ROW LEVEL SECURITY;

-- Política que permite todo con service_role (backend)
-- (El service_role siempre omite RLS, pero dejamos esto para claridad)
CREATE POLICY "service_role_all" ON inventarios
  FOR ALL USING (true);

CREATE POLICY "service_role_all" ON inventario_registros
  FOR ALL USING (true);

-- ─── Tabla de Bitácora (Auditoría) ────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS bitacora (
  id             BIGSERIAL   PRIMARY KEY,
  usuario_id     TEXT        NOT NULL,
  usuario_nombre TEXT        NOT NULL,
  accion         TEXT        NOT NULL, -- Ej: 'CREAR', 'EDITAR', 'ELIMINAR'
  entidad        TEXT        NOT NULL, -- Ej: 'Inventario', 'Bien Mueble'
  entidad_id     TEXT,                 -- ID del registro afectado
  detalles       JSONB,                -- JSON con los cambios o la info
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ─── Tabla de Notificaciones ──────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS notificaciones (
  id             BIGSERIAL   PRIMARY KEY,
  bitacora_id    BIGINT      REFERENCES bitacora(id) ON DELETE CASCADE,
  mensaje        TEXT        NOT NULL,
  leida          BOOLEAN     NOT NULL DEFAULT FALSE,
  created_at     TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- Índices
CREATE INDEX IF NOT EXISTS idx_bitacora_created_at ON bitacora (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notificaciones_leida ON notificaciones (leida, created_at DESC);

-- Permisos
ALTER TABLE bitacora ENABLE ROW LEVEL SECURITY;
ALTER TABLE notificaciones ENABLE ROW LEVEL SECURITY;
CREATE POLICY "service_role_all" ON bitacora FOR ALL USING (true);
CREATE POLICY "service_role_all" ON notificaciones FOR ALL USING (true);
