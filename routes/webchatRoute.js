// routes/webchatRoute.js
import { Router } from 'express';
import * as WebchatController from '../controllers/webchatController.js';

const router = Router();

// Conversación base
router.get('/init', WebchatController.init);
router.post('/ask', WebchatController.ask);
router.get('/history', WebchatController.history);
router.get('/stream', WebchatController.stream);

// Limpiar conversación actual (borra mensajes pero mantiene la conversación)
router.post('/clear', WebchatController.clear);

// Multi-chat estilo ChatGPT (sin eliminación)
router.get('/conversations', WebchatController.conversations);           // listar por token
router.patch('/conversation/:id', WebchatController.renameConversation); // renombrar
// routes/webchat.js
router.get('/webchat/summary', webchatController.summary);


// Opcional: health/status del stack
router.get('/status', WebchatController.status);

export default router;