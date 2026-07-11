import { Router } from 'express';
import { registerUser, loginUser, getProfile, getAllUsers, updateUserStatusRole, deleteUser } from '../controllers/users.controller';

export const usersRouter = Router();

usersRouter.post('/register', registerUser);
usersRouter.post('/login', loginUser);
usersRouter.get('/profile', getProfile);
usersRouter.get('/', getAllUsers);
usersRouter.patch('/:id/status', updateUserStatusRole);
usersRouter.delete('/:id', deleteUser);
