// controllers/webchatController.js - v3.0 SIMPLIFICADO
// Reducido de 1335 líneas → ~280 líneas (79% menos código)
// Compatible con cosmosService v3 (partition key: user_id)

import CosmosService from '../services/cosmosService.js';
import DocumentService from '../services/documentService.js';
import AzureOpenAIService from '../services/openaiService.js';

/** Servicios */
const cosmos = new CosmosService();
const docs = new DocumentService();
const ai = new AzureOpenAIService();

/** Configuración */
const BOT_NAME = 'Asistente Nova';
const INITIAL_MESSAGE = '¡Hola! Soy tu asistente NovaBot. ¿En qué te puedo ayudar hoy?';
const LANGUAGE = 'es';
const MAX_HISTORY_MESSAGES = 10;

// ============================================================
// INIT: Inicializar chat (devuelve mensaje de bienvenida)
// GET/POST /api/webchat/init
// Query/Body: token, perfil?
// Nota: perfil es case-insensitive
// ============================================================
export async function init(req, res) {
    try {
        const token = req.query.token || req.body?.token;
        // Case-insensitive: perfil, Perfil, PERFIL
        const perfil = req.query.perfil ?? req.body?.perfil ?? req.body?.Perfil ?? null;

        console.log(`📝 WebChat INIT - Request completo:`, {
            token: token ? `${token.substring(0, 12)}...` : 'NO ENVIADO',
            perfil: perfil,
            body: req.body ? Object.keys(req.body) : [],
            query: req.query ? Object.keys(req.query) : []
        });

        // Validar token
        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token requerido'
            });
        }

        // ✅ V3: Usar token directamente como user_id
        const userId = token;

        // Guardar mensaje inicial (opcional, no bloqueante)
        if (cosmos.isAvailable()) {
            try {
                await cosmos.saveMessage(userId, 'assistant', INITIAL_MESSAGE);
                console.log(`✅ [${token.substring(0,8)}...] Mensaje inicial guardado`);
            } catch (error) {
                console.warn(`⚠️ [${token.substring(0,8)}...] Error guardando mensaje inicial:`, error.message);
            }
        }

        // Responder
        return res.json({
            success: true,
            language: LANGUAGE,
            botName: BOT_NAME,
            message: INITIAL_MESSAGE,
            perfil: perfil
        });
    } catch (err) {
        console.error('❌ Error en init:', err);
        return res.status(500).json({
            success: false,
            message: 'Error iniciando webchat'
        });
    }
}

// ============================================================
// ASK: Procesar mensaje del usuario
// POST /api/webchat/ask
// Body: { token, content, perfil?, CveUsuario?, NumRI? }
// Nota: perfil, CveUsuario y NumRI son case-insensitive
// ============================================================
export async function ask(req, res) {
    try {
        const body = req.body || {};

        // Extraer parámetros de forma case-insensitive (usando ?? para permitir "0", "", false)
        const token = body.token;
        const content = body.content;
        // Case-insensitive: perfil, Perfil, PERFIL (permitir "0", "1", "2", etc.)
        const perfil = body.perfil ?? body.Perfil ?? body.PERFIL ?? null;
        // Case-insensitive: CveUsuario, cveUsuario, cveusuario
        const CveUsuario = body.CveUsuario ?? body.cveUsuario ?? body.cveusuario ?? body.CVEUSUARIO ?? null;
        // Case-insensitive: NumRI, numRi, numri, NUMRI
        const NumRI = body.NumRI ?? body.numRi ?? body.numri ?? body.NUMRI ?? null;

        console.log(`📝 WebChat ASK - Request completo:`, {
            token: token ? `${token.substring(0, 12)}...` : 'NO ENVIADO',
            content: content ? `"${content.substring(0, 40)}..."` : 'NO ENVIADO',
            perfil: perfil,
            CveUsuario: CveUsuario,
            NumRI: NumRI,
            bodyKeys: Object.keys(body)
        });

        // Validar parámetros
        if (!token || !content) {
            return res.status(400).json({
                success: false,
                message: 'Faltan parámetros: token, content'
            });
        }

        // Validar servicio de IA
        if (!ai || typeof ai.procesarMensaje !== 'function') {
            return res.status(503).json({
                success: false,
                message: 'Servicio de IA no disponible'
            });
        }

        // ✅ V3: Para WebChat, user_id = token (JWT completo)
        const userId = token;

        // 1. GUARDAR MENSAJE DEL USUARIO
        if (cosmos.isAvailable()) {
            try {
                await cosmos.saveMessage(userId, 'user', content);
                console.log(`💾 [${token.substring(0,8)}...] Mensaje guardado`);
            } catch (error) {
                console.error(`❌ [${token.substring(0,8)}...] Error guardando mensaje:`, error.message);
            }
        }

        // 2. OBTENER HISTORIAL (últimos 10 mensajes)
        let historial = [];
        if (cosmos.isAvailable()) {
            try {
                const messages = await cosmos.getLastMessages(userId, MAX_HISTORY_MESSAGES);

                if (messages && messages.length > 0) {
                    historial = messages.map(msg => ({
                        role: msg.role,
                        content: msg.content
                    }));
                    console.log(`📚 [${token.substring(0,8)}...] Historial obtenido: ${historial.length} mensajes`);
                }
            } catch (error) {
                console.error(`❌ [${token.substring(0,8)}...] Error obteniendo historial:`, error.message);
            }
        }

        // 3. AGREGAR MENSAJE ACTUAL SI NO ESTÁ EN EL HISTORIAL
        if (!historial.length || historial[historial.length - 1].content !== content) {
            historial.push({ role: 'user', content });
        }

        // 4. PROCESAR CON IA (usa openaiService.procesarMensaje)
        let response;
        try {
            // Preparar contexto de usuario
            const userContext = {
                usuario: userId,  // Para WebChat = token completo (por consistencia)
                perfil: perfil ?? 'general',  // Default solo si es null/undefined
                CveUsuario: CveUsuario,
                NumRI: NumRI
            };

            // ✅ Firma actualizada v3.1: procesarMensaje(mensaje, historial, userToken, userInfo, conversationId, userId)
            // Para WebChat: userToken = userId = token (mismo valor)
            response = await ai.procesarMensaje(
                content,     // mensaje
                historial,   // historial de mensajes
                token,       // userToken (JWT completo)
                userContext, // userInfo
                null,        // conversationId (opcional)
                userId       // ✅ user_id para Cosmos (en WebChat = token)
            );

            console.log(`🤖 [${token.substring(0,8)}...] Respuesta generada: ${response.content?.substring(0, 50)}...`);
        } catch (error) {
            console.error(`❌ [${token.substring(0,8)}...] Error procesando con IA:`, error);
            return res.status(500).json({
                success: false,
                message: 'Error procesando mensaje con IA'
            });
        }

        // 5. GUARDAR RESPUESTA DEL BOT
        if (cosmos.isAvailable() && response.content) {
            try {
                await cosmos.saveMessage(userId, 'assistant', response.content);
                console.log(`💾 [${token.substring(0,8)}...] Respuesta guardada`);
            } catch (error) {
                console.error(`❌ [${token.substring(0,8)}...] Error guardando respuesta:`, error.message);
            }
        }

        // 6. RESPONDER
        return res.json({
            success: true,
            message: response.content || 'No pude generar una respuesta',
            type: response.type || 'text',
            metadata: response.metadata || {}
        });

    } catch (err) {
        console.error('❌ Error en ask:', err);
        return res.status(500).json({
            success: false,
            message: 'Error procesando mensaje'
        });
    }
}

// ============================================================
// HISTORY: Obtener historial de mensajes
// GET /api/webchat/history
// Query: token, limit?
// ============================================================
export async function history(req, res) {
    try {
        const token = req.query.token;
        const limit = parseInt(req.query.limit) || MAX_HISTORY_MESSAGES;

        console.log(`📜 WebChat HISTORY - Token: ${token?.substring(0, 8)}..., Limit: ${limit}`);

        // Validar token
        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token requerido'
            });
        }

        // ✅ V3: Usar token directamente como user_id
        const userId = token;

        // Obtener mensajes
        if (!cosmos.isAvailable()) {
            return res.json({
                success: true,
                items: [],
                count: 0,
                message: 'Cosmos DB no disponible - sin historial'
            });
        }

        const messages = await cosmos.getLastMessages(userId, limit);

        return res.json({
            success: true,
            items: messages || [],
            count: messages?.length || 0
        });

    } catch (err) {
        console.error('❌ Error en history:', err);
        return res.status(500).json({
            success: false,
            message: 'Error obteniendo historial'
        });
    }
}

// ============================================================
// CLEAR: Limpiar historial de mensajes
// DELETE /api/webchat/clear
// Body: { token }
// ============================================================
export async function clear(req, res) {
    try {
        const token = req.body?.token || req.query?.token;

        console.log(`🗑️ WebChat CLEAR - Token: ${token?.substring(0, 8)}...`);

        // Validar token
        if (!token) {
            return res.status(400).json({
                success: false,
                message: 'Token requerido'
            });
        }

        // ✅ V3: Usar token directamente como user_id
        const userId = token;

        // Limpiar mensajes
        if (!cosmos.isAvailable()) {
            return res.json({
                success: true,
                message: 'Cosmos DB no disponible - nada que limpiar'
            });
        }

        const cleared = await cosmos.clearUserMessages(userId);

        if (cleared) {
            console.log(`✅ [${token.substring(0,8)}...] Historial limpiado`);
            return res.json({
                success: true,
                message: 'Historial limpiado correctamente'
            });
        } else {
            console.warn(`⚠️ [${token.substring(0,8)}...] No se pudo limpiar historial`);
            return res.json({
                success: false,
                message: 'No se pudo limpiar el historial'
            });
        }

    } catch (err) {
        console.error('❌ Error en clear:', err);
        return res.status(500).json({
            success: false,
            message: 'Error limpiando historial'
        });
    }
}

// ============================================================
// STATUS: Estado de los servicios
// GET /api/webchat/status
// ============================================================
export async function status(req, res) {
    try {
        return res.json({
            success: true,
            services: {
                cosmos: {
                    available: cosmos.isAvailable ? cosmos.isAvailable() : false
                },
                ai: {
                    available: ai.isAvailable ? ai.isAvailable() : false
                },
                documents: {
                    available: docs && typeof docs.buscarDocumentos === 'function'
                }
            },
            version: '3.0.0-Simplified',
            timestamp: new Date().toISOString()
        });
    } catch (err) {
        console.error('❌ Error en status:', err);
        return res.status(500).json({
            success: false,
            message: 'Error obteniendo status'
        });
    }
}
