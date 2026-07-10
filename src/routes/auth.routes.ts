import { Router } from 'express';
import { updateUserStatus } from '../controllers/auth.controller';

export const authRouter = Router();

// PATCH /api/auth/users/:id/status — Aprobar o denegar un usuario
authRouter.patch('/users/:id/status', updateUserStatus);
