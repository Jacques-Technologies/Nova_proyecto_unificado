// diagnostic/cardDiagnostic.js - Herramienta para diagnosticar problemas con tarjetas

const { CardFactory } = require('botbuilder');

/**
 * Clase para diagnosticar problemas con tarjetas adaptativas
 */
class CardDiagnostic {
    
    /**
     * Crea una tarjeta de prueba simple
     */
    static createSimpleTestCard() {
        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.0', // Versión más básica
            body: [
                {
                    type: 'TextBlock',
                    text: 'Prueba de Tarjeta Simple',
                    weight: 'Bolder'
                },
                {
                    type: 'TextBlock',
                    text: 'Si ves esto, las tarjetas básicas funcionan.',
                    wrap: true
                }
            ]
        };

        return CardFactory.adaptiveCard(card);
    }

    /**
     * Crea una tarjeta de prueba con inputs
     */
    static createInputTestCard() {
        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.0',
            body: [
                {
                    type: 'TextBlock',
                    text: 'Prueba de Inputs',
                    weight: 'Bolder'
                },
                {
                    type: 'Input.Text',
                    id: 'testInput',
                    placeholder: 'Escribe algo aquí'
                }
            ],
            actions: [
                {
                    type: 'Action.Submit',
                    title: 'Enviar Prueba',
                    data: {
                        action: 'test'
                    }
                }
            ]
        };

        return CardFactory.adaptiveCard(card);
    }

    /**
     * Crea la tarjeta de login optimizada para compatibilidad
     */
    static createCompatibleLoginCard() {
        const card = {
            type: 'AdaptiveCard',
            $schema: 'http://adaptivecards.io/schemas/adaptive-card.json',
            version: '1.0', // Versión más compatible
            body: [
                {
                    type: 'TextBlock',
                    text: 'Iniciar Sesión',
                    size: 'Medium',
                    weight: 'Bolder'
                },
                {
                    type: 'TextBlock',
                    text: 'Usuario:',
                    weight: 'Bolder'
                },
                {
                    type: 'Input.Text',
                    id: 'username',
                    placeholder: 'Ingresa tu usuario'
                },
                {
                    type: 'TextBlock',
                    text: 'Contraseña:',
                    weight: 'Bolder'
                },
                {
                    type: 'Input.Text',
                    id: 'password',
                    placeholder: 'Ingresa tu contraseña',
                    style: 'Password'
                }
            ],
            actions: [
                {
                    type: 'Action.Submit',
                    title: 'Iniciar Sesión',
                    data: {
                        action: 'login'
                    }
                }
            ]
        };

        return CardFactory.adaptiveCard(card);
    }

    /**
     * Valida una tarjeta adaptativa
     */
    static validateCard(cardJson) {
        const errors = [];
        const warnings = [];

        try {
            // Verificar estructura básica
            if (!cardJson.type || cardJson.type !== 'AdaptiveCard') {
                errors.push('Tipo de tarjeta inválido o faltante');
            }

            if (!cardJson.version) {
                errors.push('Versión de tarjeta faltante');
            } else {
                const version = parseFloat(cardJson.version);
                if (version > 1.5) {
                    warnings.push(`Versión ${cardJson.version} puede no ser compatible con todos los clientes`);
                }
            }

            if (!cardJson.body || !Array.isArray(cardJson.body)) {
                errors.push('Body de tarjeta inválido o faltante');
            }

            // Verificar elementos del body
            if (cardJson.body) {
                cardJson.body.forEach((element, index) => {
                    if (!element.type) {
                        errors.push(`Elemento ${index}: tipo faltante`);
                    }

                    // Verificar elementos problemáticos
                    if (element.horizontalAlignment) {
                        warnings.push(`Elemento ${index}: horizontalAlignment puede causar problemas de compatibilidad`);
                    }

                    if (element.color && !['Default', 'Dark', 'Light', 'Accent', 'Good', 'Warning', 'Attention'].includes(element.color)) {
                        warnings.push(`Elemento ${index}: color personalizado puede no ser compatible`);
                    }
                });
            }

            // Verificar acciones
            if (cardJson.actions) {
                cardJson.actions.forEach((action, index) => {
                    if (!action.type) {
                        errors.push(`Acción ${index}: tipo faltante`);
                    }

                    if (action.style && !['default', 'positive', 'destructive'].includes(action.style)) {
                        warnings.push(`Acción ${index}: style personalizado puede no ser compatible`);
                    }
                });
            }

            return {
                isValid: errors.length === 0,
                errors,
                warnings
            };

        } catch (error) {
            return {
                isValid: false,
                errors: [`Error de validación: ${error.message}`],
                warnings: []
            };
        }
    }

    /**
     * Ejecuta diagnóstico completo
     */
    static async runDiagnostic(context) {
        const results = {
            timestamp: new Date().toISOString(),
            tests: {}
        };

        try {
            // Test 1: Tarjeta simple
            console.log('🧪 Test 1: Enviando tarjeta simple...');
            await context.sendActivity('🧪 **Test 1**: Tarjeta simple');
            await context.sendActivity({ attachments: [this.createSimpleTestCard()] });
            results.tests.simpleCard = 'sent';

            // Test 2: Tarjeta con inputs
            console.log('🧪 Test 2: Enviando tarjeta con inputs...');
            await context.sendActivity('🧪 **Test 2**: Tarjeta con inputs');
            await context.sendActivity({ attachments: [this.createInputTestCard()] });
            results.tests.inputCard = 'sent';

            // Test 3: Tarjeta de login compatible
            console.log('🧪 Test 3: Enviando tarjeta de login compatible...');
            await context.sendActivity('🧪 **Test 3**: Tarjeta de login compatible');
            await context.sendActivity({ attachments: [this.createCompatibleLoginCard()] });
            results.tests.loginCard = 'sent';

            // Información del entorno
            results.environment = {
                botFrameworkVersion: require('botbuilder/package.json').version,
                nodeVersion: process.version,
                platform: process.platform
            };

            console.log('✅ Diagnóstico completado:', results);
            
            await context.sendActivity(
                '📊 **Diagnóstico completado**\n\n' +
                '🧪 Se enviaron 3 tarjetas de prueba.\n' +
                '✅ Si ves las tarjetas arriba, el problema es específico de la tarjeta de login.\n' +
                '❌ Si no ves ninguna tarjeta, hay un problema general con las Adaptive Cards.\n\n' +
                '**Información del entorno:**\n' +
                `• Bot Framework: ${results.environment.botFrameworkVersion}\n` +
                `• Node.js: ${results.environment.nodeVersion}\n` +
                `• Plataforma: ${results.environment.platform}`
            );

            return results;

        } catch (error) {
            console.error('❌ Error en diagnóstico:', error);
            results.error = error.message;
            
            await context.sendActivity(
                '❌ **Error en diagnóstico**\n\n' +
                `Error: ${error.message}\n\n` +
                'Esto indica un problema fundamental con las tarjetas adaptativas.'
            );
            
            return results;
        }
    }

    /**
     * Información sobre compatibilidad de Teams
     */
    static getTeamsCompatibilityInfo() {
        return {
            supportedVersions: {
                '1.0': 'Totalmente compatible',
                '1.1': 'Compatible con Teams moderno',
                '1.2': 'Compatible con Teams reciente',
                '1.3': 'Puede tener problemas en Teams antiguos',
                '1.4+': 'Problemas de compatibilidad esperados'
            },
            commonIssues: [
                'horizontalAlignment no soportado en todas las versiones',
                'style en acciones puede fallar',
                'Colores personalizados no siempre funcionan',
                'Elementos de contenedor avanzados pueden fallar',
                'Esquemas HTTPS vs HTTP pueden causar problemas'
            ],
            recommendations: [
                'Usar versión 1.0 o 1.1 para máxima compatibilidad',
                'Evitar propiedades de estilo avanzadas',
                'Probar en Teams Desktop y Web',
                'Verificar que el esquema sea correcto',
                'Usar fallbacks para funcionalidad crítica'
            ]
        };
    }
}

/**
 * Función helper para agregar comando de diagnóstico al bot
 */
function addDiagnosticCommand(bot) {
    const originalHandleMessage = bot.handleMessageWithAuth;
    
    bot.handleMessageWithAuth = async function(context, next) {
        const text = (context.activity.text || '').trim().toLowerCase();
        
        if (text === 'diagnostic' || text === 'diagnostico') {
            const userId = context.activity.from.id;
            console.log(`[${userId}] Ejecutando diagnóstico de tarjetas...`);
            
            await CardDiagnostic.runDiagnostic(context);
            return await next();
        }
        
        return await originalHandleMessage.call(this, context, next);
    };
}

module.exports = {
    CardDiagnostic,
    addDiagnosticCommand
};