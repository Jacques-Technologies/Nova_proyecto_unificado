import express from 'express';
import cors from 'cors';

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  MemoryStorage,
  ConversationState,
  UserState
} from 'botbuilder';

import TeamsBot from './bots/teamsBot.js';
import CosmosService from './services/cosmosService.js';
import ConversationService from './services/conversationService.js';
import AzureOpenAIService from './services/openaiService.js';

// Inicialización de servicios
const cosmosService = new CosmosService();
const conversationService = new ConversationService();
const openaiService = new AzureOpenAIService();

async function startServer() {
  // Rutas dinámicas de PDF y Word
  const { pdfRoutes } = await import('./backend/routes/pdf.routes.js');
  const { wordRoutes } = await import('./backend/routes/wordRoutes.routes.js');
  
  // Rutas de chat web (init, ask, history, stream)
  const { default: webchatRoute } = await import('./routes/webchatRoute.js');
  
  const app = express();
  
  // ✅ CORS configurado correctamente para producción
  app.use(cors({
    origin: [
      'https://frontendnova.onrender.com'  // Tu frontend en producción
    ],
    credentials: true,
    methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type', 
      'Authorization', 
      'x-requested-with',
      'Accept',
      'Origin'
    ]
  }));

  // Middlewares básicos
  app.use(express.json({ limit: '10mb' }));
  app.use(express.urlencoded({ extended: true, limit: '10mb' }));

  // ✅ Logging middleware para debugging
  app.use((req, res, next) => {
    const origin = req.get('Origin') || 'No Origin';
    console.log(`📝 ${req.method} ${req.path} - Origin: ${origin}`);
    next();
  });

  // ✅ Chat web (modular) - CORREGIDO: /api/webchat
  app.use('/api/webchat', webchatRoute);
  
  // ✅ Rutas de documentos
  app.use('/api', pdfRoutes);
  app.use('/api', wordRoutes);
  
  // ✅ Configuración Bot Framework para Teams
  const PORT = process.env.PORT || 3978;
  const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MicrosoftAppId,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword,
    MicrosoftAppType: process.env.MicrosoftAppType || 'SingleTenant',
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
  });
  
  const adapter = new CloudAdapter(botFrameworkAuthentication);
  adapter.onTurnError = async (context, error) => {
    console.error('❌ Turn error:', error);
    await context.sendActivity('Lo siento, ocurrió un error procesando tu solicitud.');
  };
  
  const storage = new MemoryStorage();
  const conversationState = new ConversationState(storage);
  const userState = new UserState(storage);
  const bot = new TeamsBot(conversationState, userState);
  
  // Endpoint de mensajes para Microsoft Teams
  app.post('/api/messages', async (req, res) => {
    try {
      await adapter.process(req, res, (context) => bot.run(context));
    } catch (err) {
      console.error('❌ Error procesando mensaje del adaptador:', err);
      res.status(500).send({ error: 'Error interno del bot' });
    }
  });
  
  // ✅ Endpoint de salud mejorado
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development'
    });
  });

  // ✅ Endpoint para verificar CORS
  app.get('/api/cors-test', (req, res) => {
    res.json({ 
      message: 'CORS funcionando correctamente',
      origin: req.get('Origin'),
      timestamp: new Date().toISOString()
    });
  });

  // ✅ Manejo de errores global
  app.use((err, req, res, next) => {
    console.error('❌ Error no manejado:', err);
    res.status(500).json({ 
      error: 'Error interno del servidor',
      message: err.message 
    });
  });

  // ✅ Ruta 404 para debugging
  app.use('*', (req, res) => {
    console.log(`❌ Ruta no encontrada: ${req.method} ${req.originalUrl}`);
    res.status(404).json({ 
      error: 'Ruta no encontrada',
      path: req.originalUrl,
      method: req.method 
    });
  });
  
  // Arranque del servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`🌐 Frontend permitido: https://frontendnova.onrender.com`);
    console.log(`📨 Endpoint Teams: http://localhost:${PORT}/api/messages`);
    console.log(`📄 Endpoints PDF/Word: POST http://localhost:${PORT}/api/sendPdf | /api/sendWord`);
    console.log(`💬 Endpoints Webchat:`);
    console.log(`    - POST http://localhost:${PORT}/api/webchat/init`);
    console.log(`    - POST http://localhost:${PORT}/api/webchat/ask`);
    console.log(`    - GET  http://localhost:${PORT}/api/webchat/history`);
    console.log(`    - GET  http://localhost:${PORT}/api/webchat/stream`);
    console.log(`🔍 Test CORS: GET http://localhost:${PORT}/api/cors-test`);
    console.log(`❤️  Health: GET http://localhost:${PORT}/health`);
  });
}

startServer().catch((err) => {
  console.error('❌ Error al iniciar el servidor:', err);
  process.exit(1);
});