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
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // ✅ Chat web (modular)
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

  // ✅ Endpoint de salud
  app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
  });

  // Arranque del servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`📨 Endpoint Teams: http://localhost:${PORT}/api/messages`);
    console.log(`📄 Endpoints PDF/Word: POST http://localhost:${PORT}/api/sendPdf | /api/sendWord`);
    console.log(`💬 Endpoints Webchat: 
       - POST http://localhost:${PORT}/api/webchat/ask 
       - GET  http://localhost:${PORT}/api/webchat/init 
       - GET  http://localhost:${PORT}/api/webchat/history 
       - GET  http://localhost:${PORT}/api/webchat/stream`);
  });
}

startServer().catch((err) => {
  console.error('❌ Error al iniciar el servidor:', err);
  process.exit(1);
});
