// routes/webchatRoute.js - v3.0 SIMPLIFICADO
// Solo rutas con implementación en webchatController.js
import express from 'express';
import * as webchatController from '../controllers/webchatController.js';

const router = express.Router();

// ============================================================
// RUTAS PRINCIPALES - WebChat API v3.0
// ============================================================

// Inicializar chat (devuelve mensaje de bienvenida)
router.get('/init', webchatController.init);
router.post('/init', webchatController.init);

// Procesar mensaje del usuario
router.post('/ask', webchatController.ask);

// Obtener historial de mensajes
router.get('/history', webchatController.history);

// Limpiar historial
router.post('/clear', webchatController.clear);
router.delete('/clear', webchatController.clear);

// Estado de los servicios
router.get('/status', webchatController.status);

export default router;