// cards/loginCard.js - AdaptiveCards para autenticación

import { CardFactory } from 'botbuilder';

/**
 * Crea una tarjeta de login minimalista
 * @returns {object} AdaptiveCard de login
 */
export function createLoginCard() {
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

/**
 * Crea mensaje de bienvenida tras login exitoso
 * @param {object} userInfo - Información del usuario
 * @returns {string} Mensaje de bienvenida
 */
export function createWelcomeMessage(userInfo) {
    return `✅ **¡Bienvenido ${userInfo.nombre}!**\n\n` +
           `🎉 **Has iniciado sesión exitosamente**\n\n` +
           `👤 **Usuario**: ${userInfo.usuario}\n` +
           `🏢 **Nombre completo**: ${userInfo.nombre} ${userInfo.paterno || ''} ${userInfo.materno || ''}\n\n` +
           `💬 **¿En qué puedo ayudarte hoy?**\n` +
           `Escribe \`ayuda\` para ver todos los comandos disponibles.`;
}

/**
 * Crea mensaje de error de autenticación
 * @param {string} errorMessage - Mensaje de error de la API
 * @returns {string} Mensaje de error formateado
 */
export function createAuthErrorMessage(errorMessage) {
    return `❌ **Error de Autenticación**\n\n` +
           `🔴 ${errorMessage}\n\n` +
           `🔄 **Intenta nuevamente**\n` +
           `Verifica tus credenciales y vuelve a intentar.`;
}

/**
 * Crea mensaje de instrucciones de login por texto
 * @returns {string} Instrucciones
 */
export function createTextLoginInstructions() {
    return '🔐 **Bienvenido a Nova Bot**\n\n' +
           '❌ **Error con la tarjeta**\n\n' +
           '🔄 **Usa el método alternativo:**\n' +
           'Escribe: `login usuario:contraseña`\n\n' +
           'Ejemplo: `login 91004:mipassword`';
}

/**
 * Crea mensaje de formato incorrecto para login por texto
 * @returns {string} Mensaje de error de formato
 */
export function createInvalidFormatMessage() {
    return '❌ **Formato incorrecto**\n\n' +
           '✅ **Formato correcto**: `login usuario:contraseña`\n' +
           '📝 **Ejemplo**: `login 91004:mipassword`';
}

/**
 * Crea mensaje de logout exitoso
 * @returns {string} Mensaje de logout
 */
export function createLogoutMessage() {
    return '👋 **Sesión cerrada**\n\n' +
           'Has cerrado sesión exitosamente.\n\n' +
           'Para volver a usar el bot, inicia sesión nuevamente.';
}
