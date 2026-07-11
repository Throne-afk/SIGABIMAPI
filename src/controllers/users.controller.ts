import { Request, Response } from 'express';
import fs from 'fs';
import path from 'path';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

const USERS_FILE = path.join(process.cwd(), 'src', 'data', 'users.json');
const JWT_SECRET = process.env.JWT_SECRET || 'sigabim-super-secret-key-123';

const readUsers = (): any[] => {
  if (!fs.existsSync(USERS_FILE)) {
    const defaultAdminPasswordHash = '$2b$10$AVShbdSjHU8DLriu3eEzK.QBoabYfLORhmXbtfttum4jXb1bcQcu2'; // hash de 'admin123'
    const defaultUsers = [
      {
        id: 'f84b78e5-6a47-4453-b2e0-a853baa05f2b',
        nombre: 'Admin Master',
        email: 'admin@sigabim.com',
        telefono: '0000',
        status: 'aprobado',
        rol: 'admin',
        created_at: new Date().toISOString(),
        password: defaultAdminPasswordHash
      }
    ];
    const dir = path.dirname(USERS_FILE);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    fs.writeFileSync(USERS_FILE, JSON.stringify(defaultUsers, null, 2));
  }
  const data = fs.readFileSync(USERS_FILE, 'utf8');
  return data ? JSON.parse(data) : [];
};

// Helper: Guardar archivo JSON
const writeUsers = (users: any[]) => {
  fs.writeFileSync(USERS_FILE, JSON.stringify(users, null, 2));
};

/**
 * POST /api/users/register
 * Registra un nuevo usuario con estado "pendiente"
 */
export const registerUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { nombre, email, telefono, password } = req.body;
    
    if (!nombre || !email || !password) {
      res.status(400).json({ success: false, message: 'Faltan campos obligatorios' });
      return;
    }

    const users = readUsers();
    
    if (users.find(u => u.email === email)) {
      res.status(400).json({ success: false, message: 'El correo electrónico ya está registrado.' });
      return;
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const newUser = {
      id: uuidv4(),
      nombre,
      email,
      telefono,
      password: hashedPassword,
      status: 'pendiente', // pendiente, aprobado, denegado
      rol: 'editor', // administrador, editor
      created_at: new Date().toISOString()
    };

    users.push(newUser);
    writeUsers(users);

    res.status(201).json({ success: true, message: 'Solicitud de acceso enviada.', user: { id: newUser.id, email: newUser.email, status: newUser.status } });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * POST /api/users/login
 * Autentica y devuelve un JWT si está aprobado.
 */
export const loginUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { email, password } = req.body;
    
    const users = readUsers();
    const user = users.find(u => u.email === email);

    if (!user || !(await bcrypt.compare(password, user.password))) {
      res.status(401).json({ success: false, message: 'Credenciales incorrectas.' });
      return;
    }

    if (user.status !== 'aprobado') {
      res.status(403).json({ success: false, message: 'Su acceso fue denegado o sigue pendiente de aprobación.' });
      return;
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, rol: user.rol }, 
      JWT_SECRET, 
      { expiresIn: '8h' }
    );

    const userProfile = { id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono, status: user.status, rol: user.rol };
    res.status(200).json({ success: true, token, user: userProfile });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * GET /api/users/profile
 * Obtiene el perfil actual basado en JWT.
 */
export const getProfile = async (req: Request, res: Response): Promise<void> => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader) {
      res.status(401).json({ success: false, message: 'Falta autorización' }); return;
    }
    const token = authHeader.split(' ')[1];
    const decoded: any = jwt.verify(token, JWT_SECRET);

    const users = readUsers();
    const user = users.find(u => u.id === decoded.id);
    if (!user) {
      res.status(404).json({ success: false, message: 'Usuario no encontrado' }); return;
    }

    res.status(200).json({ success: true, user: { id: user.id, nombre: user.nombre, email: user.email, telefono: user.telefono, status: user.status, rol: user.rol } });
  } catch (err: any) {
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
};

/**
 * GET /api/users
 * Lista todos los usuarios (requeriría middleware de admin pero para simplificar lo exponemos)
 */
export const getAllUsers = async (req: Request, res: Response): Promise<void> => {
  try {
    const users = readUsers();
    const safeUsers = users.map(u => ({
      id: u.id,
      nombre: u.nombre,
      email: u.email,
      telefono: u.telefono,
      status: u.status,
      rol: u.rol,
      created_at: u.created_at
    }));
    res.status(200).json({ success: true, data: safeUsers });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * PATCH /api/users/:id/status
 * Aprueba o deniega y cambia el rol.
 */
export const updateUserStatusRole = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    const { status, rol } = req.body;
    
    const users = readUsers();
    const index = users.findIndex(u => u.id === id);

    if (index === -1) {
      res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
      return;
    }

    if (status) users[index].status = status;
    if (rol) users[index].rol = rol;

    writeUsers(users);
    res.status(200).json({ success: true, message: 'Usuario actualizado con éxito.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};

/**
 * DELETE /api/users/:id
 * Elimina permanentemente a un usuario.
 */
export const deleteUser = async (req: Request, res: Response): Promise<void> => {
  try {
    const { id } = req.params;
    
    let users = readUsers();
    const initialLen = users.length;
    users = users.filter(u => u.id !== id);

    if (users.length === initialLen) {
      res.status(404).json({ success: false, message: 'Usuario no encontrado.' });
      return;
    }

    writeUsers(users);
    res.status(200).json({ success: true, message: 'Usuario eliminado permanentemente.' });
  } catch (err: any) {
    res.status(500).json({ success: false, message: err.message });
  }
};
