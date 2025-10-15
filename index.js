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
import AzureOpenAIService from './services/openaiService.js';

// Inicialización de servicios
const cosmosService = new CosmosService();
const openaiService = new AzureOpenAIService();

// ✅ CONFIGURACIÓN MULTI-BOT
const BOT_CONFIGS = [
  {
    id: 'bot1',
    name: 'Nova Bot Principal',
    endpoint: '/api/messages', // Bot principal mantiene ruta original
    appId: process.env.MicrosoftAppId,
    appPassword: process.env.MicrosoftAppPassword,
    appType: process.env.MicrosoftAppType || 'SingleTenant',
    tenantId: process.env.MicrosoftAppTenantId
  },
  {
    id: 'bot2',
    name: 'Nova Bot 2',
    endpoint: '/api/messages/bot',
    appId: process.env.MicrosoftAppId_Bot2,
    appPassword: process.env.MicrosoftAppPassword_Bot2,
    appType: process.env.MicrosoftAppType_Bot2 || 'SingleTenant',
    tenantId: process.env.MicrosoftAppTenantId // Mismo tenant
  },
  {
    id: 'bot3',
    name: 'Nova Bot 3',
    endpoint: '/api/messages/bot2',
    appId: process.env.MicrosoftAppId_Bot3,
    appPassword: process.env.MicrosoftAppPassword_Bot3,
    appType: process.env.MicrosoftAppType_Bot3 || 'SingleTenant',
    tenantId: process.env.MicrosoftAppTenantId // Mismo tenant
  }
  // Puedes agregar más bots aquí siguiendo el patrón
];

// ✅ FUNCIÓN PARA CREAR ADAPTADOR Y BOT
function createBotInstance(config) {
  console.log(`🤖 Creando bot: ${config.name} (${config.id})`);
  
  // Validar configuración
  if (!config.appId || !config.appPassword) {
    console.warn(`⚠️ Bot ${config.id} no configurado - falta AppId o AppPassword`);
    return null;
  }

  try {
    // Crear autenticación específica para este bot
    const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
      MicrosoftAppId: config.appId,
      MicrosoftAppPassword: config.appPassword,
      MicrosoftAppType: config.appType,
      MicrosoftAppTenantId: config.tenantId
    });

    // Crear adaptador específico
    const adapter = new CloudAdapter(botFrameworkAuthentication);
    adapter.onTurnError = async (context, error) => {
      console.error(`❌ Error en ${config.name}:`, error);
      await context.sendActivity('Lo siento, ocurrió un error procesando tu solicitud.');
    };

    // Crear estados específicos (pueden ser compartidos o separados según necesites)
    const storage = new MemoryStorage();
    const conversationState = new ConversationState(storage);
    const userState = new UserState(storage);
    
    // Crear instancia del bot
    const bot = new TeamsBot(conversationState, userState);

    return {
      config,
      adapter,
      bot,
      conversationState,
      userState
    };

  } catch (error) {
    console.error(`❌ Error creando bot ${config.id}:`, error);
    return null;
  }
}

async function startServer() {
  // Rutas dinámicas de PDF y Word
  const { pdfRoutes } = await import('./backend/routes/pdf.routes.js');
  const { wordRoutes } = await import('./backend/routes/wordRoutes.routes.js');
  
  // Rutas de chat web (init, ask, history, clear, status)
  const { default: webchatRoute } = await import('./routes/webchatRoute.js');
  
  const app = express();
  
  // ✅ CORS configurado para permitir cualquier origen
  app.use(cors({
    origin: '*',
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
  
  // ✅ CREAR INSTANCIAS DE BOTS
  const activeBots = [];
  const botInstances = new Map();

  console.log('🚀 Inicializando bots...');
  
  for (const config of BOT_CONFIGS) {
    const botInstance = createBotInstance(config);
    
    if (botInstance) {
      activeBots.push(botInstance);
      botInstances.set(config.id, botInstance);
      
      // ✅ REGISTRAR ENDPOINT PARA CADA BOT
      app.post(config.endpoint, async (req, res) => {
        try {
          console.log(`\n📨 ========== REQUEST RECIBIDO ==========`);
          console.log(`   Endpoint: ${config.endpoint}`);
          console.log(`   Bot: ${config.name}`);
          console.log(`   Activity Type: ${req.body.type || 'N/A'}`);
          console.log(`   Activity Name: ${req.body.name || 'N/A'}`);
          console.log(`   Has Text: ${!!req.body.text}`);
          console.log(`   Has Value: ${!!req.body.value}`);
          if (req.body.value) {
            console.log(`   Value Preview:`, JSON.stringify(req.body.value).substring(0, 150));
          }
          console.log(`📨 ========================================\n`);

          await botInstance.adapter.process(req, res, (context) => botInstance.bot.run(context));
        } catch (err) {
          console.error(`❌ Error procesando mensaje en ${config.name}:`, err);
          res.status(500).send({ error: 'Error interno del bot' });
        }
      });

      console.log(`✅ Bot activado: ${config.name}`);
      console.log(`   📡 Endpoint: ${config.endpoint}`);
      console.log(`   🆔 App ID: ${config.appId.substring(0, 8)}...`);
      console.log(`   🏢 Tenant: ${config.tenantId?.substring(0, 8) || 'N/A'}...`);
      
    } else {
      console.log(`⚠️ Bot omitido: ${config.name} (no configurado)`);
    }
  }

  console.log(`\n🤖 Total bots activos: ${activeBots.length}/${BOT_CONFIGS.length}`);
  
  // ✅ ENDPOINT DE INFORMACIÓN DE BOTS
  app.get('/api/bots', (req, res) => {
    const botsInfo = activeBots.map(botInstance => ({
      id: botInstance.config.id,
      name: botInstance.config.name,
      endpoint: botInstance.config.endpoint,
      appId: botInstance.config.appId.substring(0, 8) + '...',
      status: 'active',
      stats: botInstance.bot.getStats?.() || {}
    }));

    res.json({
      totalBots: activeBots.length,
      configuredBots: BOT_CONFIGS.length,
      bots: botsInfo,
      timestamp: new Date().toISOString()
    });
  });

  // ✅ ENDPOINT DE INFORMACIÓN ESPECÍFICA DE BOT
  app.get('/api/bots/:botId', (req, res) => {
    const botId = req.params.botId;
    const botInstance = botInstances.get(botId);

    if (!botInstance) {
      return res.status(404).json({ 
        error: 'Bot no encontrado',
        availableBots: Array.from(botInstances.keys())
      });
    }

    res.json({
      id: botInstance.config.id,
      name: botInstance.config.name,
      endpoint: botInstance.config.endpoint,
      appId: botInstance.config.appId.substring(0, 8) + '...',
      tenantId: botInstance.config.tenantId?.substring(0, 8) + '...' || 'N/A',
      status: 'active',
      stats: botInstance.bot.getStats?.() || {},
      timestamp: new Date().toISOString()
    });
  });
  
  // ✅ Endpoint de salud mejorado
  app.get('/health', (req, res) => {
    res.json({ 
      status: 'OK', 
      timestamp: new Date().toISOString(),
      environment: process.env.NODE_ENV || 'development',
      activeBots: activeBots.length,
      totalConfigurations: BOT_CONFIGS.length
    });
  });

  // ✅ Ruta raíz con información del servidor
app.get('/', (req, res) => {
  res.json({
    message: 'Nova Multi-Bot Server',
    version: '1.0.0',
    status: 'running',
    timestamp: new Date().toISOString(),
    activeBots: activeBots.length,
    totalConfigurations: BOT_CONFIGS.length,
    endpoints: {
      bots: activeBots.map(bot => ({
        name: bot.config.name,
        endpoint: bot.config.endpoint
      })),
      documents: [
        'POST /api/sendPdf',
        'POST /api/sendWord'
      ],
      webchat: [
        'GET/POST /api/webchat/init',
        'POST /api/webchat/ask',
        'GET /api/webchat/history',
        'POST /api/webchat/clear',
        'GET /api/webchat/status'
      ],
      info: [
        'GET /api/bots',
        'GET /api/bots/:botId',
        'GET /api/cors-test',
        'GET /health'
      ]
    }
  });
});

// ✅ Manejar peticiones HEAD para la raíz (healthcheck común)
app.head('/', (req, res) => {
  res.status(200).end();
});

// ✅ Ruta simple de bienvenida (opcional)
app.get('/welcome', (req, res) => {
  res.send(`
    <html>
      <head><title>Nova Multi-Bot Server</title></head>
      <body>
        <h1>🤖 Nova Multi-Bot Server</h1>
        <p>Servidor funcionando correctamente</p>
        <p>Bots activos: ${activeBots.length}/${BOT_CONFIGS.length}</p>
        <p>Timestamp: ${new Date().toISOString()}</p>
        <a href="/api/bots">Ver información de bots</a>
      </body>
    </html>
  `);
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
  
  // ✅ ARRANQUE DEL SERVIDOR
  const PORT = process.env.PORT || 3978;
  
  app.listen(PORT, () => {
    console.log(`\n🚀 ===============================================`);
    console.log(`🚀 SERVIDOR MULTI-BOT INICIADO EN PUERTO ${PORT}`);
    console.log(`🚀 ===============================================`);
    console.log(`🌐 CORS permite cualquier origen (*)`);
    console.log(`\n📨 ENDPOINTS DE BOTS ACTIVOS:`);
    
    activeBots.forEach(botInstance => {
      console.log(`   • ${botInstance.config.name}:`);
      console.log(`     POST http://localhost:${PORT}${botInstance.config.endpoint}`);
    });
    
    console.log(`\n📄 ENDPOINTS DE DOCUMENTOS:`);
    console.log(`   • POST http://localhost:${PORT}/api/sendPdf`);
    console.log(`   • POST http://localhost:${PORT}/api/sendWord`);
    
    console.log(`\n💬 ENDPOINTS DE WEBCHAT:`);
    console.log(`   • GET/POST http://localhost:${PORT}/api/webchat/init`);
    console.log(`   • POST    http://localhost:${PORT}/api/webchat/ask`);
    console.log(`   • GET     http://localhost:${PORT}/api/webchat/history`);
    console.log(`   • POST    http://localhost:${PORT}/api/webchat/clear`);
    console.log(`   • GET     http://localhost:${PORT}/api/webchat/status`);
    
    console.log(`\n🔍 ENDPOINTS DE INFORMACIÓN:`);
    console.log(`   • GET  http://localhost:${PORT}/api/bots (info de todos los bots)`);
    console.log(`   • GET  http://localhost:${PORT}/api/bots/:botId (info específica)`);
    console.log(`   • GET  http://localhost:${PORT}/api/cors-test`);
    console.log(`   • GET  http://localhost:${PORT}/health`);
    
    console.log(`\n🤖 CONFIGURACIÓN:`);
    console.log(`   • Tenant ID compartido: ${process.env.MicrosoftAppTenantId?.substring(0, 8) || 'N/A'}...`);
    console.log(`   • Bots activos: ${activeBots.length}/${BOT_CONFIGS.length}`);
    console.log(`\n===============================================`);
  });

  // ✅ CLEANUP AL CERRAR
  process.on('SIGINT', () => {
    console.log('\n🧹 Limpiando bots antes de cerrar...');
    activeBots.forEach(botInstance => {
      if (botInstance.bot.cleanup) {
        botInstance.bot.cleanup();
      }
    });
    console.log('✅ Limpieza completada');
    process.exit(0);
  });
}

startServer().catch((err) => {
  console.error('❌ Error al iniciar el servidor:', err);
  process.exit(1);
});