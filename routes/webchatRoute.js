// routes/webchatRoute.js
import { Router } from 'express';
import * as WebchatController from '../controllers/webchatController.js';

const router = Router();
router.get('/init', WebchatController.init);
router.post('/ask', WebchatController.ask);
router.get('/history', WebchatController.history);
router.get('/stream', WebchatController.stream);
export default router;
