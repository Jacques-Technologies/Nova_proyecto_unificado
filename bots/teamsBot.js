// bots/teamsBot.js - CÓDIGO COMPLETO con nuevo formato de persistencia
import DialogBot from './dialogBot.js';
import { CardFactory } from 'botbuilder';
import axios from 'axios';
import AzureOpenAIService from '../services/openaiService.js';
import CosmosService from '../services/cosmosService.js';
import ConversationService from '../services/conversationService.js';
import 'dotenv/config';

const cosmosService= new CosmosService();
const conversationService = new ConversationService(); 
const openaiService = new AzureOpenAIService(); 

export default class TeamsBot extends DialogBot {
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
            conversacion.forEach((msg, index) => {
                const fecha = new Date(msg.timestamp).toLocaleString('es-MX');
                const emoji = msg.role === 'user' ? '👤' : '🤖';
                const roleLabel = msg.role === 'user' ? 'user' : 'assistant';
                
                respuesta += `**${index + 1}. ${emoji} Role: "${roleLabel}"**\n`;
                respuesta += `📅 ${fecha}\n`;
                respuesta += `💬 Content: "${msg.content}"\n`;
                
                if (index < conversacion.length - 1) {
                    respuesta += `\n━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━\n\n`;
                }
            });

            respuesta += `\n\n💡 **Comandos útiles:**\n`;
            respuesta += `• \`resumen\` - Resumen inteligente de la conversación\n`;
            respuesta += `• \`limpiar historial\` - Eliminar mensajes\n\n`;
            
            respuesta += `📋 **Formato**: Máximo 5 mensajes de usuario + 5 del asistente\n`;
            respuesta += `🔄 **Rotación**: Al llegar al límite, se eliminan los mensajes más antiguos`;

            await context.sendActivity(respuesta);

        } catch (error) {
            console.error('❌ Error mostrando historial:', error);
            await context.sendActivity('❌ Error obteniendo el historial de la conversación.');
        }
    }

    /**
     * ✅ MEJORADO: Mostrar resumen con estadísticas del nuevo formato
     */
    async showConversationSummary(context, userId, conversationId) {
        try {
            console.log(`📊 [${userId}] Generando resumen de conversación`);
            
            const conversacion = this.obtenerConversacionFormateada(conversationId);
            
            if (!conversacion || conversacion.length === 0) {
                await context.sendActivity(
                    `📊 **Resumen de Conversación**\n\n` +
                    `❌ **No hay mensajes para resumir**\n\n` +
                    `Envía algunos mensajes y luego solicita el resumen.`
                );
                return;
            }

            const userInfo = await this.getUserInfo(userId);
            
            // ✅ ESTADÍSTICAS del nuevo formato
            const userMessages = conversacion.filter(msg => msg.role === 'user');
            const assistantMessages = conversacion.filter(msg => msg.role === 'assistant');
            const primerMensaje = conversacion[conversacion.length - 1]; // Más antiguo
            const ultimoMensaje = conversacion[0]; // Más reciente

            let resumen = `📊 **Resumen de Conversación**\n\n`;
            resumen += `👤 **Usuario**: ${userInfo?.nombre || 'Usuario'} (${userId})\n`;
            resumen += `💬 **Total mensajes**: ${conversacion.length}/10\n`;
            resumen += `📤 **Mensajes del usuario**: ${userMessages.length}/5\n`;
            resumen += `🤖 **Respuestas del asistente**: ${assistantMessages.length}/5\n`;
            resumen += `📅 **Primer mensaje**: ${new Date(primerMensaje.timestamp).toLocaleString('es-MX')}\n`;
            resumen += `🕐 **Último mensaje**: ${new Date(ultimoMensaje.timestamp).toLocaleString('es-MX')}\n`;
            resumen += `💾 **Persistencia**: ${cosmosService.isAvailable() ? 'Cosmos DB' : 'Solo memoria'}\n\n`;

            // ✅ RESUMEN automático con IA si está disponible
            if (this.openaiService && this.openaiService.openaiAvailable && conversacion.length >= 2) {
                try {
                    resumen += `🧠 **Resumen Inteligente**:\n`;
                    
                    // ✅ USAR formato role/content directamente para IA
                    const mensajesParaIA = conversacion.reverse().map(msg => 
                        `${msg.role === 'user' ? 'Usuario' : 'Asistente'}: ${msg.content}`
                    ).join('\n');

                    const prompt = `Genera un resumen profesional y conciso (máximo 3 líneas) de esta conversación corporativa:\n\n${mensajesParaIA}`;
                    
                    const respuestaIA = await this.openaiService.procesarMensaje(
                        prompt,
                        [], // Sin historial adicional
                        userInfo?.token,
                        userInfo
                    );
                    
                    if (respuestaIA && respuestaIA.content) {
                        resumen += `${respuestaIA.content}\n\n`;
                    }
                } catch (iaError) {
                    console.warn('⚠️ Error generando resumen con IA:', iaError.message);
                    resumen += `*Resumen automático no disponible*\n\n`;
                }
            }

            // ✅ MOSTRAR últimos mensajes en formato compacto
            resumen += `📋 **Últimos mensajes**:\n`;
            conversacion.slice(0, 3).forEach((msg, index) => {
                const emoji = msg.role === 'user' ? '👤' : '🤖';
                const preview = msg.content.length > 80 ? 
                    msg.content.substring(0, 80) + '...' : 
                    msg.content;
                resumen += `${index + 1}. ${emoji} ${preview}\n`;
            });

            resumen += `\n💡 Para ver el historial completo usa: \`historial\``;

            await context.sendActivity(resumen);

        } catch (error) {
            console.error('❌ Error generando resumen:', error);
            await context.sendActivity('❌ Error generando resumen de conversación.');
        }
    }

    /**
     * ✅ NUEVO: Limpiar historial con formato role/content
     */
    async limpiarHistorial(context, userId, conversationId) {
        try {
            console.log(`🧹 [${userId}] Limpiando historial formato role/content`);

            let mensajesEliminados = 0;

            // ✅ 1. Limpiar cache local
            if (this.conversationCache.has(conversationId)) {
                const cache = this.conversationCache.get(conversationId);
                const totalMensajes = cache.userMessages.length + cache.botMessages.length;
                
                this.conversationCache.set(conversationId, {
                    userMessages: [],
                    botMessages: []
                });
                
                mensajesEliminados += totalMensajes;
                console.log(`🧹 [${userId}] Cache local limpiado: ${totalMensajes} mensajes`);
            }

            // ✅ 2. Limpiar Cosmos DB
            if (cosmosService.isAvailable()) {
                try {
                    const eliminadosCosmosDB = await cosmosService.cleanOldMessages(conversationId, userId, 0);
                    mensajesEliminados += eliminadosCosmosDB;
                    console.log(`🧹 [${userId}] Cosmos DB limpiado: ${eliminadosCosmosDB} mensajes`);
                } catch (cosmosError) {
                    console.warn(`⚠️ [${userId}] Error limpiando Cosmos DB:`, cosmosError.message);
                }
            }

            await context.sendActivity(
                `🧹 **Historial Limpiado**\n\n` +
                `✅ **Mensajes eliminados**: ${mensajesEliminados}\n` +
                `💾 **Estado**: Conversación reiniciada\n` +
                `📋 **Formato**: Cache role/content reiniciado (0/5 user, 0/5 assistant)\n\n` +
                `Los nuevos mensajes comenzarán a guardarse automáticamente.`
            );

        } catch (error) {
            console.error('❌ Error limpiando historial:', error);
            await context.sendActivity('❌ Error limpiando historial.');
        }
    }

    /**
     * ✅ MEJORADO: Procesar mensaje con guardado en formato role/content
     */
    async processAuthenticatedMessage(context, text, userId, conversationId) {
        try {
            const userInfo = this.authenticatedUsers.get(userId);
            
            // ✅ 1. GUARDAR MENSAJE DEL USUARIO
            await this.guardarMensajeEnHistorial(
                text,
                'user',
                conversationId,
                userId,
                userInfo?.nombre || 'Usuario'
            );

            // Mostrar indicador de escritura
            await context.sendActivity({ type: 'typing' });

            console.log(`💬 [${userInfo.usuario}] Procesando mensaje autenticado: "${text}"`);

            // ✅ 2. OBTENER HISTORIAL para contexto (desde cache local)
            const conversacionFormateada = this.obtenerConversacionFormateada(conversationId);
            
            // ✅ 3. FORMATEAR para OpenAI (excluir mensaje actual)
            const historialParaIA = conversacionFormateada
                .filter(msg => msg.content !== text) // Excluir mensaje actual
                .reverse() // Orden cronológico
                .map(msg => ({
                    role: msg.role, // 'user' o 'assistant'
                    content: msg.content
                }));

            console.log(`🧠 [${userInfo.usuario}] Contexto para IA: ${historialParaIA.length} mensajes`);

            // ✅ 4. PROCESAR CON IA
            const response = await this.openaiService.procesarMensaje(
                text, 
                historialParaIA,
                userInfo.token, 
                userInfo,
                conversationId
            );

            // ✅ 5. GUARDAR RESPUESTA DEL BOT
            if (response && response.content) {
                await this.guardarMensajeEnHistorial(
                    response.content,
                    'bot',
                    conversationId,
                    userId,
                    'Nova Bot'
                );
            }

            // ✅ 6. ENVIAR RESPUESTA
            await this.sendResponse(context, response);

        } catch (error) {
            console.error(`Error procesando mensaje autenticado:`, error);
            
            if (error.message.includes('token') || error.message.includes('auth')) {
                await context.sendActivity(
                    '🔒 **Problema de autenticación**\n\n' +
                    'Tu sesión puede haber expirado. Por favor, cierra sesión e inicia nuevamente.\n\n' +
                    'Escribe `logout` para cerrar sesión.'
                );
            } else {
                await context.sendActivity('❌ Error procesando tu mensaje. Intenta nuevamente.');
            }
        }
    }

    /**
     * ✅ MEJORADO: Manejar mensajes con comandos
     */
    async handleMessageWithAuth(context, next) {
        const userId = context.activity.from.id;
        const text = (context.activity.text || '').trim();

        console.log(`[${userId}] Mensaje recibido: "${text}"`);

        try {
            // 🧪 COMANDOS DE DIAGNÓSTICO
            if (text.toLowerCase() === 'test-card' || text.toLowerCase() === 'test') {
                await this.runCardTests(context);
                return await next();
            }

            if (text.toLowerCase().startsWith('debug-api ')) {
                await this.debugNovaAPI(context, text);
                return await next();
            }

            if (text.toLowerCase() === 'clear-protection') {
                this.loginCardSentUsers.clear();
                this.welcomeMessageSent.clear();
                await context.sendActivity('🧹 **Protección limpiada** - Puedes probar login nuevamente');
                return await next();
            }

            // 🔐 COMANDOS DE LOGIN
            if (text.toLowerCase() === 'card-login' || text.toLowerCase() === 'login-card') {
                await this.showLoginCard(context, 'manualRequest');
                return await next();
            }

            if (text.toLowerCase().startsWith('login ')) {
                await this.handleTextLogin(context, text);
                return await next();
            }

            // 📤 SUBMIT DE TARJETA
            if (context.activity.value && context.activity.value.action === 'login') {
                await this.handleLoginSubmit(context);
                return await next();
            }

            // 🚪 LOGOUT
            if (this.isLogoutCommand(text)) {
                await this.handleLogout(context, userId);
                return await next();
            }

            // ✅ REGLA PRINCIPAL: Sin token = Sin conversación
            const isAuthenticated = await this.isUserAuthenticated(userId, context);
            
            if (!isAuthenticated) {
                console.log(`🔒 [${userId}] ACCESO DENEGADO - Usuario no autenticado`);
                
                await context.sendActivity(
                    `🔒 **Acceso Denegado**\n\n` +
                    `❌ **Sin autenticación, no hay conversación**\n\n` +
                    `Para acceder a las funciones del bot, incluida la conversación con IA, ` +
                    `**debes autenticarte primero** con tus credenciales corporativas.`
                );
                
                await this.showLoginCard(context, 'accessDenied');
                return await next();
            }

            // ✅ USUARIO AUTENTICADO: Procesar comandos
            console.log(`✅ [${userId}] Usuario autenticado - procesando mensaje`);
            const conversationId = context.activity.conversation.id;

            // ✅ COMANDOS DE HISTORIAL (NUEVO FORMATO)
            const lowerText = text.toLowerCase();
            
            if (lowerText === 'historial' || lowerText.includes('historial')) {
                if (lowerText.includes('limpiar') || lowerText.includes('borrar') || lowerText.includes('eliminar')) {
                    await this.limpiarHistorial(context, userId, conversationId);
                } else {
                    await this.showConversationHistory(context, userId, conversationId);
                }
                return await next();
            }

            // ✅ COMANDOS DE CONVERSACIÓN OpenAI
            if (lowerText === 'limpiar conversacion' || lowerText === 'limpiar formato openai') {
                await this.limpiarConversacionFormatoOpenAI(context, userId, conversationId);
                return await next();
            }
            
            if (lowerText === 'resumen' || lowerText.includes('resumen')) {
                await this.showConversationSummary(context, userId, conversationId);
                return await next();
            }

            // ✅ OTROS COMANDOS
            if (text.toLowerCase() === 'mi info' || text.toLowerCase() === 'info' || text.toLowerCase() === 'perfil') {
                await this.showUserInfo(context, userId);
                return await next();
            }

            if (text.toLowerCase() === 'ayuda' || text.toLowerCase() === 'help') {
                await this.showHelp(context, userId);
                return await next();
            }

            // ✅ INICIALIZAR conversación si es necesario
            if (cosmosService.isAvailable()) {
                const userInfo = await this.getUserInfo(userId);
                const conversationExists = await cosmosService.getConversationInfo(conversationId, userInfo.usuario);
                if (!conversationExists) {
                    console.log(`📝 [${userId}] Inicializando conversación en Cosmos DB`);
                    await this.initializeConversation(context, userId);
                }
            }

            // 💬 PROCESAR MENSAJE CON IA
            await this.processAuthenticatedMessage(context, text, userId, conversationId);

        } catch (error) {
            console.error(`[${userId}] Error:`, error);
            await context.sendActivity(
                '❌ **Error procesando mensaje**\n\n' +
                'Ocurrió un error inesperado. Si el problema persiste, ' +
                'intenta cerrar sesión (`logout`) y volver a autenticarte.'
            );
        }

        await next();
    }

    // ===== MANTENER TODOS LOS MÉTODOS EXISTENTES =====

    async showLoginCard(context, caller = 'unknown') {
        const userId = context.activity.from.id;
        
        try {
            console.log(`\n🔐 [${userId}] ===== INICIO showLoginCard =====`);
            console.log(`📞 [${userId}] Llamado desde: ${caller}`);

            if (this.loginCardSentUsers.has(userId)) {
                console.log(`⚠️ [${userId}] Tarjeta ya enviada recientemente, saltando...`);
                return;
            }

            const loginCard = this.createMinimalLoginCard();
            await context.sendActivity({ attachments: [loginCard] });

            this.loginCardSentUsers.add(userId);
            
            setTimeout(() => {
                this.loginCardSentUsers.delete(userId);
                console.log(`🧹 [${userId}] Protección anti-duplicados limpiada`);
            }, 30000);

            console.log(`✅ [${userId}] Tarjeta enviada exitosamente`);

        } catch (error) {
            console.error(`❌ [${userId}] Error enviando tarjeta de login:`, error);
            this.loginCardSentUsers.delete(userId);
            
            await context.sendActivity(
                '🔐 **Bienvenido a Nova Bot**\n\n' +
                '❌ **Error con la tarjeta**\n\n' +
                '🔄 **Usa el método alternativo:**\n' +
                'Escribe: `login usuario:contraseña`\n\n' +
                'Ejemplo: `login 91004:mipassword`'
            );
        }
    }

    createMinimalLoginCard() {
        const card = {
            type: 'AdaptiveCard',
            version: '1.0',
            body: [
                {
                    type: 'TextBlock',
                    text: 'Iniciar Sesión',
                    size: 'Large',
                    weight: 'Bolder'
                },
                {
                    type: 'TextBlock',
                    text: 'Ingresa tus credenciales corporativas:',
                    wrap: true
                },
                {
                    type: 'Input.Text',
                    id: 'username',
                    placeholder: 'Usuario (ej: 91004)'
                },
                {
                    type: 'Input.Text',
                    id: 'password',
                    placeholder: 'Contraseña',
                    style: 'Password'
                },
                {
                    type: 'TextBlock',
                    text: '🔒 Conexión segura',
                    size: 'Small'
                }
            ],
            actions: [
                {
                    type: 'Action.Submit',
                    title: '🚀 Iniciar Sesión',
                    data: { action: 'login' }
                }
            ]
        };

        return CardFactory.adaptiveCard(card);
    }

    async handleTextLogin(context, text) {
        const userId = context.activity.from.id;
        
        try {
            console.log(`[${userId}] Login con texto: ${text}`);

            const loginPart = text.substring(6).trim();
            const [username, password] = loginPart.split(':');

            if (!username || !password) {
                await context.sendActivity(
                    '❌ **Formato incorrecto**\n\n' +
                    '✅ **Formato correcto**: `login usuario:contraseña`\n' +
                    '📝 **Ejemplo**: `login 91004:mipassword`'
                );
                return;
            }

            await context.sendActivity({ type: 'typing' });
            const loginResponse = await this.authenticateWithNova(username.trim(), password.trim());

            if (loginResponse.success) {
                this.loginCardSentUsers.delete(userId);
                await this.setUserAuthenticated(userId, loginResponse.userInfo, context);
                await this.initializeConversation(context, userId);
                
                await context.sendActivity(
                    `✅ **¡Login exitoso!**\n\n` +
                    `👋 Bienvenido, **${loginResponse.userInfo.nombre}**\n` +
                    `👤 Usuario: ${loginResponse.userInfo.usuario}\n` +
                    `🔑 Token: ${loginResponse.userInfo.token.substring(0, 20)}...\n` +
                    `💾 **Formato**: role/content (5 user + 5 assistant)\n` +
                    `${cosmosService.isAvailable() ? 
                        '💾 **Persistencia**: Cosmos DB + memoria\n' : 
                        '⚠️ **Solo memoria**: Conversaciones temporales\n'}\n` +
                    `💬 Ya puedes usar el bot normalmente.`
                );
            } else {
                await context.sendActivity(
                    `❌ **Error de autenticación**\n\n` +
                    `${loginResponse.message}\n\n` +
                    `🔄 Intenta nuevamente con el formato correcto.`
                );
            }

        } catch (error) {
            console.error(`[${userId}] Error en login con texto:`, error);
            await context.sendActivity('❌ Error procesando login.');
        }
    }

    async handleLoginSubmit(context) {
        const userId = context.activity.from.id;
        
        try {
            console.log(`🎯 [${userId}] Submit de tarjeta recibido`);

            const value = context.activity.value || {};
            const { username, password, action } = value;

            if (action !== 'login') {
                console.log(`⚠️ [${userId}] Submit ignorado - acción: '${action}'`);
                return;
            }

            if (!username || !password) {
                await context.sendActivity('❌ **Campos incompletos**\n\nPor favor, completa usuario y contraseña.');
                await this.showLoginCard(context, 'handleLoginSubmit-incompletos');
                return;
            }

            await context.sendActivity({ type: 'typing' });
            const loginResponse = await this.authenticateWithNova(username.trim(), password.trim());

            if (loginResponse.success) {
                this.loginCardSentUsers.delete(userId);
                await this.setUserAuthenticated(userId, loginResponse.userInfo, context);
                await this.initializeConversation(context, userId);
                
                await context.sendActivity(
                    `✅ **¡Login exitoso desde tarjeta!**\n\n` +
                    `👋 Bienvenido, **${loginResponse.userInfo.nombre}**\n` +
                    `👤 Usuario: ${loginResponse.userInfo.usuario}\n` +
                    `🔑 Token: ${loginResponse.userInfo.token.substring(0, 20)}...\n` +
                    `💾 **Formato**: role/content (5 user + 5 assistant)\n` +
                    `${cosmosService.isAvailable() ? 
                        '💾 **Persistencia**: Cosmos DB + memoria\n' : 
                        '⚠️ **Solo memoria**: Conversaciones temporales\n'}\n` +
                    `💬 Ya puedes usar el bot normalmente.`
                );
            } else {
                await context.sendActivity(
                    `❌ **Error de autenticación**\n\n` +
                    `${loginResponse.message}\n\n` +
                    `🔄 Intenta nuevamente.`
                );
                await this.showLoginCard(context, 'handleLoginSubmit-fallido');
            }

        } catch (error) {
            console.error(`💥 [${userId}] Error en submit de tarjeta:`, error);
            await context.sendActivity('❌ Error procesando tarjeta de login.');
        }
    }

    async authenticateWithNova(username, password) {
        try {
            console.log(`🔐 Autenticando: ${username}`);
            const url = process.env.NOVA_API_URL || 'https://pruebas.nova.com.mx/ApiRestNova/api/Auth/login';
            const response = await axios.post(
               url,
                {
                    cveUsuario: username,
                    password: password
                },
                {
                    headers: {
                        'Content-Type': 'application/json',
                        'Accept': 'application/json'
                    },
                    timeout: 15000
                }
            );

            let parsedData = response.data;
            
            if (typeof response.data === 'string') {
                try {
                    parsedData = JSON.parse(response.data);
                } catch (parseError) {
                    return {
                        success: false,
                        message: 'Error procesando respuesta del servidor'
                    };
                }
            }

            if (parsedData && parsedData.info && parsedData.info.length > 0) {
                const rawUserInfo = parsedData.info[0];
                
                if (rawUserInfo.EsValido === 0 && rawUserInfo.Token && rawUserInfo.Token.trim().length > 0) {
                    const cleanUserInfo = {
                        usuario: rawUserInfo.CveUsuario ? rawUserInfo.CveUsuario.toString().trim() : username,
                        nombre: rawUserInfo.Nombre ? rawUserInfo.Nombre.replace(/\t/g, '').trim() : 'Usuario',
                        paterno: rawUserInfo.Paterno ? rawUserInfo.Paterno.replace(/\t/g, '').trim() : '',
                        materno: rawUserInfo.Materno ? rawUserInfo.Materno.replace(/\t/g, '').trim() : '',
                        token: rawUserInfo.Token.trim(),
                        mensaje: rawUserInfo.Mensaje ? rawUserInfo.Mensaje.trim() : 'Login exitoso'
                    };
                    
                    return {
                        success: true,
                        userInfo: cleanUserInfo
                    };
                } else {
                    return {
                        success: false,
                        message: rawUserInfo.Mensaje || 'Credenciales inválidas'
                    };
                }
            } else {
                return {
                    success: false,
                    message: 'Respuesta inesperada del servidor'
                };
            }

        } catch (error) {
            console.error('❌ Error Nova API:', error.message);
            
            if (error.response) {
                return {
                    success: false,
                    message: `Error del servidor: ${error.response.status}`
                };
            } else if (error.code === 'ECONNREFUSED') {
                return {
                    success: false,
                    message: 'No se pudo conectar con el servidor'
                };
            } else if (error.code === 'ECONNABORTED') {
                return {
                    success: false,
                    message: 'Timeout - servidor lento'
                };
            } else {
                return {
                    success: false,
                    message: 'Error de conexión'
                };
            }
        }
    }

    // ===== MÉTODOS AUXILIARES =====

    isLogoutCommand(text) {
        return ['logout', 'cerrar sesion', 'cerrar sesión', 'salir'].includes(text.toLowerCase());
    }

    async isUserAuthenticated(userId, context) {
        try {
            const memoryAuth = this.authenticatedUsers.has(userId);
            const authData = await this.authState.get(context, {});
            const persistentAuth = authData[userId]?.authenticated === true;
            
            if (memoryAuth && !persistentAuth) {
                await this.syncPersistentAuth(userId, context);
                return true;
            } else if (!memoryAuth && persistentAuth) {
                await this.syncMemoryAuth(userId, context, authData[userId]);
                return true;
            }
            
            return memoryAuth && persistentAuth;
            
        } catch (error) {
            console.error(`Error verificando auth:`, error);
            return false;
        }
    }

    async syncPersistentAuth(userId, context) {
        try {
            const userInfo = this.authenticatedUsers.get(userId);
            if (userInfo) {
                const authData = await this.authState.get(context, {});
                authData[userId] = {
                    authenticated: true,
                    ...userInfo,
                    lastAuthenticated: new Date().toISOString()
                };
                await this.authState.set(context, authData);
                await this.userState.saveChanges(context);
            }
        } catch (error) {
            console.error(`Error sync persistente:`, error);
        }
    }

    async syncMemoryAuth(userId, context, authData) {
        try {
            if (authData && authData.authenticated) {
                this.authenticatedUsers.set(userId, {
                    usuario: authData.usuario,
                    nombre: authData.nombre,
                    token: authData.token
                });
            }
        } catch (error) {
            console.error(`Error sync memoria:`, error);
        }
    }

    async setUserAuthenticated(userId, userInfo, context) {
        try {
            this.authenticatedUsers.set(userId, userInfo);

            const authData = await this.authState.get(context, {});
            authData[userId] = {
                authenticated: true,
                ...userInfo,
                lastAuthenticated: new Date().toISOString()
            };
            await this.authState.set(context, authData);
            await this.userState.saveChanges(context);

            console.log(`[${userId}] Autenticación establecida`);
            return true;
            
        } catch (error) {
            console.error(`Error estableciendo auth:`, error);
            return false;
        }
    }

    async sendResponse(context, response) {
        try {
            if (response.type === 'card') {
                if (response.content) {
                    await context.sendActivity(response.content);
                }
                if (response.card) {
                    await context.sendActivity({ attachments: [response.card] });
                }
            } else {
                const responseContent = response.content || response;
                await context.sendActivity(responseContent);
            }
        } catch (error) {
            console.error('Error enviando respuesta:', error);
        }
    }

    async getUserToken(userId) {
        const userInfo = this.authenticatedUsers.get(userId);
        return userInfo?.token || null;
    }

    async getUserInfo(userId) {
        return this.authenticatedUsers.get(userId) || null;
    }

    async showUserInfo(context, userId) {
        try {
            const userInfo = await this.getUserInfo(userId);
            
            if (!userInfo) {
                await context.sendActivity('❌ No se pudo obtener tu información.');
                return;
            }

            let infoMessage = `👤 **Tu Información Corporativa**\n\n` +
                             `📝 **Nombre**: ${userInfo.nombre}\n` +
                             `👤 **Usuario**: ${userInfo.usuario}\n` +
                             `🏢 **Apellido Paterno**: ${userInfo.paterno || 'N/A'}\n` +
                             `🏢 **Apellido Materno**: ${userInfo.materno || 'N/A'}\n` +
                             `🔑 **Token**: ${userInfo.token.substring(0, 30)}...\n` +
                             `📅 **Última autenticación**: Hace unos momentos\n\n`;

            if (cosmosService.isAvailable()) {
                infoMessage += `💾 **Persistencia**: ✅ Cosmos DB activa\n`;
            } else {
                infoMessage += `💾 **Persistencia**: ⚠️ Solo memoria temporal\n`;
            }

            infoMessage += `💬 **¿Necesitas algo más?** Solo pregúntame.`;

            await context.sendActivity(infoMessage);

        } catch (error) {
            console.error(`Error mostrando info del usuario:`, error);
            await context.sendActivity('❌ Error obteniendo tu información.');
        }
    }

    async showHelp(context, userId) {
        try {
            const userInfo = await this.getUserInfo(userId);
            
            await context.sendActivity(
                `📚 **Ayuda - Nova Bot**\n\n` +
                `👋 Hola **${userInfo.nombre}**, aquí tienes todo lo que puedo hacer:\n\n` +
                
                `🤖 **Chat Inteligente:**\n` +
                `• Conversación natural con IA GPT-4\n` +
                `• Respuestas contextuales y memoria de conversación\n` +
                `• Formato role/content (máximo 5 mensajes usuario + 5 asistente)\n\n` +
                
                `📚 **Comandos de Historial:**\n` +
                `• \`historial\` - Ver últimos mensajes en formato role/content\n` +
                `• \`resumen\` - Resumen inteligente de la conversación\n` +
                `• \`limpiar historial\` - Eliminar cache de mensajes\n\n` +
                
                `🤖 **Comandos OpenAI:**\n` +
                `• \`limpiar conversacion\` - Limpiar formato OpenAI\n\n` +
                
                `👤 **Comandos de Usuario:**\n` +
                `• \`mi info\` - Ver tu información completa\n` +
                `• \`logout\` - Cerrar sesión\n` +
                `• \`ayuda\` - Mostrar esta ayuda\n\n` +
                
                `🔒 **Persistencia Actual:**\n` +
                `• ${cosmosService.isAvailable() ? 
                    'Cosmos DB: Mensajes guardados permanentemente' : 
                    'Solo memoria: Mensajes temporales'}\n` +
                `• Cache local: 5 mensajes usuario + 5 asistente\n` +
                `• Rotación automática: Se eliminan los más antiguos\n\n` +
                
                `💡 **Prueba el nuevo formato:**\n` +
                `1. Envía algunos mensajes\n` +
                `2. Escribe \`historial\` para ver formato role/content\n` +
                `3. Escribe \`resumen\` para análisis inteligente`
            );

        } catch (error) {
            console.error(`Error mostrando ayuda:`, error);
            await context.sendActivity('❌ Error mostrando ayuda.');
        }
    }

    async handleLogout(context, userId) {
        try {
            console.log(`🚪 [${userId}] Iniciando logout con limpieza completa...`);
            
            const userInfo = await this.getUserInfo(userId);
            const userName = userInfo ? userInfo.nombre : 'Usuario';
            const conversationId = context.activity.conversation.id;
            
            // ✅ LIMPIAR cache local role/content
            if (this.conversationCache.has(conversationId)) {
                this.conversationCache.delete(conversationId);
                console.log(`🗑️ [${userId}] Cache role/content limpiado`);
            }
            
            // Limpiar datos de autenticación
            this.authenticatedUsers.delete(userId);
            const authData = await this.authState.get(context, {});
            delete authData[userId];
            await this.authState.set(context, authData);
            await this.userState.saveChanges(context);
            
            // Limpiar protecciones
            this.loginCardSentUsers.delete(userId);
            this.welcomeMessageSent.delete(userId);
            
            await context.sendActivity(
                `👋 **¡Hasta luego, ${userName}!**\n\n` +
                `✅ Tu sesión ha sido cerrada correctamente.\n` +
                `🗑️ Cache de conversación limpiado (role/content)\n` +
                `🔒 Para volver a usar el bot, necesitarás autenticarte nuevamente.`
            );
            
            await new Promise(resolve => setTimeout(resolve, 2000));
            
            await context.sendActivity('🔐 **¿Quieres iniciar sesión nuevamente?**');
            await this.showLoginCard(context, 'postLogout');
            
        } catch (error) {
            console.error(`Error en logout:`, error);
            await context.sendActivity('❌ Error cerrando sesión, pero tu sesión ha sido terminada.');
        }
    }

    async initializeConversation(context, userId) {
        try {
            if (!cosmosService.isAvailable()) {
                console.log(`ℹ️ [${userId}] Cosmos DB no disponible - conversación solo en memoria`);
                return;
            }

            const conversationId = context.activity.conversation.id;
            const userInfo = await this.getUserInfo(userId);
            
            console.log(`💾 [${userId}] Inicializando conversación en Cosmos DB: ${conversationId}`);
            
            await cosmosService.saveConversationInfo(
                conversationId,
                userInfo?.usuario,
                userInfo?.nombre || 'Usuario',
                {
                    userInfo: userInfo,
                    channelId: context.activity.channelId,
                    serviceUrl: context.activity.serviceUrl,
                    formatoRoleContent: true // ✅ MARCAR nuevo formato
                }
            );
            
            console.log(`✅ [${userId}] Conversación inicializada en Cosmos DB`);
            
        } catch (error) {
            console.error(`❌ Error inicializando conversación:`, error);
        }
    }

    // ✅ MANTENER métodos para formato OpenAI (compatibilidad)
    async showConversationFormatOpenAI(context, userId, conversationId) {
        try {
            if (!cosmosService.isAvailable()) {
                await context.sendActivity('❌ Esta funcionalidad requiere Cosmos DB configurado.');
                return;
            }

            const conversationMessages = await cosmosService.getConversationMessages(conversationId, userId);
            
            if (!conversationMessages || conversationMessages.length === 0) {
                await context.sendActivity(
                    `📚 **Conversación en Formato OpenAI**\n\n` +
                    `❌ **No hay mensajes en formato OpenAI**\n\n` +
                    `Esta funcionalidad requiere mensajes guardados en Cosmos DB.`
                );
                return;
            }

            let respuesta = `📚 **Conversación en Formato OpenAI (${conversationMessages.length} mensajes)**\n\n`;
            respuesta += `💾 **Persistencia**: Cosmos DB activo\n`;
            respuesta += `🔗 **Formato**: Compatible con OpenAI Chat API\n\n`;

            respuesta += `**Estructura JSON:**\n`;
            respuesta += `\`\`\`json\n`;
            respuesta += JSON.stringify(conversationMessages.slice(0, 5), null, 2); // Solo mostrar algunos
            respuesta += `\n\`\`\`\n\n`;

            await context.sendActivity(respuesta);

        } catch (error) {
            console.error('❌ Error mostrando conversación OpenAI:', error);
            await context.sendActivity('❌ Error obteniendo conversación en formato OpenAI.');
        }
    }

    async limpiarConversacionFormatoOpenAI(context, userId, conversationId) {
        try {
            if (!cosmosService.isAvailable()) {
                await context.sendActivity('❌ Esta funcionalidad requiere Cosmos DB configurado.');
                return;
            }

            const result = await cosmosService.cleanConversationMessages(conversationId, userId);

            if (result) {
                await context.sendActivity(
                    `🧹 **Conversación OpenAI Limpiada**\n\n` +
                    `✅ **Estado**: Formato OpenAI eliminado\n` +
                    `📝 **Nota**: El historial role/content se mantiene\n`
                );
            } else {
                await context.sendActivity('❌ Error limpiando conversación OpenAI.');
            }

        } catch (error) {
            console.error('❌ Error limpiando conversación OpenAI:', error);
            await context.sendActivity('❌ Error limpiando conversación.');
        }
    }

    getStats() {
        const totalCacheMessages = Array.from(this.conversationCache.values())
            .reduce((total, cache) => total + cache.userMessages.length + cache.botMessages.length, 0);

        return {
            authenticatedUsers: this.authenticatedUsers.size,
            loginCardsPending: this.loginCardSentUsers.size,
            welcomeMessagesSent: this.welcomeMessageSent.size,
            openaiAvailable: this.openaiService?.openaiAvailable || false,
            cosmosDBAvailable: cosmosService.isAvailable(),
            persistenceType: cosmosService.isAvailable() ? 'CosmosDB+Memory-RoleContent' : 'Memory-RoleContent',
            conversacionesActivas: this.conversationCache.size,
            mensajesEnCache: totalCacheMessages,
            formatoRoleContent: {
                conversaciones: this.conversationCache.size,
                totalMensajes: totalCacheMessages,
                maxPorConversacion: '5 user + 5 assistant',
                rotacionAutomatica: true
            },
            timestamp: new Date().toISOString(),
            version: '2.1.3-RoleContentFormat'
        };
    }

    cleanup() {
        console.log('🧹 Limpiando TeamsBot...');
        this.authenticatedUsers.clear();
        this.loginCardSentUsers.clear();
        this.welcomeMessageSent.clear();
        this.conversationCache.clear(); // ✅ LIMPIAR cache role/content
        console.log('✅ TeamsBot limpiado');
    }

    // ===== MÉTODOS DE DIAGNÓSTICO (mantener para desarrollo) =====
    async debugNovaAPI(context, text) {
        const userId = context.activity.from.id;
        const parts = text.split(' ');
        
        if (parts.length < 3) {
            await context.sendActivity('❌ Uso: `debug-api usuario contraseña`');
            return;
        }

        const [, username, password] = parts;
        
        try {
            await context.sendActivity({ type: 'typing' });
            console.log(`🔧 [${userId}] Debug Nova API: ${username}`);
            
            const result = await this.authenticateWithNova(username, password);
            
            await context.sendActivity(
                `🔧 **Debug Nova API**\n\n` +
                `👤 **Usuario**: ${username}\n` +
                `✅ **Resultado**: ${result.success ? 'Éxito' : 'Fallo'}\n` +
                `📝 **Mensaje**: ${result.message || 'N/A'}\n` +
                `${result.userInfo ? `🔑 **Token Preview**: ${result.userInfo.token.substring(0, 30)}...` : ''}`
            );
            
        } catch (error) {
            await context.sendActivity(`❌ **Error en debug**: ${error.message}`);
        }
    }

    async runCardTests(context) {
        const userId = context.activity.from.id;
        
        try {
            console.log(`🧪 [${userId}] Ejecutando tests de tarjetas`);
            
            await context.sendActivity('🧪 **Test de Tarjetas Iniciado**');
            
            // Test 1: Tarjeta básica
            await context.sendActivity('🧪 **Test 1**: Tarjeta básica');
            await context.sendActivity({ attachments: [this.createSimpleTestCard()] });
            
            // Test 2: Tarjeta con inputs
            await context.sendActivity('🧪 **Test 2**: Tarjeta con inputs');
            await context.sendActivity({ attachments: [this.createInputTestCard()] });
            
            await context.sendActivity('✅ **Tests completados** - Si ves las tarjetas, todo funciona correctamente');
            
        } catch (error) {
            console.error(`❌ [${userId}] Error en tests:`, error);
            await context.sendActivity('❌ Error ejecutando tests de tarjetas');
        }
    }

    createSimpleTestCard() {
        return CardFactory.adaptiveCard({
            type: 'AdaptiveCard',
            version: '1.0',
            body: [
                {
                    type: 'TextBlock',
                    text: 'Test Básico',
                    weight: 'Bolder'
                },
                {
                    type: 'TextBlock',
                    text: 'Si ves esto, las tarjetas funcionan.',
                    wrap: true
                }
            ]
        });
    }

    createInputTestCard() {
        return CardFactory.adaptiveCard({
            type: 'AdaptiveCard',
            version: '1.0',
            body: [
                {
                    type: 'TextBlock',
                    text: 'Test de Inputs',
                    weight: 'Bolder'
                },
                {
                    type: 'Input.Text',
                    id: 'testInput',
                    placeholder: 'Escribe algo'
                }
            ],
            actions: [
                {
                    type: 'Action.Submit',
                    title: 'Test Submit',
                    data: { action: 'test' }
                }
            ]
        });
    }
}
