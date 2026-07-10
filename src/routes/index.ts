import { Router } from 'express';
import { inventarioRouter } from './inventario.routes';

export const router = Router();

// ─── Sub-rutas ─────────────────────────────────────────────────────────────────
router.use('/inventarios', inventarioRouter);

// ─── API Info ──────────────────────────────────────────────────────────────────
router.get('/', (_req, res) => {
  res.json({
    name: 'SIGABIM API',
    version: '1.0.0',
    endpoints: {
      inventarios: '/api/inventarios',
      upload: 'POST /api/inventarios/upload',
    },
  });
});
