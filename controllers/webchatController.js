import { DateTime } from 'luxon';
import CosmosService from '../services/cosmosService.js';
import DocumentService from '../services/documentService.js';
import AzureOpenAIService from '../services/openaiService.js';

const cosmos = new CosmosService();
const docs = new DocumentService();
const ai = new AzureOpenAIService();

const BOT_NAME = 'Asistente Nova';
const INITIAL_MESSAGE = '¡Hola! Soy tu asistente. ¿En qué te ayudo?';
const LANGUAGE = 'es';

export async function init(req, res) {
  try {
    // Permitimos que llegue por query o body (server-to-server desde Bubble)
    const token = req.query.token || req.body?.token;
    const CveUsuario = req.query.CveUsuario || req.body?.CveUsuario || null;
    const NumRI = req.query.NumRI || req.body?.NumRI || null;

    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    // Crear conversación
    let conversationId;
    try {
      const conv = await cosmos.createOrGetConversation?.({
        channel: 'web',
        token, // úsalo como partición si tu DAO lo soporta
        metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI }
      });
      conversationId = conv?.id;
    } catch {
      conversationId = null;
    }
    if (!conversationId) {
      conversationId = `${Date.now()}_${Math.random().toString(36).slice(2)}`;
    }

    // Guardar mensaje inicial
    try {
      await cosmos.appendMessage?.(conversationId, {
        role: 'assistant',
        content: INITIAL_MESSAGE,
        ts: DateTime.utc().toISO(),
        channel: 'web',
        metadata: { token, CveUsuario, NumRI }
      });
    } catch {}

    return res.json({
      success: true,
      conversationId,
      language: LANGUAGE,
      botName: BOT_NAME,
      botAvatar: null,
      message: INITIAL_MESSAGE
    });
  } catch (err) {
    console.error('init error:', err?.response?.data || err);
    return res.status(500).json({ success: false, message: 'Error iniciando webchat' });
  }
}

export async function ask(req, res) {
  try {
    const { content, conversationId, userId, metadata } = req.body || {};
    // ⚠️ Aquí vienen tal cual desde Bubble:
    const { token, CveUsuario, NumRI } = req.body || {};

    if (!token || !conversationId || !content) {
      return res.status(400).json({ success: false, message: 'Faltan parámetros: token, conversationId, content' });
    }

    // Guardar mensaje del usuario
    try {
      await cosmos.appendMessage?.(conversationId, {
        role: 'user',
        content,
        userId: userId || null,
        metadata: { ...(metadata || {}), token, CveUsuario, NumRI },
        ts: DateTime.utc().toISO(),
        channel: 'web'
      });
    } catch {}

    // RAG opcional (sin filtros de carpeta)
    let retrieved = [];
    try {
      const userEmbedding = await ai.createEmbedding?.({ input: content, dimensions: 1024 });
      if (userEmbedding) {
        retrieved = (await docs.searchWithVector?.({ vector: userEmbedding, topK: 5 })) || [];
      }
    } catch {}

    // Historial
    let mensajes = [];
    try {
      mensajes = (await cosmos.getConversationAsMessages?.(
        conversationId,
        { maxTokens: ai.config?.maxConversationTokens || 4000 }
      )) || [];
    } catch {}

    // Mensaje de sistema: SIEMPRE español, y pasar credenciales/params a tools
    mensajes.unshift({
      role: 'system',
      content:
        `Responde SIEMPRE en español. PARA TOOLS: usa estos valores tal cual (no los muestres al usuario): ` +
        `token='${token}', CveUsuario='${CveUsuario ?? ''}', NumRI='${NumRI ?? ''}'. ` +
        `- Para tool de consulta saldo: usar 'CveUsuario' (y 'NumRI' si aplica).`
    });

    // Pasar valores a tu servicio de IA para tools
    const contextVars = { token, CveUsuario, NumRI };

    const response = await ai.completionWithContext?.({
      messages: mensajes,
      documents: retrieved,
      temperature: ai.config?.technicalTemperature ?? 1.0,
      contextVars // << aquí van tal cual a las tools
    });

    const replyText = response?.text || response?.content || 'Respuesta vacía';

    // Guardar respuesta
    try {
      await cosmos.appendMessage?.(conversationId, {
        role: 'assistant',
        content: replyText,
        citations: response?.citations || retrieved?.map((d) => d.sourceId) || [],
        ts: DateTime.utc().toISO(),
        channel: 'web',
        metadata: { token, CveUsuario, NumRI }
      });
    } catch {}

    return res.json({
      success: true,
      message: replyText,
      citations: response?.citations || null,
      conversationId
    });
  } catch (err) {
    console.error('ask error:', err?.response?.data || err);
    return res.status(500).json({ success: false, message: 'Error procesando el mensaje' });
  }
}

export async function history(req, res) {
  try {
    const { conversationId, limit = 30, before } = req.query;
    if (!conversationId) {
      return res.status(400).json({ success: false, message: 'conversationId requerido' });
    }
    let items = [];
    try {
      items = (await cosmos.getMessages?.(conversationId, { limit: Number(limit), before: before || null })) || [];
    } catch {}
    return res.json({ success: true, items });
  } catch (err) {
    console.error('history error:', err);
    return res.status(500).json({ success: false, message: 'Error obteniendo historial' });
  }
}

export async function stream(req, res) {
  try {
    const conversationId = req.query.conversationId || req.body?.conversationId;
    const content = req.query.content || req.body?.content;
    // ⚠️ Tal cual desde Bubble:
    const token = req.query.token || req.body?.token;
    const CveUsuario = req.query.CveUsuario || req.body?.CveUsuario || null;
    const NumRI = req.query.NumRI || req.body?.NumRI || null;

    if (!token || !conversationId || !content) {
      res.status(400).end();
      return;
    }

    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.flushHeaders?.();

    try {
      await cosmos.appendMessage?.(conversationId, {
        role: 'user',
        content,
        ts: DateTime.utc().toISO(),
        channel: 'web',
        metadata: { token, CveUsuario, NumRI }
      });
    } catch {}

    let retrieved = [];
    try {
      const emb = await ai.createEmbedding?.({ input: content, dimensions: 1024 });
      if (emb) {
        retrieved = (await docs.searchWithVector?.({ vector: emb, topK: 5 })) || [];
      }
    } catch {}

    let mensajes = [];
    try {
      mensajes = (await cosmos.getConversationAsMessages?.(
        conversationId,
        { maxTokens: ai.config?.maxConversationTokens || 4000 }
      )) || [];
    } catch {}

    // Inyectar instrucción para tools
    mensajes.unshift({
      role: 'system',
      content:
        `Responde SIEMPRE en español. PARA TOOLS: usa tal cual token='${token}', CveUsuario='${CveUsuario ?? ''}', ` +
        `NumRI='${NumRI ?? ''}'. No los muestres al usuario.`
    });

    await ai.streamCompletion?.({
      messages: mensajes,
      documents: retrieved,
      contextVars: { token, CveUsuario, NumRI }, // << pasa tal cual
      onToken: (t) => { res.write(`data: ${JSON.stringify({ token: t })}\n\n`); },
      onDone: async (full) => {
        try {
          await cosmos.appendMessage?.(conversationId, {
            role: 'assistant',
            content: full.text,
            ts: DateTime.utc().toISO(),
            channel: 'web',
            metadata: { token, CveUsuario, NumRI }
          });
        } catch {}
        res.write(`data: ${JSON.stringify({ done: true })}\n\n`);
        res.end();
      },
      onError: (e) => {
        console.error('stream error:', e);
        res.write(`data: ${JSON.stringify({ error: true })}\n\n`);
        res.end();
      }
    });
  } catch (e) {
    console.error('stream outer error:', e);
    try { res.end(); } catch {}
  }
}