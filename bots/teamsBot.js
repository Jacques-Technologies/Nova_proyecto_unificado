// bots/teamsBot.js - v4.0 CLEAN ARCHITECTURE
// Filosofía: Minimalista, Funcional, Sin Estado en Memoria
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

// Servicios globales singleton
const cosmos = new CosmosService();
const ai = new AzureOpenAIService();
const auth = new AuthService(cosmos);

/**
 * TeamsBot v4.0 - Ultra simplificado
 *
 * Características:
 * - ✅ Sin cache local (100% Cosmos DB)
 * - ✅ Sin comandos especiales (solo login/logout)
 * - ✅ Todo mensaje autenticado → IA
 * - ✅ Stateless (sobrevive reinicios)
 * - ✅ ~350 líneas (vs 835 en v3.0)
 */
export default class TeamsBot extends DialogBot {
    constructor(conversationState, userState) {
        super(conversationState, userState);

        global.botInstance = this;
        this.auth = auth;
        this.ai = ai;
        this.loginCards = new Set(); // Anti-spam de login cards

        console.log('✅ TeamsBot v4.0 inicializado');
        console.log(`💾 Cosmos DB: ${cosmos.isAvailable() ? 'Activo' : 'No disponible'}`);
        console.log(`🤖 OpenAI: ${ai.isAvailable() ? 'Activo' : 'No disponible'}`);
    }

    // ==========================================
    // EVENTOS
    // ==========================================

    async handleMembersAdded(context, next) {
        const membersAdded = context.activity.membersAdded;

        for (const member of membersAdded) {
            if (member.id !== context.activity.recipient.id) {
                console.log(`👋 Nuevo miembro: ${member.id}`);

                // Mostrar login card automáticamente
                await context.sendActivity(
                    '👋 **¡Bienvenido a Nova Bot!**\n\n' +
                    'Soy tu asistente inteligente corporativo.\n' +
                    'Para comenzar, debes autenticarte con tus credenciales.'
                );

                await this.showLoginCard(context, member.id);
            }
        }

        await next();
    }

    // ==========================================
    // MANEJO DE ADAPTIVE CARDS
    // ==========================================
    // ⚠️ CRÍTICO: Este método SOBRESCRIBE el método base de TeamsActivityHandler
    // NO llamar desde el constructor - el Bot Framework lo invoca automáticamente

    async onAdaptiveCardInvoke(context, invokeValue) {
        console.log(`\n🔔 ========== onAdaptiveCardInvoke LLAMADO ==========`);
        console.log(`   Activity type: ${context.activity.type}`);
        console.log(`   Activity name: ${context.activity.name}`);
        console.log(`   invokeValue:`, JSON.stringify(invokeValue).substring(0, 200));
        console.log(`   activity.value:`, JSON.stringify(context.activity.value).substring(0, 200));
        console.log(`🔔 ===================================================\n`);

        const userId = context.activity.from.id;
        const data = context.activity.value || invokeValue;

        console.log(`🎴 [${userId.substring(0, 8)}...] Card recibido: ${data.action || 'unknown'}`);

        // Helper para crear response card
        const createResponse = (text, color = 'Attention') => ({
            statusCode: 200,
            type: 'application/vnd.microsoft.card.adaptive',
            value: {
                type: 'AdaptiveCard',
                version: '1.4',
                body: [{ type: 'TextBlock', text, wrap: true, color }]
            }
        });

        try {
            if (data.action === 'login') {
                const { username, password } = data;
                if (!username || !password) {
                    return createResponse('❌ Completa usuario y contraseña');
                }

                // Typing indicator para mejor UX
                await context.sendActivity({ type: 'typing' });

                console.log(`🔐 [${userId.substring(0, 8)}...] Autenticando: ${username}`);
                const result = await auth.authenticateWithNova(username.trim(), password.trim());

                if (result.success) {
                    await auth.setUserAuthenticated(userId, result.userInfo);
                    this.loginCards.delete(userId);
                    console.log(`✅ [${userId.substring(0, 8)}...] Login exitoso`);

                    const welcome = `✅ **¡Login exitoso!**\n\n` +
                                  `👋 Bienvenido, **${result.userInfo.nombre}**\n` +
                                  `👤 Usuario: ${result.userInfo.usuario}\n` +
                                  `🔑 Token: ${result.userInfo.token.substring(0, 20)}...\n` +
                                  (cosmos.isAvailable()
                                      ? '💾 Cosmos DB activo - Conversaciones persistentes\n'
                                      : '⚠️ Solo memoria - Conversaciones temporales\n') +
                                  `\n💬 Ya puedes usar el bot normalmente.`;

                    await context.sendActivity(welcome);
                    return createResponse(`✅ Autenticado como ${result.userInfo.nombre}`, 'Good');
                } else {
                    console.log(`❌ [${userId.substring(0, 8)}...] Login fallido`);
                    return createResponse(`❌ ${result.message || 'Credenciales inválidas'}`);
                }
            }

            return { statusCode: 200 };
        } catch (error) {
            console.error(`❌ Error procesando card:`, error);
            return createResponse('❌ Error procesando la tarjeta');
        }
    }

    // ==========================================
    // FLUJO PRINCIPAL DE MENSAJES
    // ==========================================

    async handleMessage(context, next) {
        const userId = context.activity.from.id;
        const text = (context.activity.text || '').trim();

        // 🔍 DEBUG: Log completo de la actividad
        console.log(`\n🔍 ========== ACTIVITY DEBUG ==========`);
        console.log(`   Type: ${context.activity.type}`);
        console.log(`   Name: ${context.activity.name || 'N/A'}`);
        console.log(`   Text: ${text || '(vacío)'}`);
        console.log(`   Has Value: ${!!context.activity.value}`);
        if (context.activity.value) {
            console.log(`   Value:`, JSON.stringify(context.activity.value).substring(0, 200));
        }
        console.log(`🔍 =====================================\n`);

        // 🔍 DEBUG: Detectar si es un submit de Adaptive Card (legacy)
        if (context.activity.value && !text) {
            console.log(`🎴 SUBMIT DE ADAPTIVE CARD DETECTADO (type: message con value)`);
            console.log(`   Data recibido:`, context.activity.value);

            // Manejar como submit de card
            const submitData = context.activity.value;
            if (submitData.action === 'login') {
                console.log(`🔐 Login desde card (legacy mode)`);
                const { username, password } = submitData;

                if (!username || !password) {
                    await context.sendActivity('❌ Completa usuario y contraseña');
                    return await next();
                }

                await this.authenticate(context, username.trim(), password.trim(), userId);
                return await next();
            }
        }

        if (!text) return await next();

        console.log(`📨 [${userId.substring(0, 8)}...] "${text.substring(0, 50)}..."`);

        try{
            // 1. Comandos de login (sin autenticación requerida)
            if (await this.handleLoginCommands(context, text, userId)) {
                return await next();
            }

            // 2. Comando logout (con autenticación)
            if (this.isLogout(text)) {
                await this.logout(context, userId);
                return await next();
            }

            // 3. Verificar autenticación
            const isAuth = await auth.isUserAuthenticated(userId);
            if (!isAuth) {
                await this.showAccessDenied(context, userId);
                return await next();
            }

            // 4. TODO mensaje autenticado → IA
            await this.processWithAI(context, text, userId);

        } catch (error) {
            console.error(`❌ [${userId.substring(0, 8)}...] Error:`, error);
            await context.sendActivity('❌ Error procesando mensaje. Intenta nuevamente.');
        }

        await next();
    }

    // ==========================================
    // PROCESAMIENTO CON IA
    // ==========================================

    async processWithAI(context, text, userId) {
        try {
            const userInfo = await auth.getUserInfo(userId);
            if (!userInfo) {
                await context.sendActivity('❌ Error obteniendo información del usuario.');
                return;
            }

            // 1. Guardar mensaje del usuario
            await this.saveMessage(userId, 'user', text);

            // 2. Indicador de escritura
            await context.sendActivity({ type: 'typing' });

            console.log(`🤖 [${userInfo.usuario}] Procesando con IA...`);

            // 3. Procesar con IA
            // Nota: openaiService carga automáticamente el historial desde Cosmos DB
            const response = await ai.procesarMensaje(
                text,
                [], // Sin historial local - se carga desde Cosmos
                userInfo.token,
                userInfo,
                context.activity.conversation.id,
                userId
            );

            // 4. Guardar respuesta
            if (response?.content) {
                await this.saveMessage(userId, 'assistant', response.content);
            }

            // 5. Enviar respuesta
            await context.sendActivity(response?.content || 'Sin respuesta');

        } catch (error) {
            console.error(`❌ Error procesando con IA:`, error);

            if (error.message?.includes('token') || error.message?.includes('auth')) {
                await context.sendActivity(
                    '🔒 **Sesión expirada**\n\n' +
                    'Tu sesión ha expirado. Escribe `logout` y vuelve a iniciar sesión.'
                );
            } else {
                await context.sendActivity('❌ Error procesando tu mensaje.');
            }
        }
    }

    // ==========================================
    // LOGIN / LOGOUT
    // ==========================================

    async handleLoginCommands(context, text, userId) {
        // Comando: card-login o login-card
        if (text.toLowerCase() === 'card-login' || text.toLowerCase() === 'login-card') {
            await this.showLoginCard(context, userId);
            return true;
        }

        // Comando: login usuario:password
        if (text.toLowerCase().startsWith('login ')) {
            await this.loginWithText(context, text, userId);
            return true;
        }

        return false;
    }

    async showLoginCard(context, userId) {
        // Anti-spam: solo una tarjeta cada 30 segundos
        if (this.loginCards.has(userId)) {
            console.log(`⚠️ [${userId.substring(0, 8)}...] Login card anti-spam`);
            return;
        }

        try {
            await context.sendActivity({ attachments: [createLoginCard()] });

            this.loginCards.add(userId);
            setTimeout(() => this.loginCards.delete(userId), 30000);

            console.log(`🔐 [${userId.substring(0, 8)}...] Login card enviada`);
        } catch (error) {
            console.error(`❌ Error enviando login card:`, error);
            await context.sendActivity(createTextLoginInstructions());
        }
    }

    async loginWithText(context, text, userId) {
        const credentials = text.substring(6).trim();
        const [username, password] = credentials.split(':');

        if (!username || !password) {
            await context.sendActivity(createInvalidFormatMessage());
            return;
        }

        await this.authenticate(context, username.trim(), password.trim(), userId);
    }

    async authenticate(context, username, password, userId) {
        try {
            await context.sendActivity({ type: 'typing' });

            const result = await auth.authenticateWithNova(username, password);

            if (result.success) {
                await auth.setUserAuthenticated(userId, result.userInfo);
                this.loginCards.delete(userId);

                const welcome = createWelcomeMessage(result.userInfo);
                const persistence = cosmos.isAvailable()
                    ? '\n💾 Conversaciones guardadas en Cosmos DB'
                    : '\n⚠️ Conversaciones solo en memoria';

                await context.sendActivity(welcome + persistence);
                console.log(`✅ [${userId.substring(0, 8)}...] Login exitoso: ${username}`);
            } else {
                await context.sendActivity(createAuthErrorMessage(result.message));
                console.log(`❌ [${userId.substring(0, 8)}...] Login fallido: ${username}`);
            }
        } catch (error) {
            console.error(`❌ Error autenticando:`, error);
            await context.sendActivity('❌ Error en autenticación.');
        }
    }

    async logout(context, userId) {
        try {
            const userInfo = await auth.getUserInfo(userId);
            const name = userInfo?.nombre || 'Usuario';

            await auth.clearUserAuthentication(userId);
            this.loginCards.delete(userId);

            await context.sendActivity(
                `👋 **¡Hasta luego, ${name}!**\n\n` +
                `✅ Sesión cerrada correctamente.`
            );

            setTimeout(async () => {
                await context.sendActivity('🔐 **¿Iniciar sesión nuevamente?**');
                await this.showLoginCard(context, userId);
            }, 2000);

            console.log(`🚪 [${userId.substring(0, 8)}...] Logout exitoso`);
        } catch (error) {
            console.error(`❌ Error logout:`, error);
            await context.sendActivity('✅ Sesión cerrada (con errores).');
        }
    }

    async showAccessDenied(context, userId) {
        await context.sendActivity(
            '🔒 **Acceso Denegado**\n\n' +
            'Debes autenticarte para usar el bot.'
        );
        await this.showLoginCard(context, userId);
        console.log(`🔒 [${userId.substring(0, 8)}...] Acceso denegado`);
    }

    // ==========================================
    // UTILIDADES
    // ==========================================

    async saveMessage(userId, role, content) {
        if (!cosmos.isAvailable()) return;

        try {
            await cosmos.saveMessage(userId, role, content);
            console.log(`💾 [${userId.substring(0, 8)}...] ${role} guardado`);
        } catch (error) {
            console.warn(`⚠️ Error guardando mensaje:`, error.message);
        }
    }

    isLogout(text) {
        return auth.isLogoutCommand(text);
    }

    async getStats() {
        const authStats = await auth.getStats();

        return {
            version: '4.0.0-CleanArchitecture',
            loginCardsPending: this.loginCards.size,
            cosmosDB: cosmos.isAvailable(),
            openAI: ai.isAvailable(),
            persistenceType: cosmos.isAvailable() ? 'Cosmos-Only' : 'Memory-Only',
            authenticatedUsers: authStats?.authenticatedUsers || 0,
            timestamp: new Date().toISOString()
        };
    }

    cleanup() {
        this.loginCards.clear();
        console.log('✅ TeamsBot limpiado');
    }
}
