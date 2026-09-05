import { Router } from 'express';
import { z } from 'zod';
import { login, logout } from '../controllers/auth.js';
import { authMiddleware } from '../middleware/auth.js';
import { loginLimiter } from '../middleware/rate-limit.js';
import { AppError } from '../middleware/error-handler.js';

export const authRoutes = Router();

// --- POST /api/v1/auth/login ---
// Zod validation inline
authRoutes.post('/login', loginLimiter, (req, res, next) => {
  const result = z
    .object({
      username: z.string().min(1, 'username is required').max(50),
      password: z.string().min(1, 'password is required').max(200),
    })
    .safeParse(req.body);

  if (!result.success) {
    const err = result.error.errors[0];
    next(new AppError(400, 'ERR0001', err ? err.message : 'Invalid request body'));
    return;
  }

  next();
}, login);

// --- POST /api/v1/auth/logout (protected) ---
authRoutes.post('/logout', authMiddleware, logout);
