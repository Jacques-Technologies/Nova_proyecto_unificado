// bots/teamsBot.js - v3.1 ULTRA-SIMPLIFICADO
import DialogBot from './dialogBot.js';
import AzureOpenAIService from '../services/openaiService.js';
import CosmosService from '../services/cosmosService.js';
import AuthService from '../services/authService.js';
import {
    createLoginCard,
    createWelcomeMessage,
    createAuthErrorMessage,
    createTextLoginInstructions,
    createInvalidFormatMessage
} from '../cards/loginCard.js';
import 'dotenv/config';

const cosmosService = new CosmosService();
const openaiService = new AzureOpenAIService();
const authService = new AuthService(cosmosService);

export default class TeamsBot extends DialogBot {
    constructor(conversationState, userState) {
        super(conversationState, userState);

        global.botInstance = this;
        this.authService = authService;
        this.loginCardSentUsers = new Set(); // Anti-spam de login cards
        this.openaiService = openaiService;

        this.onMembersAdded(this.handleMembersAdded.bind(this));
        this.onMessage(this.handleMessageWithAuth.bind(this));

        console.log('✅ TeamsBot v3.1 ULTRA-SIMPLIFICADO inicializado');
        console.log(`💾 Persistencia: ${cosmosService.isAvailable() ? 'Cosmos DB activa' : 'Solo memoria'}`);
    }

    /**
     * V3.1: Guardar mensaje en Cosmos DB (sin cache local)
     */
    async guardarMensajeEnHistorial(mensaje, tipo, userId) {
        try {
            if (!mensaje || !userId) {
                console.warn('⚠️ Parámetros insuficientes para guardar mensaje');
                return false;
            }

            const role = tipo === 'bot' ? 'assistant' : 'user';

            if (cosmosService.isAvailable()) {
                await cosmosService.saveMessage(userId, role, mensaje);
                console.log(`💾 [${userId.substring(0,8)}...] ${role} → Cosmos DB`);
            }

            return true;
        } catch (error) {
            console.error(`❌ [${userId.substring(0,8)}...] Error:`, error.message);
            return false;
        }
    }

    /**
     * V3.1: Procesar mensaje autenticado (confía 100% en Cosmos DB para historial)
     */
    async processAuthenticatedMessage(context, text, userId, conversationId) {
        try {
            const userInfo = await this.getUserInfo(userId);

            // 1. Guardar mensaje del usuario
            await this.guardarMensajeEnHistorial(text, 'user', userId);

            // 2. Indicador de escritura
            await context.sendActivity({ type: 'typing' });

            console.log(`💬 [${userInfo.usuario}] Procesando: "${text.substring(0, 50)}..."`);

            // 3. Procesar con IA (openaiService carga historial desde Cosmos automáticamente)
            const response = await this.openaiService.procesarMensaje(
                text,
                [],  // Sin historial local - openaiService lo carga desde Cosmos
                userInfo.token,
                userInfo,
                conversationId,
                userId
            );

            // 4. Guardar respuesta del bot
            if (response && response.content) {
                await this.guardarMensajeEnHistorial(response.content, 'bot', userId);
            }

            // 5. Enviar respuesta
            await this.sendResponse(context, response);

        } catch (error) {
            console.error(`❌ Error procesando mensaje:`, error);

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
     * Manejar mensajes (login/logout/IA)
     */
    async handleMessageWithAuth(context, next) {
        const userId = context.activity.from.id;
        const text = (context.activity.text || '').trim();

        console.log(`[${userId}] Mensaje: "${text}"`);

        try {
            // COMANDOS DE LOGIN (sin autenticación)
            if (text.toLowerCase() === 'card-login' || text.toLowerCase() === 'login-card') {
                await this.showLoginCard(context, 'manualRequest');
                return await next();
            }

            if (text.toLowerCase().startsWith('login ')) {
                await this.handleTextLogin(context, text);
                return await next();
            }

            // SUBMIT DE TARJETA
            if (context.activity.value && context.activity.value.action === 'login') {
                await this.handleLoginSubmit(context);
                return await next();
            }

            // LOGOUT (con autenticación)
            if (this.isLogoutCommand(text)) {
                await this.handleLogout(context, userId);
                return await next();
            }

            // VERIFICAR AUTENTICACIÓN
            const isAuthenticated = await this.isUserAuthenticated(userId, context);

            if (!isAuthenticated) {
                console.log(`🔒 [${userId}] No autenticado`);
                await context.sendActivity(
                    `🔒 **Acceso Denegado**\n\n` +
                    `❌ **Sin autenticación, no hay conversación**\n\n` +
                    `Para acceder al bot, debes autenticarte primero.`
                );
                await this.showLoginCard(context, 'accessDenied');
                return await next();
            }

            // TODO MENSAJE → IA
            console.log(`✅ [${userId}] Autenticado → IA`);
            const conversationId = context.activity.conversation.id;
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

    // ===== MÉTODOS DE LOGIN/LOGOUT =====

    async showLoginCard(context, caller = 'unknown') {
        const userId = context.activity.from.id;

        try {
            console.log(`🔐 [${userId}] showLoginCard (${caller})`);

            if (this.loginCardSentUsers.has(userId)) {
                console.log(`⚠️ [${userId}] Tarjeta ya enviada, skip`);
                return;
            }

            const loginCard = createLoginCard();
            await context.sendActivity({ attachments: [loginCard] });

            this.loginCardSentUsers.add(userId);

            setTimeout(() => {
                this.loginCardSentUsers.delete(userId);
            }, 30000);

            console.log(`✅ [${userId}] Tarjeta enviada`);

        } catch (error) {
            console.error(`❌ [${userId}] Error:`, error);
            this.loginCardSentUsers.delete(userId);
            await context.sendActivity(createTextLoginInstructions());
        }
    }

    async handleTextLogin(context, text) {
        const userId = context.activity.from.id;

        try {
            const loginPart = text.substring(6).trim();
            const [username, password] = loginPart.split(':');

            if (!username || !password) {
                await context.sendActivity(createInvalidFormatMessage());
                return;
            }

            await context.sendActivity({ type: 'typing' });
            const loginResponse = await this.authService.authenticateWithNova(username.trim(), password.trim());

            if (loginResponse.success) {
                this.loginCardSentUsers.delete(userId);
                await this.authService.setUserAuthenticated(userId, loginResponse.userInfo);

                const welcomeMsg = createWelcomeMessage(loginResponse.userInfo);
                const persistenceInfo = cosmosService.isAvailable() ?
                    '\n💾 **Persistencia**: Cosmos DB activa' :
                    '\n⚠️ **Solo memoria**: Conversaciones temporales';

                await context.sendActivity(welcomeMsg + persistenceInfo);
            } else {
                await context.sendActivity(createAuthErrorMessage(loginResponse.message));
            }

        } catch (error) {
            console.error(`[${userId}] Error login:`, error);
            await context.sendActivity('❌ Error procesando login.');
        }
    }

    async handleLoginSubmit(context) {
        const userId = context.activity.from.id;

        try {
            const value = context.activity.value || {};
            const { username, password, action } = value;

            if (action !== 'login') {
                console.log(`⚠️ [${userId}] Submit ignorado: '${action}'`);
                return;
            }

            if (!username || !password) {
                await context.sendActivity('❌ **Campos incompletos**\n\nCompleta usuario y contraseña.');
                await this.showLoginCard(context, 'handleLoginSubmit-incompletos');
                return;
            }

            await context.sendActivity({ type: 'typing' });
            const loginResponse = await this.authService.authenticateWithNova(username.trim(), password.trim());

            if (loginResponse.success) {
                this.loginCardSentUsers.delete(userId);
                await this.authService.setUserAuthenticated(userId, loginResponse.userInfo);

                const welcomeMsg = createWelcomeMessage(loginResponse.userInfo);
                const persistenceInfo = cosmosService.isAvailable() ?
                    '\n💾 **Persistencia**: Cosmos DB activa' :
                    '\n⚠️ **Solo memoria**: Conversaciones temporales';

                await context.sendActivity(welcomeMsg + persistenceInfo);
            } else {
                await context.sendActivity(createAuthErrorMessage(loginResponse.message));
                await this.showLoginCard(context, 'handleLoginSubmit-fallido');
            }

        } catch (error) {
            console.error(`💥 [${userId}] Error submit:`, error);
            await context.sendActivity('❌ Error procesando login.');
        }
    }

    async handleLogout(context, userId) {
        try {
            console.log(`🚪 [${userId}] Logout`);

            const userInfo = await this.getUserInfo(userId);
            const userName = userInfo ? userInfo.nombre : 'Usuario';

            await this.authService.clearUserAuthentication(userId);
            this.loginCardSentUsers.delete(userId);

            await context.sendActivity(
                `👋 **¡Hasta luego, ${userName}!**\n\n` +
                `✅ Tu sesión ha sido cerrada correctamente.\n` +
                `🔒 Para volver a usar el bot, debes autenticarte nuevamente.`
            );

            await new Promise(resolve => setTimeout(resolve, 2000));

            await context.sendActivity('🔐 **¿Quieres iniciar sesión nuevamente?**');
            await this.showLoginCard(context, 'postLogout');

        } catch (error) {
            console.error(`Error logout:`, error);
            await context.sendActivity('❌ Error cerrando sesión, pero tu sesión ha sido terminada.');
        }
    }

    // ===== MÉTODOS AUXILIARES =====

    isLogoutCommand(text) {
        return this.authService.isLogoutCommand(text);
    }

    async isUserAuthenticated(userId, context) {
        return await this.authService.isUserAuthenticated(userId);
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
        return await this.authService.getUserToken(userId);
    }

    async getUserInfo(userId) {
        return await this.authService.getUserInfo(userId);
    }

    async getStats() {
        const authStats = await this.authService.getStats();

        return {
            authenticatedUsers: authStats.authenticatedUsers,
            loginCardsPending: this.loginCardSentUsers.size,
            openaiAvailable: this.openaiService?.openaiAvailable || false,
            cosmosDBAvailable: cosmosService.isAvailable(),
            persistenceType: cosmosService.isAvailable() ? 'CosmosDB-Only' : 'Memory-Only',
            timestamp: new Date().toISOString(),
            version: '3.1.0-UltraSimplified'
        };
    }

    cleanup() {
        console.log('🧹 Limpiando TeamsBot...');
        this.loginCardSentUsers.clear();
        console.log('✅ TeamsBot limpiado');
    }
}
