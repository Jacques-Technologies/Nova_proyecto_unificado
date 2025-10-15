// controllers/webchatController.js - MODIFICADO PARA SOPORTE DE PERFIL
import { DateTime } from 'luxon';
import CosmosService from '../services/cosmosService.js';
import DocumentService from '../services/documentService.js';
import AzureOpenAIService from '../services/openaiService.js';

/** Servicios */
const cosmos = new CosmosService();
const docs   = new DocumentService();
const ai     = new AzureOpenAIService();

/** Config del bot */
const BOT_NAME = 'Asistente Nova';
const INITIAL_MESSAGE = '¡Hola! Soy tu asistente de Nova Corporation. ¿En qué te puedo ayudar hoy?';
const LANGUAGE = 'es';

/** Helpers */
function isFn(obj, key) { return obj && typeof obj[key] === 'function'; }
function aiAvailable() { return isFn(ai, 'isAvailable') ? ai.isAvailable() : true; }
function cosmosAvailable() { return isFn(cosmos, 'isAvailable') ? cosmos.isAvailable() : true; }

/* ============================================================
   INIT: crear conversación y devolver saludo inicial
   GET/POST /api/webchat/init
   query/body: token, CveUsuario?, NumRI?, perfil?
============================================================ */
export async function init(req, res) {
  try {
    const token      = req.query.token      || req.body?.token;
    const CveUsuario = req.query.CveUsuario || req.body?.CveUsuario || null;
    const NumRI      = req.query.NumRI      || req.body?.NumRI      || null;
    const perfil     = req.query.perfil     || req.body?.perfil     || req.query.profile || req.body?.profile || null;

    console.log(`📝 WebChat INIT - Token: ${token?.substring(0, 8)}..., CveUsuario: ${CveUsuario}, NumRI: ${NumRI}, Perfil: ${perfil}`);

    if (!token) return res.status(400).json({ success: false, message: 'token requerido' });

    // Crear conversación
    let conversationId;
    try {
      if (isFn(cosmos, 'createOrGetConversation')) {
        const conv = await cosmos.createOrGetConversation({
          channel: 'web',
          token,
          metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI, perfil }
        });
        conversationId = conv?.id;
      }
    } catch (error) {
      console.warn('Error creando conversación en Cosmos:', error.message);
      conversationId = null;
    }
    if (!conversationId) {
      conversationId = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    // Guardar saludo inicial (no bloqueante)
    try {
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(conversationId, {
          role: 'assistant',
          content: INITIAL_MESSAGE,
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, CveUsuario, NumRI, perfil }
        });
      }
    } catch (error) {
      console.warn('Error guardando mensaje inicial:', error.message);
    }

    return res.json({
      success: true,
      conversationId,
      language: LANGUAGE,
      botName: BOT_NAME,
      botAvatar: null,
      message: INITIAL_MESSAGE
    });
  } catch (err) {
    console.error('init error:', err);
    return res.status(500).json({ success: false, message: 'Error iniciando webchat' });
  }
}

/* ============================================================
   ASK: procesar un mensaje del usuario CON SOPORTE DE PERFIL
   POST /api/webchat/ask
   body: { token, conversationId?, content, CveUsuario?, NumRI?, perfil?, metadata? }
============================================================ */
export async function ask(req, res) {
  try {
    const { content, conversationId, metadata } = req.body || {};
    const { token, CveUsuario, NumRI, perfil } = req.body || {};

    console.log(`📝 WebChat ASK - Token: ${token?.substring(0, 8)}..., Perfil: ${perfil || 'sin especificar'}, Msg: "${content?.substring(0, 50)}..."`);

    if (!token || !content) {
      return res.status(400).json({
        success: false,
        message: 'Faltan parámetros: token, content'
      });
    }

    if (!aiAvailable()) {
      return res.status(503).json({ success: false, message: 'Servicio de IA no disponible' });
    }

    // ✅ RESOLUCIÓN DE CONVERSATION ID
    let convId = conversationId;
    console.log(`🎯 ConversationId recibido: ${convId || 'null'}`);
    
    if (!convId && cosmosAvailable()) {
      try {
        convId = await cosmos.getLatestConversationId(token);
        console.log(`🎯 getLatestConversationId result: ${convId || 'null'}`);
      } catch (error) {
        console.warn('⚠️ Error en getLatestConversationId:', error.message);
      }

      if (!convId) {
        console.log(`➕ Creando nueva conversación...`);
        try {
          if (isFn(cosmos, 'createOrGetConversation')) {
            const created = await cosmos.createOrGetConversation({ 
              channel: 'web', 
              token, 
              metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI, perfil } 
            });
            convId = created?.id;
          }
        } catch (error) {
          console.warn('⚠️ Error creando conversación:', error.message);
        }
        
        if (!convId) {
          convId = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
        }
        console.log(`✅ Nueva conversación: ${convId}`);
      } else {
        console.log(`✅ Usando conversación existente: ${convId}`);
      }
    }

    if (!convId) {
      convId = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      console.log(`🔄 Fallback conversationId: ${convId}`);
    }

    // ✅ GUARDAR MENSAJE DEL USUARIO CON PERFIL
    try {
      if (isFn(cosmos, 'appendMessage')) {
        const userMessageData = {
          role: 'user',
          content,
          metadata: { ...(metadata || {}), token, CveUsuario, NumRI, perfil },
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token
        };
        await cosmos.appendMessage(convId, userMessageData);
        console.log(`💾 Mensaje de usuario guardado correctamente con perfil: ${perfil || 'sin especificar'}`);
      }
    } catch (error) {
      console.error('❌ Error guardando mensaje usuario:', error.message);
    }

    // ✅ OBTENER ÚLTIMOS 3 MENSAJES DE CONTEXTO
    let historial = [];
    try {
      const historyResult = await getHistoryInternal(token, 10); // pedimos 10 y luego cortamos
      if (historyResult.success && historyResult.items?.length > 0) {
        historial = historyResult.items
          .filter(item => item.message?.trim())
          .map(item => ({
            role: item.messageType === 'bot' ? 'assistant' :
                  item.messageType === 'system' ? 'system' : 'user',
            content: item.message
          }))
          .slice(-3); // 🔑 SOLO LOS ÚLTIMOS 3 MENSAJES
      }
    } catch (historyError) {
      console.error('❌ Error obteniendo contexto:', historyError.message);
    }

    // ✅ Inyectar último mensaje del usuario si no quedó incluido
    if (!historial.length || historial[historial.length - 1].content !== content) {
      historial.push({ role: 'user', content });
    }

    // ✅ Inyectar mensaje de sistema al inicio CON INFORMACIÓN DE PERFIL
    let systemMessage = "Eres Nova-AI, el asistente oficial de Nova Corporation. Responde de forma clara, profesional y usa SOLO el contexto de los últimos 3 mensajes para mantener coherencia.";
    
    if (perfil) {
      systemMessage += ` IMPORTANTE: El usuario tiene el perfil "${perfil}". Cuando busques información en documentos, debes filtrar por este perfil específico para mostrar solo contenido relevante para su rol.`;
    }

    historial.unshift({
      role: 'system',
      content: systemMessage
    });

    console.log(`📚 Contexto final (${historial.length} mensajes):`);
    historial.forEach((msg, i) =>
      console.log(`   ${i + 1}. ${msg.role}: ${msg.content.substring(0, 80)}...`)
    );

    // ✅ PROCESAR CON OPENAI INCLUYENDO PERFIL
    const userInfo = { 
      usuario: CveUsuario, 
      nombre: `Usuario ${CveUsuario || 'Anónimo'}`, 
      token,
      perfil: perfil || null
    };
    
    // Pasar perfil en las opciones del contexto
    const contextOptions = { perfil };
    
    console.log(`🤖 Enviando a procesarMensaje con perfil: ${perfil || 'sin especificar'}`);
    const response = await ai.procesarMensaje(content, historial, token, userInfo, convId, contextOptions);

    let replyText = '';
    let citations = null;
    if (typeof response === 'string') replyText = response;
    else if (response?.type === 'text') {
      replyText = response.content || 'Respuesta vacía';
      citations = response.metadata?.toolsUsed || null;
    } else if (response?.content) replyText = response.content;
    else replyText = 'No se pudo procesar la respuesta';

    // ✅ GUARDAR RESPUESTA DEL ASISTENTE CON PERFIL
    try {
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'assistant',
          content: replyText,
          citations: citations || [],
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, CveUsuario, NumRI, perfil, toolsUsed: response?.metadata?.toolsUsed || null }
        });
        console.log(`💾 Respuesta del asistente guardada correctamente con perfil: ${perfil || 'sin especificar'}`);
      }
    } catch (error) {
      console.error('❌ Error guardando respuesta del asistente:', error.message);
    }

    return res.json({
      success: true,
      message: replyText,
      citations,
      conversationId: convId,
      metadata: {
        contextLength: historial.length,
        contextSource: 'last_3_messages',
        conversationContinued: historial.length > 1,
        perfil: perfil || null,
        profileApplied: !!perfil
      }
    });
  } catch (err) {
    console.error('❌ === ASK ERROR GENERAL ===', err);
    return res.status(500).json({
      success: false,
      message: 'Error procesando el mensaje. Intenta de nuevo.',
      debug: { error: err.message, timestamp: new Date().toISOString() }
    });
  }
}

/* ============================================================
   STREAM CON SOPORTE DE PERFIL
   GET/POST /api/webchat/stream
============================================================ */
export async function stream(req, res) {
  try {
    const conversationId = req.query.conversationId || req.body?.conversationId;
    const content        = req.query.content        || req.body?.content;
    const token          = req.query.token          || req.body?.token;
    const CveUsuario     = req.query.CveUsuario     || req.body?.CveUsuario || null;
    const NumRI          = req.query.NumRI          || req.body?.NumRI      || null;
    const perfil         = req.query.perfil         || req.body?.perfil     || null;

    console.log(`📝 WebChat STREAM - Token: ${token?.substring(0, 8)}..., Perfil: ${perfil || 'sin especificar'}`);

    if (!token || !content) {
      res.status(400).end();
      return;
    }

    // Resolver conversationId si no viene
    let convId = conversationId;
    if (!convId) {
      convId = (cosmosAvailable() && isFn(cosmos, 'getLatestConversationId'))
        ? (await cosmos.getLatestConversationId(token))
        : null;

      if (!convId) {
        const created = (cosmosAvailable() && isFn(cosmos, 'createOrGetConversation'))
          ? await cosmos.createOrGetConversation({ 
              channel: 'web', 
              token, 
              metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI, perfil } 
            })
          : null;
        convId = created?.id || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    if (isFn(res, 'flushHeaders')) res.flushHeaders();

    try {
      // Guardar mensaje del usuario CON PERFIL
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'user',
          content,
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, CveUsuario, NumRI, perfil }
        });
      }

      // Historial para IA usando sólo token (última conversación activa)
      let historial = [];
      try {
        if (cosmosAvailable() && isFn(cosmos, 'getConversationForOpenAIByToken')) {
          historial = await cosmos.getConversationForOpenAIByToken(token, true, 10);
        }
      } catch (error) {
        console.warn('Error obteniendo historial para stream (token):', error.message);
      }

      const userInfo = { 
        usuario: CveUsuario, 
        nombre: `Usuario ${CveUsuario || 'Anónimo'}`, 
        token,
        perfil: perfil || null
      };

      // Pasar perfil en las opciones del contexto
      const contextOptions = { perfil };

      // Procesar con IA (no streaming nativo) CON PERFIL
      console.log(`🤖 Stream: Enviando a procesarMensaje con perfil: ${perfil || 'sin especificar'}`);
      const response = await ai.procesarMensaje(content, historial, token, userInfo, convId, contextOptions);

      let replyText = '';
      if (typeof response === 'string') replyText = response;
      else if (response?.content)       replyText = response.content;
      else if (response?.text)          replyText = response.text;
      else                              replyText = 'Error procesando respuesta';

      // Simular tokens
      const words = replyText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = words[i] + (i < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ token: word })}\n\n`);
        await new Promise(r => setTimeout(r, 50));
      }

      // Guardar respuesta completa CON PERFIL
      try {
        if (isFn(cosmos, 'appendMessage')) {
          await cosmos.appendMessage(convId, {
            role: 'assistant',
            content: replyText,
            ts: DateTime.utc().toISO(),
            channel: 'web',
            token: token,
            metadata: { token, CveUsuario, NumRI, perfil }
          });
        }
      } catch (error) {
        console.warn('Error guardando respuesta stream:', error.message);
      }

      res.write(`data: ${JSON.stringify({ done: true, text: replyText, perfil: perfil })}\n\n`);
      res.end();
    } catch (error) {
      console.error('stream processing error:', error);
      res.write(`data: ${JSON.stringify({ error: true, message: 'Error procesando mensaje' })}\n\n`);
      res.end();
    }
  } catch (e) {
    console.error('stream outer error:', e);
    try {
      res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
      res.end();
    } catch (endError) {
      console.error('Error cerrando stream:', endError);
    }
  }
}

/* ============================================================
   CLEAR CON SOPORTE DE PERFIL
   POST /api/webchat/clear
============================================================ */
export async function clear(req, res) {
  try {
    const { token, conversationId, perfil } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    console.log(`🧹 WebChat CLEAR - Token: ${token?.substring(0, 8)}..., Perfil: ${perfil || 'sin especificar'}`);

    // Si no llega conversationId, limpiar la última conversación activa de ese token
    let convId = conversationId;
    if (!convId && cosmosAvailable() && isFn(cosmos, 'getLatestConversationId')) {
      convId = await cosmos.getLatestConversationId(token);
    }
    if (!convId) {
      return res.json({ success: true, cleared: true }); // nada que limpiar
    }

    if (isFn(cosmos, 'clearConversation')) {
      try {
        const ok = await cosmos.clearConversation(convId, token);
        if (ok) return res.json({ success: true, cleared: true });
      } catch (e) {
        console.warn('clearConversation error:', e?.message);
      }
    }

    // Fallback: evento system CON PERFIL
    try {
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'system',
          content: '[Conversación reiniciada por el usuario]',
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, clearedBy: 'user', perfil }
        });
      }
    } catch (e) {
      console.warn('Fallback clear appendMessage error:', e?.message);
    }

    return res.json({ success: true, cleared: true });
  } catch (err) {
    console.error('clear error:', err);
    return res.status(500).json({ success: false, message: 'Error al limpiar la conversación' });
  }
}

/* ============================================================
   TEST PROFILE FILTER - NUEVO ENDPOINT PARA PROBAR FILTROS
   GET /api/webchat/test-profile?perfil=...
============================================================ */
export async function testProfileFilter(req, res) {
  try {
    const { perfil } = req.query;
    
    if (!perfil) {
      return res.status(400).json({ success: false, message: 'perfil requerido' });
    }

    console.log(`🧪 TEST PROFILE FILTER - Perfil: ${perfil}`);

    if (!docs.isAvailable()) {
      return res.status(503).json({ 
        success: false, 
        message: 'DocumentService no disponible',
        error: docs.initializationError
      });
    }

    // Probar filtro de perfil
    const testResult = await docs.testProfileFilter(perfil);
    
    return res.json({
      success: true,
      perfil: perfil,
      testResult: testResult,
      timestamp: new Date().toISOString()
    });

  } catch (err) {
    console.error('❌ testProfileFilter error:', err);
    return res.status(500).json({
      success: false,
      message: 'Error probando filtro de perfil',
      error: err.message
    });
  }
}

// ✅ RESTO DE MÉTODOS SIN CAMBIOS PERO CON LOGGING DE PERFIL

export async function debugComplete(req, res) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    console.log(`🔍 DEBUG COMPLETO para token: ${token.substring(0, 8)}...`);

    const debug = {
      token: token.substring(0, 8) + '...',
      timestamp: new Date().toISOString(),
      services: {
        cosmos: cosmosAvailable(),
        ai: aiAvailable(),
        docs: docs.isAvailable()
      },
      tests: {},
      cosmosDebug: null,
      summary: {},
      continuityTest: null,
      documentService: docs.getConfigInfo()
    };

    // 1. Test de servicios básicos
    debug.tests.servicesAvailable = {
      cosmos: cosmosAvailable(),
      ai: aiAvailable(),
      docs: docs.isAvailable(),
      cosmosConnection: !!cosmos.container,
      docsSupportsProfile: docs.getConfigInfo()?.supportsProfileFilter || false
    };

    // 2. Debug completo de Cosmos si está disponible
    if (cosmosAvailable() && isFn(cosmos, 'debugTokenDataComplete')) {
      console.log('🔍 Ejecutando debug completo de Cosmos...');
      try {
        debug.cosmosDebug = await cosmos.debugTokenDataComplete(token);
      } catch (error) {
        debug.cosmosDebug = { error: error.message };
      }
    }

    // 3. Test específico de continuidad
    console.log('🔍 Test de continuidad...');
    debug.continuityTest = await testContinuity(token);

    // 4. Resumen y recomendaciones
    debug.summary = generateDebugSummary(debug);

    return res.json({ success: true, debug });

  } catch (err) {
    console.error('❌ debugComplete error:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message,
      message: 'Error en debug completo'
    });
  }
}

// ✅ RESTO DE FUNCIONES AUXILIARES (sin cambios significativos)

export async function verifyHistorial(req, res) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    console.log(`🔍 VERIFICACIÓN HISTORIAL - Token: ${token.substring(0, 8)}...`);

    const verification = {
      token: token.substring(0, 8) + '...',
      timestamp: new Date().toISOString(),
      tests: {},
      recommendations: []
    };

    // Test 1: getMessagesByToken
    console.log('📊 Test 1: getMessagesByToken');
    try {
      const messages = await cosmos.getMessagesByToken(token, { limit: 10 });
      verification.tests.getMessagesByToken = {
        success: true,
        count: messages?.length || 0,
        hasMessages: messages && messages.length > 0,
        sample: messages?.slice(0, 2)?.map(m => ({
          role: m.role,
          preview: m.content?.substring(0, 30) + '...',
          timestamp: m.ts
        })) || []
      };
    } catch (error) {
      verification.tests.getMessagesByToken = {
        success: false,
        error: error.message
      };
    }

    // Test 2: getConversationForOpenAIByToken
    console.log('📊 Test 2: getConversationForOpenAIByToken');
    try {
      const openaiMessages = await cosmos.getConversationForOpenAIByToken(token, true, 10);
      verification.tests.getConversationForOpenAI = {
        success: true,
        count: openaiMessages?.length || 0,
        hasMessages: openaiMessages && openaiMessages.length > 0,
        sample: openaiMessages?.slice(0, 2)?.map(m => ({
          role: m.role,
          preview: m.content?.substring(0, 30) + '...'
        })) || []
      };
    } catch (error) {
      verification.tests.getConversationForOpenAI = {
        success: false,
        error: error.message
      };
    }

    // Test 3: Simular flujo completo ASK
    console.log('📊 Test 3: Simulación de flujo ASK');
    const simulationSuccess = 
      verification.tests.getConversationForOpenAI?.hasMessages || 
      verification.tests.getMessagesByToken?.hasMessages;

    verification.tests.askFlowSimulation = {
      success: simulationSuccess,
      wouldHaveContext: simulationSuccess,
      contextSource: verification.tests.getConversationForOpenAI?.hasMessages 
        ? 'getConversationForOpenAIByToken' 
        : (verification.tests.getMessagesByToken?.hasMessages ? 'getMessagesByToken' : 'none')
    };

    // Generar recomendaciones
    if (!simulationSuccess) {
      verification.recommendations.push({
        priority: 'critical',
        issue: 'Sin historial disponible',
        action: 'Verificar que appendMessage esté guardando correctamente',
        check: 'Revisar logs de saveMessage y estructura de documentos'
      });
    } else {
      verification.recommendations.push({
        priority: 'info',
        issue: 'Historial funcionando',
        action: 'Sistema operativo',
        note: `Contexto disponible desde: ${verification.tests.askFlowSimulation.contextSource}`
      });
    }

    // Estado general
    verification.status = simulationSuccess ? 'working' : 'broken';

    return res.json({ 
      success: true, 
      verification,
      nextSteps: simulationSuccess 
        ? ['Monitoreo continuo', 'Verificar performance de queries']
        : ['Revisar appendMessage', 'Verificar estructura de documentos', 'Ejecutar debug completo']
    });

  } catch (err) {
    console.error('❌ verifyHistorial error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Error en verificación',
      error: err.message
    });
  }
}

async function testContinuity(token) {
  const test = {
    steps: {},
    success: false,
    issues: [],
    recommendations: []
  };

  try {
    // Paso 1: Verificar última conversación
    console.log('🧪 1. Verificando última conversación...');
    let latestConvId = null;
    try {
      if (isFn(cosmos, 'getLatestConversationId')) {
        latestConvId = await cosmos.getLatestConversationId(token);
      }
      test.steps.getLatestConversation = {
        success: true,
        conversationId: latestConvId,
        found: !!latestConvId
      };
    } catch (error) {
      test.steps.getLatestConversation = {
        success: false,
        error: error.message
      };
      test.issues.push('No se puede obtener la última conversación');
    }

    // Paso 2: Test getMessagesByToken
    console.log('🧪 2. Test getMessagesByToken...');
    try {
      if (isFn(cosmos, 'getMessagesByToken')) {
        const messages = await cosmos.getMessagesByToken(token, { limit: 10 });
        test.steps.getMessagesByToken = {
          success: true,
          count: messages?.length || 0,
          hasMessages: messages && messages.length > 0,
          sample: messages?.slice(0, 2)?.map(m => ({
            role: m.role,
            preview: m.content?.substring(0, 30) + '...'
          })) || []
        };

        if (!messages || messages.length === 0) {
          test.issues.push('getMessagesByToken no retorna mensajes');
        }
      }
    } catch (error) {
      test.steps.getMessagesByToken = {
        success: false,
        error: error.message
      };
      test.issues.push('getMessagesByToken falla: ' + error.message);
    }

    // Paso 3: Test getConversationForOpenAIByToken
    console.log('🧪 3. Test getConversationForOpenAIByToken...');
    try {
      if (isFn(cosmos, 'getConversationForOpenAIByToken')) {
        const openaiFormat = await cosmos.getConversationForOpenAIByToken(token, true, 10);
        test.steps.getConversationForOpenAI = {
          success: true,
          count: openaiFormat?.length || 0,
          hasHistory: openaiFormat && openaiFormat.length > 0,
          sample: openaiFormat?.slice(-2)?.map(m => ({
            role: m.role,
            preview: m.content?.substring(0, 30) + '...'
          })) || []
        };

        if (!openaiFormat || openaiFormat.length === 0) {
          test.issues.push('getConversationForOpenAIByToken no retorna historial');
        }
      }
    } catch (error) {
      test.steps.getConversationForOpenAI = {
        success: false,
        error: error.message
      };
      test.issues.push('getConversationForOpenAIByToken falla: ' + error.message);
    }

    // Paso 4: Simulación de flujo ask
    console.log('🧪 4. Simulando flujo de ask...');
    test.steps.askFlowSimulation = {
      wouldWork: true,
      issues: []
    };

    // Verificar si tendría historial
    const hasAnyHistory = 
      test.steps.getMessagesByToken?.hasMessages || 
      test.steps.getConversationForOpenAI?.hasHistory;

    if (!hasAnyHistory) {
      test.steps.askFlowSimulation.wouldWork = false;
      test.steps.askFlowSimulation.issues.push('No hay historial disponible para contexto');
    }

    // Verificar si puede crear/obtener conversación
    if (!latestConvId) {
      try {
        if (isFn(cosmos, 'createOrGetConversation')) {
          // Simular creación
          test.steps.askFlowSimulation.canCreateConversation = true;
        } else {
          test.steps.askFlowSimulation.canCreateConversation = false;
          test.steps.askFlowSimulation.issues.push('No puede crear conversación');
        }
      } catch (error) {
        test.steps.askFlowSimulation.canCreateConversation = false;
        test.steps.askFlowSimulation.issues.push('Error simulando creación de conversación');
      }
    }

    // Evaluación final
    test.success = test.issues.length === 0 && hasAnyHistory;

    // Generar recomendaciones
    if (!test.success) {
      if (!hasAnyHistory) {
        test.recommendations.push({
          priority: 'high',
          issue: 'Sin historial para continuidad',
          action: 'Verificar que los mensajes se están guardando correctamente',
          method: 'Revisar appendMessage y estructura de datos'
        });
      }

      if (test.issues.includes('getMessagesByToken no retorna mensajes')) {
        test.recommendations.push({
          priority: 'critical',
          issue: 'Método principal de obtención de historial falla',
          action: 'Corregir getMessagesByToken',
          method: 'Usar la versión corregida sin ORDER BY'
        });
      }
    } else {
      test.recommendations.push({
        priority: 'info',
        issue: 'Continuidad funcionando',
        action: 'Sistema operativo',
        method: 'Monitoreo continuo'
      });
    }

  } catch (error) {
    test.success = false;
    test.error = error.message;
    test.issues.push('Error general en test de continuidad: ' + error.message);
  }

  return test;
}

function generateDebugSummary(debug) {
  const summary = {
    status: 'unknown',
    criticalIssues: [],
    recommendations: [],
    continuityStatus: 'unknown'
  };

  // Estado de continuidad
  if (debug.continuityTest) {
    summary.continuityStatus = debug.continuityTest.success ? 'working' : 'broken';
    summary.criticalIssues.push(...debug.continuityTest.issues);
    summary.recommendations.push(...debug.continuityTest.recommendations);
  }

  // Estado general
  if (summary.criticalIssues.length === 0) {
    summary.status = 'healthy';
  } else if (summary.criticalIssues.some(issue => issue.includes('falla') || issue.includes('error'))) {
    summary.status = 'critical';
  } else {
    summary.status = 'degraded';
  }

  return summary;
}

async function getHistoryInternal(token, limit = 20) {
  try {
    console.log(`📚 Llamando history interno para token: ${token.substring(0, 8)}...`);
    
    // Simular la llamada al endpoint history
    const mockReq = {
      query: { token, limit }
    };
    
    const mockRes = {
      json: (data) => data,
      status: (code) => ({ json: (data) => ({ ...data, statusCode: code }) })
    };
    
    // Llamar al método history directamente
    const result = await history(mockReq, mockRes);
    
    console.log(`📚 History interno resultado:`, {
      success: result.success,
      itemCount: result.items?.length || 0,
      method: result.debug?.method || 'unknown'
    });
    
    return result;
    
  } catch (error) {
    console.error('❌ Error en getHistoryInternal:', error);
    return { success: false, items: [], error: error.message };
  }
}

function filterDuplicateMessages(messages) {
  if (!messages || messages.length === 0) return messages;
  
  const filtered = [messages[0]]; // Siempre incluir el primer mensaje
  
  for (let i = 1; i < messages.length; i++) {
    const current = messages[i];
    const previous = messages[i - 1];
    
    // Evitar mensajes duplicados consecutivos
    if (current.content !== previous.content || current.role !== previous.role) {
      filtered.push(current);
    }
  }
  
  console.log(`🔧 Filtro duplicados: ${messages.length} → ${filtered.length} mensajes`);
  return filtered;
}

export async function history(req, res) {
  try {
    const { token, limit = 30, before } = req.query;
    
    console.log(`📝 WebChat HISTORY (TOKEN-ONLY) - Token: ${token?.substring(0, 8)}..., Limit: ${limit}`);
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    let items = [];
    let method = 'none';
    let error = null;

    try {
      // Query SIN partitionKey especificado
      if ((!items || items.length === 0) && cosmosAvailable()) {
        console.log('🔍 Probando query SIN partitionKey específico...');
        try {
          const queryWithoutPK = `
            SELECT TOP @limit c.message, c.messageType, c.timestamp, c.conversationId, c.userToken, c.documentType
            FROM c
            WHERE c.userToken = @token
              AND IS_DEFINED(c.message)
              AND c.message != ''
          `;

          const params = [
            { name: '@token', value: token },
            { name: '@limit', value: Number(limit) }
          ];

          const { resources } = await cosmos.container.items
            .query({ query: queryWithoutPK, parameters: params })
            .fetchAll();

          console.log(`📖 Query sin partitionKey encontró: ${resources?.length || 0} items`);

          if (resources && resources.length > 0) {
            console.log('📊 Documentos encontrados:');
            resources.slice(0, 3).forEach((doc, idx) => {
              console.log(`   ${idx + 1}. DocumentType: ${doc.documentType}, MessageType: ${doc.messageType}, UserToken: ${doc.userToken?.substring(0, 8)}...`);
              console.log(`      Message: "${doc.message?.substring(0, 50)}..."`);
              console.log(`      ConversationId: ${doc.conversationId}`);
            });

            const sortedResources = resources
              .filter(item => item.message && item.message.trim() !== '')
              .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp));

            items = sortedResources.map(item => ({
              role: item.messageType === 'bot' ? 'assistant' : (item.messageType === 'system' ? 'system' : 'user'),
              content: item.message,
              ts: item.timestamp
            }));
            
            method = 'queryWithoutPartitionKey';
          }
        } catch (noPKError) {
          console.error('❌ Error en query sin partitionKey:', noPKError.message);
          error = noPKError.message;
        }
      }

    } catch (methodError) {
      console.error('❌ Error en métodos de obtención:', methodError);
      error = methodError.message;
      items = [];
    }

    // Normalizar respuesta
    const normalizedItems = (items || [])
      .sort((a, b) => new Date(a.ts || a.timestamp) - new Date(b.ts || b.timestamp))
      .map((item, index) => ({
        id: `${token.substring(0, 8)}_${Date.now()}_${index}`,
        message: item.content || item.message,
        type: item.role === 'assistant' ? 'bot' : (item.role === 'system' ? 'system' : 'user'),
        messageType: item.role === 'assistant' ? 'bot' : (item.role === 'system' ? 'system' : 'user'),
        timestamp: item.ts || item.timestamp,
        userToken: token,
        userName: 'Usuario'
      }));

    console.log(`✅ HISTORY FINAL: ${normalizedItems.length} items, método: ${method}`);

    // Log de los mensajes encontrados para debug
    if (normalizedItems.length > 0) {
      console.log(`📝 Mensajes encontrados:`);
      normalizedItems.slice(0, 3).forEach((msg, idx) => {
        console.log(`   ${idx + 1}. ${msg.type}: ${msg.message.substring(0, 50)}...`);
      });
    } else {
      console.log(`⚠️ No se encontraron mensajes con ningún método`);
    }

    return res.json({ 
      success: true, 
      items: normalizedItems,
      debug: {
        method,
        tokenProvided: !!token,
        cosmosAvailable: cosmosAvailable(),
        itemsFound: normalizedItems.length,
        error: error,
        timestamp: new Date().toISOString(),
        partitionKeyTests: 'multiple-approaches-tested'
      }
    });
    
  } catch (err) {
    console.error('❌ HISTORY error general:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo historial',
      error: err.message,
      debug: {
        tokenProvided: !!req.query?.token,
        cosmosAvailable: cosmosAvailable(),
        timestamp: new Date().toISOString()
      }
    });
  }
}

export async function debugToken(req, res) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    console.log(`🔍 DEBUG TOKEN: ${token.substring(0, 8)}...`);

    const debug = {
      token: token.substring(0, 8) + '...',
      timestamp: new Date().toISOString(),
      cosmosAvailable: cosmosAvailable(),
      cosmosConfig: null,
      methods: {},
      data: {
        totalMessages: 0,
        messageTypes: {},
        conversations: [],
        sampleMessages: [],
        rawCosmosData: null
      },
      tests: {}
    };

    // Verificar configuración de Cosmos
    if (isFn(cosmos, 'getConfigInfo')) {
      debug.cosmosConfig = cosmos.getConfigInfo();
    }

    // Verificar métodos disponibles
    debug.methods.getMessagesByToken = isFn(cosmos, 'getMessagesByToken');
    debug.methods.debugTokenData = isFn(cosmos, 'debugTokenData');
    debug.methods.container = !!cosmos.container;

    if (cosmosAvailable()) {
      try {
        // Test 1: Usar debugTokenData si existe
        if (isFn(cosmos, 'debugTokenData')) {
          console.log('🔍 Ejecutando debugTokenData...');
          debug.data.rawCosmosData = await cosmos.debugTokenData(token);
        }

        // Test 2: getMessagesByToken
        if (isFn(cosmos, 'getMessagesByToken')) {
          console.log('🔍 Ejecutando getMessagesByToken...');
          const messages = await cosmos.getMessagesByToken(token, { limit: 50 });
          debug.data.totalMessages = messages?.length || 0;
          debug.data.sampleMessages = (messages || []).slice(0, 3);
          
          // Contar tipos de mensaje
          (messages || []).forEach(msg => {
            debug.data.messageTypes[msg.role] = (debug.data.messageTypes[msg.role] || 0) + 1;
          });

          debug.tests.getMessagesByToken = {
            success: true,
            count: messages?.length || 0
          };
        }

        // Test 3: Query directo básico
        console.log('🔍 Ejecutando query directo básico...');
        const basicQuery = {
          query: `SELECT TOP 10 c.id, c.documentType, c.messageType FROM c WHERE c.userToken = @token`,
          parameters: [{ name: '@token', value: token }]
        };

        const { resources } = await cosmos.container.items
          .query(basicQuery, { partitionKey: token })
          .fetchAll();

        debug.tests.directQuery = {
          success: true,
          count: resources?.length || 0,
          sample: resources?.slice(0, 3) || []
        };

      } catch (debugError) {
        console.error('❌ Error en debug:', debugError);
        debug.error = {
          message: debugError.message,
          code: debugError.code,
          statusCode: debugError.statusCode
        };
      }
    } else {
      debug.error = 'Cosmos DB no está disponible';
    }

    return res.json({ success: true, debug });
    
  } catch (err) {
    console.error('❌ debugToken error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Error en debug',
      error: err.message
    });
  }
}

export async function deepDebug(req, res) {
  try {
    const { token } = req.query;
    
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    console.log(`🔍 DEEP DEBUG para token: ${token.substring(0, 8)}...`);

    const debug = {
      token: token.substring(0, 8) + '...',
      timestamp: new Date().toISOString(),
      cosmosAvailable: cosmosAvailable(),
      searches: {},
      rawData: [],
      analysis: {}
    };

    if (!cosmosAvailable()) {
      debug.error = 'Cosmos no disponible';
      return res.json({ success: true, debug });
    }

    try {
      // Buscar TODOS los documentos por token
      console.log('🔍 Buscando TODOS los documentos...');
      const allDocsQuery = {
        query: `SELECT * FROM c WHERE c.userToken = @token`,
        parameters: [{ name: '@token', value: token }]
      };

      const { resources: allDocs } = await cosmos.container.items
        .query(allDocsQuery, { partitionKey: token })
        .fetchAll();

      debug.searches.allDocuments = {
        query: 'SELECT * FROM c WHERE c.userToken = @token',
        count: allDocs?.length || 0,
        found: !!allDocs?.length
      };

      console.log(`📊 Documentos totales encontrados: ${allDocs?.length || 0}`);

      if (allDocs && allDocs.length > 0) {
        debug.rawData = allDocs.slice(0, 5);
        // Análisis se mantiene igual...
      }

    } catch (error) {
      debug.error = error.message;
      console.error('❌ Error en deep debug:', error);
    }

    return res.json({ success: true, debug });

  } catch (err) {
    console.error('❌ Deep debug error:', err);
    return res.status(500).json({ 
      success: false, 
      error: err.message,
      message: 'Error en diagnóstico profundo'
    });
  }
}

export async function status(req, res) {
  try {
    const stats = isFn(ai, 'getServiceStats') ? (ai.getServiceStats() || {}) : {};
    return res.json({
      success: true,
      ai: { available: aiAvailable(), ...stats },
      cosmos: { available: cosmosAvailable() },
      docs: { available: docs.isAvailable(), config: docs.getConfigInfo() }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error verificando estado' });
  }
}

export async function conversations(req, res) {
  try {
    const token = req.query.token || req.body?.token;
    const limit = Math.min(Number(req.query.limit || 50), 100);

    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    let items = [];
    try {
      if (isFn(cosmos, 'listConversations')) {
        items = await cosmos.listConversations({ token, limit });
      } else {
        items = [];
      }
    } catch (e) {
      console.warn('list conversations error:', e?.message);
      items = [];
    }

    const normalized = (items || []).map(it => ({
      id: it.conversationId || it.id,
      title: it.title || it.metadata?.title || 'Nuevo chat',
      createdAt: it.createdAt || it.ts || it._ts || null,
      lastMessageAt: it.lastActivity || it.lastMessageAt || it.updatedAt || null,
      channel: it.channel || 'web',
    }));

    return res.json({ success: true, items: normalized });
  } catch (err) {
    console.error('conversations error:', err);
    return res.status(500).json({ success: false, message: 'Error listando conversaciones' });
  }
}

export async function renameConversation(req, res) {
  try {
    const id = req.params.id;
    const { token, title } = req.body || {};
    if (!token || !id || !title) {
      return res.status(400).json({ success: false, message: 'token, id y title requeridos' });
    }

    let ok = false;
    try {
      if (isFn(cosmos, 'renameConversation')) {
        ok = await cosmos.renameConversation(id, title, { token });
      } else if (isFn(cosmos, 'updateConversationMetadata')) {
        const meta = { title, renamedAt: DateTime.utc().toISO() };
        ok = await cosmos.updateConversationMetadata(id, meta, token);
      } else if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(id, {
          role: 'system',
          content: `[Título actualizado a: ${title}]`,
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, title }
        });
        ok = true;
      }
    } catch (e) {
      console.warn('renameConversation error:', e?.message);
      ok = false;
    }

    if (!ok) return res.status(500).json({ success: false, message: 'No se pudo renombrar' });
    return res.json({ success: true });
  } catch (err) {
    console.error('renameConversation error:', err);
    return res.status(500).json({ success: false, message: 'Error renombrando conversación' });
  }
}

export async function summary(req, res) {
  try {
    const token = req.query.token || req.body?.token;
    const limit = Math.min(Number(req.query.limit || 30), 100);
    if (!token) return res.status(400).json({ success: false, message: 'token requerido' });

    // Obtener últimos mensajes por token
    const items = cosmos.isAvailable() && typeof cosmos.getMessagesByToken === 'function'
      ? (await cosmos.getMessagesByToken(token, { limit }))
      : [];

    // Texto base para resumir
    const plain = (items || [])
      .map(m => `${m.role === 'assistant' ? 'Asistente' : (m.role === 'system' ? 'Sistema' : 'Usuario')}: ${m.content}`)
      .join('\n');

    // Intentar con IA
    let resumen = '';
    if (aiAvailable() && plain) {
      try {
        const resp = await ai.procesarMensaje(
          `Resume brevemente esta conversación en 3-5 viñetas y da 1 próxima acción si aplica:\n\n${plain}`,
          [], token, { nombre: 'Resumen' }, await cosmos.getLatestConversationId(token)
        );
        resumen = typeof resp === 'string' ? resp
          : resp?.content || resp?.text || '';
      } catch (e) {
        resumen = '';
      }
    }

    // Fallback local si no hay IA
    if (!resumen) {
      // toma las 3-4 oraciones más largas del usuario y del asistente
      const lines = plain.split('\n').filter(Boolean);
      const top = lines.sort((a, b) => b.length - a.length).slice(0, 4);
      resumen = `Resumen (local):\n- ${top.join('\n- ')}`;
    }

    return res.json({ success: true, summary: resumen, count: items.length });
  } catch (e) {
    console.error('summary error:', e);
    return res.status(500).json({ success: false, message: 'Error generando resumen' });
  }
}