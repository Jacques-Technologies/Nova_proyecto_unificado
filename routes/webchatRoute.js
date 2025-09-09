// routes/webchatRoute.js
import { Router } from 'express';
import * as WebchatController from '../controllers/webchatController.js';

const router = Router();

// Conversación base
router.get('/init', WebchatController.init);
router.post('/ask', WebchatController.ask);
router.get('/history', WebchatController.history);
router.get('/stream', WebchatController.stream);

// NUEVO: borrar conversación actual
router.post('/clear', WebchatController.clear);

// NUEVO: multi-chat estilo ChatGPT
router.get('/conversations', WebchatController.conversations);                // listar
router.patch('/conversation/:id', WebchatController.renameConversation);     // renombrar
router.delete('/conversation/:id', WebchatController.deleteConversation);    // eliminar

// Opcional: health/status del stack
router.get('/status', WebchatController.status);

export default router;
