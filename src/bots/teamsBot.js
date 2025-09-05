// src/bots/teamsBot.js - CÓDIGO COMPLETO con nuevo formato de persistencia

const { DialogBot } = require('./dialogBot');
const { CardFactory } = require('botbuilder');
const axios = require('axios');
// Ajustar rutas de los servicios.  Los servicios del bot (openai, cosmos,
// conversación, etc.) se encuentran en src/services/bot/
const openaiService = require('../services/bot/openaiService.js');
const cosmosService = require('../services/bot/cosmosService.js');
const conversationService = require('../services/bot/conversationService.js');
require('dotenv').config();

class TeamsBot extends DialogBot {
    constructor(conversationState, userState) {
        super(conversationState, userState);

        global.botInstance = this;
        this.authenticatedUsers = new Map();
        this.authState = this.userState.createProperty('AuthState');
        this.loginCardSentUsers = new Set();
        this.welcomeMessageSent = new Set();
        
        // ✅ NUEVO: Cache para historial con formato role/content (máximo 5 de cada tipo)
        this.conversationCache = new Map(); // conversationId -> { userMessages: [], botMessages: [] }
        
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        this.onMessage(this.handleMessageWithAuth.bind(this));
        this.openaiService = openaiService;
        
        console.log('✅ TeamsBot inicializado con formato role/content (5+5 mensajes)');
        console.log(`💾 Persistencia: ${cosmosService.isAvailable() ? 'Cosmos DB activa' : 'Solo memoria'}`);
    }

    /**
     * ✅ NUEVO: Agregar mensaje al cache con límite de 5 por tipo
     */
    agregarMensajeACache(conversationId, role, content, userId, userName = 'Usuario') {
        try {
            if (!this.conversationCache.has(conversationId)) {
                this.conversationCache.set(conversationId, {
                    userMessages: [],
                    botMessages: []
                });
            }

            const cache = this.conversationCache.get(conversationId);
            const timestamp = new Date().toISOString();

            const mensajeObj = {
                role: role, // 'user' o 'assistant'
                content: content,
                timestamp: timestamp,
                userId: userId,
                userName: userName
            };

            // ✅ AGREGAR a la lista correspondiente
            if (role === 'user') {
                cache.userMessages.unshift(mensajeObj); // Agregar al inicio
                // Mantener solo los últimos 5 mensajes del usuario
                if (cache.userMessages.length > 5) {
                    cache.userMessages = cache.userMessages.slice(0, 5);
                }
            } else if (role === 'assistant') {
                cache.botMessages.unshift(mensajeObj); // Agregar al inicio
                // Mantener solo los últimos 5 mensajes del bot
                if (cache.botMessages.length > 5) {
                    cache.botMessages = cache.botMessages.slice(0, 5);
                }
            }

            console.log(`📝 [${userId}] Cache actualizado: ${cache.userMessages.length} user, ${cache.botMessages.length} assistant`);
            
        } catch (error) {
            console.error('❌ Error agregando mensaje a cache:', error);
        }
    }

    /**
     * ✅ NUEVO: Obtener conversación en formato role/content ordenado cronológicamente
     */
    obtenerConversacionFormateada(conversationId) {
        try {
            if (!this.conversationCache.has(conversationId)) {
                return [];
            }

            const cache = this.conversationCache.get(conversationId);
            
            // Combinar mensajes de usuario y bot
            const todosMensajes = [
                ...cache.userMessages.map(msg => ({ ...msg, tipo: 'user' })),
                ...cache.botMessages.map(msg => ({ ...msg, tipo: 'bot' }))
            ];

            // Ordenar por timestamp (más reciente primero)
            const mensajesOrdenados = todosMensajes.sort((a, b) => 
                new Date(b.timestamp) - new Date(a.timestamp)
            );

            // Tomar máximo 10 mensajes (5 + 5)
            return mensajesOrdenados.slice(0, 10);

        } catch (error) {
            console.error('❌ Error obteniendo conversación formateada:', error);
            return [];
        }
    }

    /**
     * ✅ MEJORADO: Guardar mensaje en todos los sistemas
     */
    async guardarMensajeEnHistorial(mensaje, tipo, conversationId, userId, userName = 'Usuario') {
        try {
            if (!mensaje || !conversationId || !userId) {
                console.warn('⚠️ Parámetros insuficientes para guardar mensaje');
                return false;
            }

            const role = tipo === 'bot' ? 'assistant' : 'user';
            
            console.log(`💾 [${userId}] Guardando mensaje ${role}: "${mensaje.substring(0, 50)}..."`);

            // ✅ 1. AGREGAR al cache con límite de 5+5
            this.agregarMensajeACache(conversationId, role, mensaje, userId, userName);

            // ✅ 2. Guardar en Cosmos DB si está disponible (formato individual - mantener compatibilidad)
            if (cosmosService.isAvailable()) {
                try {
                    await cosmosService.saveMessage(
                        mensaje,
                        conversationId,
                        userId,
                        userName,
                        tipo
                    );
                    console.log(`✅ [${userId}] Mensaje guardado en Cosmos DB (formato individual)`);
                } catch (cosmosError) {
                    console.warn(`⚠️ [${userId}] Error guardando en Cosmos DB:`, cosmosError.message);
                }

                // ✅ 3. También guardar en formato de conversación OpenAI
                try {
                    await cosmosService.addMessageToConversation(
                        conversationId,
                        userId,
                        role,
                        mensaje,
                        { nombre: userName }
                    );
                    console.log(`🤖 [${userId}] Mensaje guardado en formato OpenAI`);
                } catch (openaiError) {
                    console.warn(`⚠️ [${userId}] Error guardando en formato OpenAI:`, openaiError.message);
                }
            }

            // ✅ 4. Backup en conversationService
            await conversationService.saveMessage(mensaje, conversationId, tipo === 'bot' ? 'bot' : userId);

            console.log(`✅ [${userId}] Mensaje guardado en todos los sistemas disponibles`);
            return true;

        } catch (error) {
            console.error('❌ Error guardando mensaje en historial:', error);
            return false;
        }
    }

    /**
     * ✅ NUEVO: Mostrar historial en formato role/content
     */
    async showConversationHistory(context, userId, conversationId) {
        try {
            console.log(`📚 [${userId}] Mostrando historial en formato role/content`);
            
            const conversacion = this.obtenerConversacionFormateada(conversationId);
            
            if (!conversacion || conversacion.length === 0) {
                await context.sendActivity(
                    `📚 **Historial de Conversación**\n\n` +
                    `❌ **No hay mensajes guardados**\n\n` +
                    `Esto puede ocurrir si:\n` +
                    `• Es una conversación nueva\n` +
                    `• El bot se reinició recientemente\n\n` +
                    `💡 **Envía algunos mensajes** y luego vuelve a consultar el historial.`
                );
                return;
            }

            // ✅ CONTAR mensajes por tipo
            const userCount = conversacion.filter(msg => msg.role === 'user').length;
            const assistantCount = conversacion.filter(msg => msg.role === 'assistant').length;

            let respuesta = `📚 **Historial de Conversación (${conversacion.length}/10 mensajes)**\n\n`;
            respuesta += `👤 **Mensajes del usuario**: ${userCount}/5\n`;
            respuesta += `🤖 **Mensajes del asistente**: ${assistantCount}/5\n`;
            respuesta += `💾 **Persistencia**: ${cosmosService.isAvailable() ? 'Cosmos DB activo' : 'Solo memoria'}\n\n`;

            respuesta += `**Conversación en formato role/content:**\n\n`;

            // ✅ MOSTRAR conversación en orden cronológico inverso (más reciente primero)
            for (const msg of conversacion) {
                const stamp = new Date(msg.timestamp).toLocaleString();
                const sender = msg.role === 'user' ? `👤 ${msg.userName}` : '🤖 Asistente';
                respuesta += `*${stamp}* - **${sender}**: ${msg.content}\n\n`;
            }

            await context.sendActivity(respuesta);

        } catch (error) {
            console.error('❌ Error mostrando historial:', error);
            await context.sendActivity('❌ Error mostrando historial de conversación');
        }
    }

    /**
     * ✅ Método para manejar eventos de MembersAdded
     */
    async handleMembersAdded(context) {
        const membersAdded = context.activity.membersAdded;
        const conversationId = context.activity.conversation.id;
        const userId = context.activity.from.id;
        
        for (const member of membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                if (!this.welcomeMessageSent.has(conversationId)) {
                    await context.sendActivity('👋 ¡Hola! Soy tu asistente virtual. ¿En qué puedo ayudarte hoy?');
                    this.welcomeMessageSent.add(conversationId);
                }
            }
        }
    }

    /**
     * ✅ Manejo de mensajes con autenticación
     */
    async handleMessageWithAuth(context) {
        const userId = context.activity.from.id;
        const conversationId = context.activity.conversation.id;
        const message = context.activity.text;

        try {
            // Ejemplo de verificación de autenticación.  Puedes añadir lógica aquí.
            if (!this.authenticatedUsers.has(userId)) {
                // Si el usuario no está autenticado, enviar mensaje de solicitud
                if (!this.loginCardSentUsers.has(userId)) {
                    const loginCard = CardFactory.heroCard(
                        'Inicio de sesión requerido',
                        'Por favor inicia sesión para continuar',
                        null,
                        [
                            {
                                type: 'openUrl',
                                title: 'Iniciar sesión',
                                value: 'https://login.microsoftonline.com/'
                            }
                        ]
                    );
                    await context.sendActivity({ attachments: [loginCard] });
                    this.loginCardSentUsers.add(userId);
                }
                return;
            }

            // Guardar mensaje del usuario en historial
            await this.guardarMensajeEnHistorial(message, 'user', conversationId, userId);

            // Procesar mensaje con OpenAI (o tu servicio de IA preferido)
            const respuesta = await this.openaiService.getChatCompletion(message, conversationId, userId);

            // Guardar respuesta del bot en historial
            await this.guardarMensajeEnHistorial(respuesta, 'bot', conversationId, userId);

            // Enviar respuesta al usuario
            await context.sendActivity(respuesta);

        } catch (error) {
            console.error('❌ Error procesando mensaje:', error);
            await context.sendActivity('❌ Lo siento, ocurrió un error procesando tu mensaje.');
        }
    }
}

module.exports = {
    TeamsBot
};