// src/routes/webchatRoute.js - RUTAS ACTUALIZADAS
import express from 'express';
import * as webchatController from '../controllers/webchatController.js';

const router = express.Router();

// Rutas WebChat principales
router.get('/init', webchatController.init);
router.post('/init', webchatController.init);

router.post('/ask', webchatController.ask);
router.get('/history', webchatController.history);

router.get('/stream', webchatController.stream);
router.post('/stream', webchatController.stream);

router.get('/status', webchatController.status);
router.post('/clear', webchatController.clear);

router.get('/conversations', webchatController.conversations);
router.patch('/conversation/:id', webchatController.renameConversation);

// Utilidades
router.get('/summary', webchatController.summary);

router.get('/verify-historial', webchatController.verifyHistorial);

// 🔍 Endpoints de debug (ordenados por nivel de detalle)
router.get('/debug', webchatController.debugToken);           // Debug básico
router.get('/deep-debug', webchatController.deepDebug);       // Debug intermedio  
router.get('/debug-complete', webchatController.debugComplete); // ✅ NUEVO: Debug completo con test de continuidad

export default router;