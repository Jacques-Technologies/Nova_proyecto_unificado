// src/routes/webchatRoute.js
import express from 'express';
import * as webchatController from '../controllers/webchatController.js';

const router = express.Router();

// Rutas WebChat (solo los endpoints, sin repetir /webchat)
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

// ➕ resumen
router.get('/summary', webchatController.summary);

export default router;
