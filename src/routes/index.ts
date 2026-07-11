import { Router } from 'express';
import { inventarioRouter } from './inventario.routes';
import { authRouter } from './auth.routes';
import { usersRouter } from './users.routes';

export const router = Router();

// ─── Sub-rutas ─────────────────────────────────────────────────────────────────
router.use('/inventarios', inventarioRouter);
router.use('/auth', authRouter);
router.use('/users', usersRouter);

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
