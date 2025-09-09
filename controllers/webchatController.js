import { DateTime } from 'luxon';
import CosmosService from '../services/cosmosService.js';
import DocumentService from '../services/documentService.js';
import AzureOpenAIService from '../services/openaiService.js';

const cosmos = new CosmosService();
const docs = new DocumentService();
const ai = new AzureOpenAIService();

const BOT_NAME = 'Asistente Nova';
const INITIAL_MESSAGE = '¡Hola! Soy tu asistente de Nova Corporation. ¿En qué te puedo ayudar hoy?';
const LANGUAGE = 'es';

export async function init(req, res) {
  try {
    // Permitimos que llegue por query o body
    const token = req.query.token || req.body?.token;
    const CveUsuario = req.query.CveUsuario || req.body?.CveUsuario || null;
    const NumRI = req.query.NumRI || req.body?.NumRI || null;

    console.log(`📝 WebChat INIT - CveUsuario: ${CveUsuario}, NumRI: ${NumRI}`);

    if (!token) {
      return res.status(400).json({ success: false, message: 'token requerido' });
    }

    // Crear conversación
    let conversationId;
    try {
      const conv = await cosmos.createOrGetConversation?.({
        channel: 'web',
        token,
        metadata: { language: LANGUAGE, botName: BOT_NAME, CveUsuario, NumRI }
      });
      conversationId = conv?.id;
    } catch (error) {
      console.warn('Error creando conversación en Cosmos:', error.message);
      conversationId = null;
    }
    
    if (!conversationId) {
      conversationId = `web_${Date.now()}_${Math.random().toString(36).slice(2)}`;
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
    return res.status(500).json({ 
      success: false, 
      message: 'Error iniciando webchat' 
    });
  }
}

export async function ask(req, res) {
  try {
    const { content, conversationId, userId, metadata } = req.body || {};
    const { token, CveUsuario, NumRI } = req.body || {};

    console.log(`📝 WebChat ASK - User: ${CveUsuario}, Msg: "${content?.substring(0, 50)}..."`);

    if (!token || !conversationId || !content) {
      return res.status(400).json({ 
        success: false, 
        message: 'Faltan parámetros: token, conversationId, content' 
      });
    }

    // Verificar disponibilidad del servicio AI
    if (!ai.isAvailable()) {
      return res.status(503).json({
        success: false,
        message: 'Servicio de IA no disponible en este momento'
      });
    }

    // Guardar mensaje del usuario
    try {
      await cosmos.appendMessage?.(conversationId, {
        role: 'user',
        content,
        userId: userId || CveUsuario || null,
        metadata: { ...(metadata || {}), token, CveUsuario, NumRI },
        ts: DateTime.utc().toISO(),
        channel: 'web'
      });
    } catch (error) {
      console.warn('Error guardando mensaje usuario:', error.message);
    }

    // Preparar información del usuario para el AI Service
    const userInfo = {
      usuario: CveUsuario,
      nombre: `Usuario ${CveUsuario}`, // Si tienes nombre real, úsalo aquí
      token: token
    };

    // Obtener historial de conversación
    let historial = [];
    try {
      if (cosmos.isAvailable?.()) {
        historial = await cosmos.getConversationForOpenAI?.(conversationId, CveUsuario) || [];
        // Limitar historial para no saturar el contexto
        historial = historial.slice(-10);
      }
    } catch (error) {
      console.warn('Error obteniendo historial:', error.message);
      historial = [];
    }

    // **USAR EL MÉTODO CORRECTO DEL AI SERVICE**
    const response = await ai.procesarMensaje(
      content,           // mensaje del usuario
      historial,         // historial de conversación
      token,            // token de autenticación
      userInfo,         // información del usuario
      conversationId    // ID de conversación
    );

    let replyText = '';
    let citations = null;

    // Manejar diferentes tipos de respuesta
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
      await cosmos.appendMessage?.(conversationId, {
        role: 'assistant',
        content: replyText,
        citations: citations || [],
        ts: DateTime.utc().toISO(),
        channel: 'web',
        metadata: { 
          token, 
          CveUsuario, 
          NumRI,
          toolsUsed: response?.metadata?.toolsUsed || null
        }
      });
    } catch (error) {
      console.warn('Error guardando respuesta:', error.message);
    }

    return res.json({
      success: true,
      message: replyText,
      citations: citations,
      conversationId,
      metadata: {
        toolsUsed: response?.metadata?.toolsUsed || null,
        usage: response?.metadata?.usage || null
      }
    });

  } catch (err) {
    console.error('ask error:', err);
    
    // Error específico si es problema de autenticación
    if (err.message?.includes('Token expirado') || err.message?.includes('401')) {
      return res.status(401).json({
        success: false,
        message: 'Token de autenticación expirado. Por favor, inicia sesión nuevamente.'
      });
    }

    return res.status(500).json({ 
      success: false, 
      message: 'Error procesando el mensaje. Intenta de nuevo.' 
    });
  }
}

export async function history(req, res) {
  try {
    const { conversationId, limit = 30, before } = req.query;
    
    if (!conversationId) {
      return res.status(400).json({ 
        success: false, 
        message: 'conversationId requerido' 
      });
    }

    let items = [];
    try {
      if (cosmos.isAvailable?.()) {
        items = await cosmos.getMessages?.(
          conversationId, 
          { limit: Number(limit), before: before || null }
        ) || [];
      }
    } catch (error) {
      console.warn('Error obteniendo historial:', error.message);
    }

    return res.json({ success: true, items });
  } catch (err) {
    console.error('history error:', err);
    return res.status(500).json({ 
      success: false, 
      message: 'Error obteniendo historial' 
    });
  }
}

export async function stream(req, res) {
  try {
    const conversationId = req.query.conversationId || req.body?.conversationId;
    const content = req.query.content || req.body?.content;
    const token = req.query.token || req.body?.token;
    const CveUsuario = req.query.CveUsuario || req.body?.CveUsuario || null;
    const NumRI = req.query.NumRI || req.body?.NumRI || null;

    console.log(`📝 WebChat STREAM - User: ${CveUsuario}`);

    if (!token || !conversationId || !content) {
      res.status(400).end();
      return;
    }

    // Configurar headers para streaming
    res.setHeader('Content-Type', 'text/event-stream');
    res.setHeader('Cache-Control', 'no-cache');
    res.setHeader('Connection', 'keep-alive');
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type');
    res.flushHeaders?.();

    try {
      // Guardar mensaje del usuario
      await cosmos.appendMessage?.(conversationId, {
        role: 'user',
        content,
        ts: DateTime.utc().toISO(),
        channel: 'web',
        metadata: { token, CveUsuario, NumRI }
      });

      // Preparar userInfo
      const userInfo = {
        usuario: CveUsuario,
        nombre: `Usuario ${CveUsuario}`,
        token: token
      };

      // Obtener historial
      let historial = [];
      try {
        if (cosmos.isAvailable?.()) {
          historial = await cosmos.getConversationForOpenAI?.(conversationId, CveUsuario) || [];
          historial = historial.slice(-10);
        }
      } catch (error) {
        console.warn('Error obteniendo historial para stream:', error.message);
      }

      // Usar procesarMensaje (no streaming por ahora, pero puedes extender)
      const response = await ai.procesarMensaje(
        content,
        historial,
        token,
        userInfo,
        conversationId
      );

      let replyText = '';
      if (typeof response === 'string') {
        replyText = response;
      } else if (response?.content) {
        replyText = response.content;
      } else {
        replyText = 'Error procesando respuesta';
      }

      // Enviar respuesta por chunks (simular streaming)
      const words = replyText.split(' ');
      for (let i = 0; i < words.length; i++) {
        const word = words[i] + (i < words.length - 1 ? ' ' : '');
        res.write(`data: ${JSON.stringify({ token: word })}\n\n`);
        // Pequeña pausa para simular streaming real
        await new Promise(resolve => setTimeout(resolve, 50));
      }

      // Guardar respuesta completa
      try {
        await cosmos.appendMessage?.(conversationId, {
          role: 'assistant',
          content: replyText,
          ts: DateTime.utc().toISO(),
          channel: 'web',
          metadata: { token, CveUsuario, NumRI }
        });
      } catch (error) {
        console.warn('Error guardando respuesta stream:', error.message);
      }

      // Finalizar stream
      res.write(`data: ${JSON.stringify({ done: true, text: replyText })}\n\n`);
      res.end();

    } catch (error) {
      console.error('stream processing error:', error);
      res.write(`data: ${JSON.stringify({ 
        error: true, 
        message: 'Error procesando mensaje' 
      })}\n\n`);
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

// Endpoint adicional para verificar el estado del servicio
export async function status(req, res) {
  try {
    const stats = ai.getServiceStats?.() || {};
    return res.json({
      success: true,
      ai: {
        available: ai.isAvailable(),
        ...stats
      },
      cosmos: {
        available: cosmos.isAvailable?.() || false
      },
      docs: {
        available: docs.isAvailable?.() || false
      }
    });
  } catch (error) {
    return res.status(500).json({
      success: false,
      message: 'Error verificando estado'
    });
  }
}