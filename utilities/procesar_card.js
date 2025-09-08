// utilities/procesar_card.js - Procesamiento simplificado de tarjetas

/**
 * Maneja el submit de tarjetas adaptativas
 * Versión simplificada sin APIs externas complejas
 * 
 * @param {Object} context - Contexto del bot
 * @param {Object} data - Datos de la tarjeta
 * @param {Function} getUserToken - Función para obtener token (opcional)
 * @param {Function} handleTokenExpiration - Función para manejar expiración (opcional)
 * @param {Function} isTokenValid - Función para validar token (opcional)
 * @param {Object} openaiService - Servicio OpenAI (opcional)
 */
async function handleCardSubmit(context, data, getUserToken, handleTokenExpiration, isTokenValid, openaiService) {
    const userId = context.activity.from.id;
    
    try {
        console.log(`🃏 [${userId}] Procesando submit de tarjeta:`, JSON.stringify(data, null, 2));

        // Verificar que hay datos
        if (!data || Object.keys(data).length === 0) {
            await context.sendActivity('❌ **Error**: No se recibieron datos de la tarjeta.');
            return;
        }

        // Manejar diferentes tipos de acciones
        switch (data.action) {
            case 'login':
                // El login ya se maneja en teamsBot.js
                console.log(`🔐 [${userId}] Login detectado en card submit - delegando a TeamsBot`);
                break;

            case 'logout':
                // El logout ya se maneja en teamsBot.js
                console.log(`🚪 [${userId}] Logout detectado en card submit - delegando a TeamsBot`);
                await context.sendActivity('Por favor, escribe "logout" para cerrar sesión.');
                break;

            case 'consultar_informacion':
                // Consultar información del usuario
                await handleConsultarInformacion(context, data, userId);
                break;

            case 'ayuda':
                // Mostrar ayuda
                await handleMostrarAyuda(context, userId);
                break;

            default:
                // Acción no reconocida
                console.warn(`⚠️ [${userId}] Acción de tarjeta no reconocida: ${data.action}`);
                await context.sendActivity(
                    `❓ **Acción no reconocida**: "${data.action}"\n\n` +
                    `Las acciones disponibles son:\n` +
                    `• login - Iniciar sesión\n` +
                    `• logout - Cerrar sesión\n` +
                    `• consultar_informacion - Ver tu información\n` +
                    `• ayuda - Mostrar ayuda`
                );
                break;
        }

    } catch (error) {
        console.error(`❌ [${userId}] Error procesando tarjeta:`, error);
        await context.sendActivity(
            '❌ **Error procesando tarjeta**\n\n' +
            'Ocurrió un error al procesar la acción de la tarjeta. ' +
            'Por favor, intenta nuevamente o contacta soporte.'
        );
    }
}

/**
 * Maneja consulta de información del usuario
 */
async function handleConsultarInformacion(context, data, userId) {
    try {
        console.log(`👤 [${userId}] Consultando información del usuario`);

        // Obtener bot instance
        const bot = context.turnState.get('bot') || global.botInstance;
        
        if (bot && typeof bot.getUserInfo === 'function') {
            const userInfo = await bot.getUserInfo(userId);
            
            if (userInfo) {
                await context.sendActivity(
                    `👤 **Tu Información**\n\n` +
                    `📝 **Nombre**: ${userInfo.nombre}\n` +
                    `👤 **Usuario**: ${userInfo.usuario}\n` +
                    `🏢 **Apellido Paterno**: ${userInfo.paterno || 'N/A'}\n` +
                    `🏢 **Apellido Materno**: ${userInfo.materno || 'N/A'}\n` +
                    `🔑 **Token**: ${userInfo.token ? userInfo.token.substring(0, 30) + '...' : 'N/A'}\n\n` +
                    `💬 ¿Necesitas algo más?`
                );
            } else {
                await context.sendActivity(
                    `❌ **No estás autenticado**\n\n` +
                    `Para consultar tu información, primero debes iniciar sesión.`
                );
            }
        } else {
            console.error(`❌ [${userId}] Bot instance no disponible para consultar información`);
            await context.sendActivity(
                `❌ **Error del sistema**\n\n` +
                `No se pudo acceder a la información. Intenta nuevamente.`
            );
        }

    } catch (error) {
        console.error(`❌ [${userId}] Error consultando información:`, error);
        await context.sendActivity('❌ Error consultando tu información.');
    }
}

/**
 * Muestra información de ayuda
 */
async function handleMostrarAyuda(context, userId) {
    try {
        console.log(`❓ [${userId}] Mostrando ayuda`);

        const helpMessage = 
            `📚 **Ayuda - Nova Bot**\n\n` +
            
            `🔐 **Autenticación:**\n` +
            `• El bot mostrará automáticamente la tarjeta de login\n` +
            `• Ingresa tu usuario y contraseña corporativa\n` +
            `• Una vez autenticado, podrás usar todas las funciones\n\n` +
            
            `💬 **Comandos disponibles:**\n` +
            `• \`cualquier mensaje\` - Chat con inteligencia artificial\n` +
            `• \`logout\` - Cerrar sesión\n` +
            `• \`obtener información\` - Ver tu información personal\n` +
            `• \`ayuda\` - Mostrar esta ayuda\n\n` +
            
            `🤖 **Características:**\n` +
            `• Chat inteligente con OpenAI GPT-4\n` +
            `• Información de usuario desde token\n` +
            `• Autenticación segura con API Nova\n` +
            `• Sesiones temporales (se pierden al reiniciar)\n\n` +
            
            `❓ **¿Necesitas más ayuda?**\n` +
            `Simplemente escribe tu pregunta y el bot te ayudará.`;

        await context.sendActivity(helpMessage);

    } catch (error) {
        console.error(`❌ [${userId}] Error mostrando ayuda:`, error);
        await context.sendActivity('❌ Error mostrando ayuda.');
    }
}

/**
 * Crea una tarjeta de información del usuario
 */
function createUserInfoCard(userInfo) {
    const { CardFactory } = require('botbuilder');
    
    const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: [
            {
                type: 'TextBlock',
                text: '👤 Información del Usuario',
                size: 'Large',
                weight: 'Bolder',
                color: 'Accent'
            },
            {
                type: 'FactSet',
                facts: [
                    {
                        title: 'Nombre:',
                        value: userInfo.nombre || 'N/A'
                    },
                    {
                        title: 'Usuario:',
                        value: userInfo.usuario || 'N/A'
                    },
                    {
                        title: 'Apellido Paterno:',
                        value: userInfo.paterno || 'N/A'
                    },
                    {
                        title: 'Apellido Materno:',
                        value: userInfo.materno || 'N/A'
                    },
                    {
                        title: 'Token:',
                        value: userInfo.token ? userInfo.token.substring(0, 30) + '...' : 'N/A'
                    }
                ]
            }
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: '🔄 Actualizar',
                data: {
                    action: 'consultar_informacion'
                }
            },
            {
                type: 'Action.Submit',
                title: '❓ Ayuda',
                data: {
                    action: 'ayuda'
                }
            }
        ]
    };

    return CardFactory.adaptiveCard(card);
}

/**
 * Crea una tarjeta de ayuda
 */
function createHelpCard() {
    const { CardFactory } = require('botbuilder');
    
    const card = {
        type: 'AdaptiveCard',
        $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
        version: '1.3',
        body: [
            {
                type: 'TextBlock',
                text: '📚 Ayuda - Nova Bot',
                size: 'Large',
                weight: 'Bolder',
                color: 'Accent'
            },
            {
                type: 'TextBlock',
                text: 'Comandos disponibles:',
                weight: 'Bolder',
                spacing: 'Medium'
            },
            {
                type: 'FactSet',
                facts: [
                    {
                        title: 'Chat:',
                        value: 'Escribe cualquier mensaje'
                    },
                    {
                        title: 'Logout:',
                        value: 'Escribe "logout"'
                    },
                    {
                        title: 'Información:',
                        value: 'Escribe "obtener información"'
                    },
                    {
                        title: 'Ayuda:',
                        value: 'Escribe "ayuda"'
                    }
                ]
            }
        ],
        actions: [
            {
                type: 'Action.Submit',
                title: '👤 Mi Información',
                data: {
                    action: 'consultar_informacion'
                }
            }
        ]
    };

    return CardFactory.adaptiveCard(card);
}

module.exports = {
    handleCardSubmit,
    createUserInfoCard,
    createHelpCard
};