// controllers/webchatController.js
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
   query/body: token, CveUsuario?, NumRI?
============================================================ */
export async function init(req, res) {
  try {
    const token      = req.query.token      || req.body?.token;
    const CveUsuario = req.query.CveUsuario || req.body?.CveUsuario || null;
    const NumRI      = req.query.NumRI      || req.body?.NumRI      || null;

    console.log(`📝 WebChat INIT - Token: ${token?.substring(0, 8)}..., CveUsuario: ${CveUsuario}, NumRI: ${NumRI}`);

    if (!token) return res.status(400).json({ success: false, message: 'token requerido' });

    // Crear conversación
    let conversationId;
    try {
      if (isFn(cosmos, 'createOrGetConversation')) {
        const conv = await cosmos.createOrGetConversation({
          channel: 'web',
          token,
          metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI }
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
          metadata: { token, CveUsuario, NumRI }
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
   ASK: procesar un mensaje del usuario
   POST /api/webchat/ask
   body: { token, conversationId?, content, CveUsuario?, NumRI?, metadata? }
   🔁 Lectura de historial por TOKEN (última conversación activa)
============================================================ */
export async function ask(req, res) {
  try {
    const { content, conversationId, metadata } = req.body || {};
    const { token, CveUsuario, NumRI } = req.body || {};

    console.log(`📝 WebChat ASK - Token: ${token?.substring(0, 8)}..., Msg: "${content?.substring(0, 50)}..."`);

    if (!token || !content) {
      return res.status(400).json({
        success: false,
        message: 'Faltan parámetros: token, content'
      });
    }

    if (!aiAvailable()) {
      return res.status(503).json({ success: false, message: 'Servicio de IA no disponible' });
    }

    // Resolver conversationId: usar el que llegó o último por token; crear si no existe
    let convId = conversationId;
    if (!convId) {
      convId = (cosmosAvailable() && isFn(cosmos, 'getLatestConversationId'))
        ? (await cosmos.getLatestConversationId(token))
        : null;

      if (!convId) {
        const created = (cosmosAvailable() && isFn(cosmos, 'createOrGetConversation'))
          ? await cosmos.createOrGetConversation({ channel: 'web', token, metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI } })
          : null;
        convId = created?.id || `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
      }
    }

    // Guardar mensaje del usuario
    try {
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'user',
          content,
          metadata: { ...(metadata || {}), token, CveUsuario, NumRI },
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token
        });
      }
    } catch (error) {
      console.warn('Error guardando mensaje usuario:', error.message);
    }

    // Info de usuario para AI
    const userInfo = { usuario: CveUsuario, nombre: `Usuario ${CveUsuario || 'Anónimo'}`, token };

    // Historial usando sólo token (última conversación activa)
    let historial = [];
    try {
      if (cosmosAvailable() && isFn(cosmos, 'getConversationForOpenAIByToken')) {
        historial = await cosmos.getConversationForOpenAIByToken(token, true, 10);
      }
    } catch (error) {
      console.warn('Error obteniendo historial (token):', error.message);
      historial = [];
    }

    // Procesar con la IA
    const response = await ai.procesarMensaje(
      content,
      historial,
      token,
      userInfo,
      convId
    );

    let replyText = '';
    let citations = null;

    if (typeof response === 'string') {
      replyText = response;
    } else if (response?.type === 'text') {
      replyText = response.content || 'Respuesta vacía';
      citations = response.metadata?.toolsUsed || null;
    } else if (response?.content) {
      replyText = response.content;
    } else if (response?.text) {
      replyText = response.text;
    } else {
      replyText = 'No se pudo procesar la respuesta';
    }

    // Guardar respuesta del asistente
    try {
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'assistant',
          content: replyText,
          citations: citations || [],
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, CveUsuario, NumRI, toolsUsed: response?.metadata?.toolsUsed || null }
        });
      }
    } catch (error) {
      console.warn('Error guardando respuesta:', error.message);
    }

    return res.json({
      success: true,
      message: replyText,
      citations,
      conversationId: convId,
      metadata: {
        toolsUsed: response?.metadata?.toolsUsed || null,
        usage: response?.metadata?.usage || null
      }
    });
  } catch (err) {
    console.error('ask error:', err);

    if (err.message && (err.message.includes('Token expirado') || err.message.includes('401'))) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticación expirado. Por favor, inicia sesión nuevamente.'
      });
    }

    return res.status(500).json({ success: false, message: 'Error procesando el mensaje. Intenta de nuevo.' });
  }
}

/* ============================================================
   HISTORY
   GET /api/webchat/history?token=...&limit=30&before=...&conversationId?=...
   🔁 Si no envían conversationId, lee por TOKEN (última conversación activa)
============================================================ */
export async function history(req, res) {
  try {
    const { token, limit = 30, before } = req.query;
    
    if (!token) {
      return res.status(400).json({ 
        success: false, 
        message: 'token requerido' 
      });
    }

    let items = [];
    try {
      if (isFn(cosmos, 'getConversationHistoryByToken')) {
        items = await cosmos.getConversationHistoryByToken(token, Number(limit));
      } else {
        items = await cosmos.getMessagesByToken(token, { limit: Number(limit), before: before || null }) || [];
      }
    } catch (error) {
      console.warn('Error obteniendo historial por token:', error.message);
      items = [];
    }
    return res.json({ success: true, items });
  } catch (err) {
    console.error('history error:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo historial' });
  }
}


/* ============================================================
   STREAM (SSE simulado)
   GET/POST /api/webchat/stream
   🔁 Historial por TOKEN; tolera ausencia de conversationId igual que ASK
============================================================ */
export async function stream(req, res) {
  try {
    const conversationId = req.query.conversationId || req.body?.conversationId;
    const content        = req.query.content        || req.body?.content;
    const token          = req.query.token          || req.body?.token;
    const CveUsuario     = req.query.CveUsuario     || req.body?.CveUsuario || null;
    const NumRI          = req.query.NumRI          || req.body?.NumRI      || null;

    console.log(`📝 WebChat STREAM - Token: ${token?.substring(0, 8)}...`);

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
          ? await cosmos.createOrGetConversation({ channel: 'web', token, metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI } })
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
      // Guardar mensaje del usuario
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'user',
          content,
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, CveUsuario, NumRI }
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

      const userInfo = { usuario: CveUsuario, nombre: `Usuario ${CveUsuario || 'Anónimo'}`, token };

      // Procesar con IA (no streaming nativo)
      const response = await ai.procesarMensaje(content, historial, token, userInfo, convId);

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

      // Guardar respuesta completa
      try {
        if (isFn(cosmos, 'appendMessage')) {
          await cosmos.appendMessage(convId, {
            role: 'assistant',
            content: replyText,
            ts: DateTime.utc().toISO(),
            channel: 'web',
            token: token,
            metadata: { token, CveUsuario, NumRI }
          });
        }
      } catch (error) {
        console.warn('Error guardando respuesta stream:', error.message);
      }

      res.write(`data: ${JSON.stringify({ done: true, text: replyText })}\n\n`);
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
   STATUS
   GET /api/webchat/status
============================================================ */
export async function status(req, res) {
  try {
    const stats = isFn(ai, 'getServiceStats') ? (ai.getServiceStats() || {}) : {};
    return res.json({
      success: true,
      ai: { available: aiAvailable(), ...stats },
      cosmos: { available: cosmosAvailable() },
      docs:   { available: isFn(docs, 'isAvailable') ? docs.isAvailable() : false }
    });
  } catch (error) {
    return res.status(500).json({ success: false, message: 'Error verificando estado' });
  }
}

/* ============================================================
   CLEAR
   POST /api/webchat/clear
============================================================ */
export async function clear(req, res) {
  try {
    const { token, conversationId } = req.body || {};
    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

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

    // Fallback: evento system
    try {
      if (isFn(cosmos, 'appendMessage')) {
        await cosmos.appendMessage(convId, {
          role: 'system',
          content: '[Conversación reiniciada por el usuario]',
          ts: DateTime.utc().toISO(),
          channel: 'web',
          token: token,
          metadata: { token, clearedBy: 'user' }
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
   LISTAR CONVERSACIONES
   GET /api/webchat/conversations?token=...&limit=50
============================================================ */
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

/* ============================================================
   RENOMBRAR
   PATCH /api/webchat/conversation/:id
============================================================ */
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

// controllers/webchatController.js (añade al final del archivo)
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
