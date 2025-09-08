import express from 'express';
import cors from 'cors';

import {
  CloudAdapter,
  ConfigurationBotFrameworkAuthentication,
  MemoryStorage,
  ConversationState,
  UserState
} from 'botbuilder';

import TeamsBot  from './bots/teamsBot.js';
import ConversationService from './services/conversationService.js';
import CosmosService from './services/cosmosService.js';
import AzureOpenAIService from './services/openaiService.js';

const cosmosService = new CosmosService();
const conversationServiceInstance = new ConversationService();
const openaiServiceInstance = new AzureOpenAIService();
/**
 * Arranca el servidor Express y registra todas las rutas.  Se emplea
 * una función asincrónica para poder utilizar `await import()` con
 * módulos ES (por ejemplo, las rutas del backend de procesamiento de
 * documentos).  Cualquier error durante la inicialización provocará
 * que se imprima en consola y se cierre el proceso.
 */
async function startServer() {
  // Importar dinámicamente las rutas de PDF y Word desde el backend.  Al
  // utilizar dynamic import nos evitamos convertir los módulos ES a
  // CommonJS y se mantiene la compatibilidad con las versiones
  // originales del backend.
  const { pdfRoutes } = await import('./backend/routes/pdf.routes.js');
  const { wordRoutes } = await import('./backend/routes/wordRoutes.routes.js');

  // Crear servidor Express y aplicar middlewares
  const app = express();
  app.use(cors());
  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));

  // Registrar rutas de subida y procesamiento de documentos bajo /api
  app.use('/api', pdfRoutes);
  app.use('/api', wordRoutes);

  // Configurar Bot Framework para Teams
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

  /**
   * Endpoint de chat web.  Permite interactuar con el bot mediante
   * solicitudes HTTP (por ejemplo, desde una aplicación web).  El
   * cliente debe enviar un objeto JSON con `conversationId`, `userId`,
   * `userName` y `message`.  Se persiste el mensaje del usuario,
   * se recupera el historial de conversación, se genera la respuesta
   * usando Azure OpenAI y se almacena el mensaje del bot.  El flujo
   * replica la lógica utilizada por TeamsBot, aprovechando los
   * servicios `conversationService`, `cosmosService` y
   * `openaiService` existentes.
   */
  app.post('/api/webchat', async (req, res) => {
    try {
      const { conversationId, userId, userName, message } = req.body;
      if (!conversationId || !userId || !message) {
        return res.status(400).json({
          error: 'Faltan campos obligatorios (conversationId, userId, message)'
        });
      }
      const name = userName || 'Usuario';

      // Crear la conversación si no existe
      const convInfo = await conversationService.getConversationInfo(conversationId);
      if (!convInfo) {
        await conversationService.createConversation(conversationId, userId);
      }

      // Registrar el mensaje del usuario en memoria y en Cosmos DB (si está disponible)
      await conversationService.saveMessage(message, conversationId, userId);
      if (cosmosService.isAvailable && cosmosService.isAvailable()) {
        await cosmosService.saveMessage(message, conversationId, userId, name, 'user');
      }

      // Obtener el historial reciente (últimos 10 mensajes) y formatearlo
      const history = await conversationService.getConversationHistory(conversationId, 10);
      const formattedHistory = history.map((msg) => {
        const role = msg.type === 'assistant' || msg.type === 'bot' ? 'assistant' : 'user';
        return { role, content: msg.message };
      });

      // Construir información del usuario para OpenAI
      const userInfo = { usuario: userId, nombre: name };

      // Procesar mensaje con Azure OpenAI a través de nuestro servicio
      const respuesta = await openaiService.procesarMensaje(
        message,
        formattedHistory,
        null,
        userInfo,
        conversationId
      );

      // Extraer contenido de la respuesta devuelta por OpenAI
      let replyContent = '';
      if (respuesta) {
        if (typeof respuesta === 'string') {
          replyContent = respuesta;
        } else if (respuesta.content) {
          replyContent = respuesta.content;
        } else if (respuesta.type === 'text' && respuesta.content) {
          replyContent = respuesta.content;
        }
      }
      replyContent = replyContent || 'Respuesta vacía';

      // Guardar respuesta del bot tanto en memoria como en Cosmos DB
      await conversationService.saveMessage(replyContent, conversationId, 'bot');
      if (cosmosService.isAvailable && cosmosService.isAvailable()) {
        await cosmosService.saveMessage(replyContent, conversationId, userId, name, 'bot');
      }

      // Devolver la respuesta al cliente
      return res.json({ reply: replyContent });
    } catch (err) {
      console.error('❌ Error en /api/webchat:', err);
      return res.status(500).json({ error: 'Error interno del servidor', details: err.message });
    }
  });

  // Endpoint de salud.  Devuelve un JSON sencillo para monitoreo.
  app.get('/health', (req, res) => {
    res.json({ status: 'OK' });
  });

  // Iniciar el servidor
  app.listen(PORT, () => {
    console.log(`🚀 Servidor iniciado en puerto ${PORT}`);
    console.log(`📨 Endpoint Teams: http://localhost:${PORT}/api/messages`);
    console.log(`📄 Endpoints PDF/Word: POST http://localhost:${PORT}/api/sendPdf | /api/sendWord`);
    console.log(`💬 Endpoint webchat: POST http://localhost:${PORT}/api/webchat`);
  });
}

// Ejecutar la inicialización.  Captura errores no manejados durante el
// arranque para evitar que pasen desapercibidos.
startServer().catch((err) => {
  console.error('❌ Error al iniciar el servidor:', err);
  process.exit(1);
});