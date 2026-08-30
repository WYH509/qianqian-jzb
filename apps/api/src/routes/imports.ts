import { Router } from 'express';
import multer from 'multer';
import { authMiddleware } from '../middleware/auth.js';
import {
  importPreview,
  importConfirm,
  listImportHistory,
  rollbackImport,
  aiParse,
} from '../controllers/imports.js';

export const importRoutes = Router();

importRoutes.use(authMiddleware);

// multer 内存存储（不大于 10MB）
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// --- POST /api/v1/import/preview（PRD §14.6） ---
importRoutes.post('/preview', upload.single('file'), importPreview);

// --- POST /api/v1/import/confirm（PRD §14.6） ---
importRoutes.post('/confirm', importConfirm);

// --- GET /api/v1/import/history（PRD §14.6） ---
importRoutes.get('/history', listImportHistory);

// --- POST /api/v1/import/ai-parse（PRD §14.6，TP-08 实现） ---
importRoutes.post('/ai-parse', upload.single('file'), aiParse);

// --- POST /api/v1/import/:id/rollback（PRD §14.6） ---
importRoutes.post('/:id/rollback', rollbackImport);