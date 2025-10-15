// dialogBot.js - Versión corregida con importaciones correctas

// OPCIÓN 1: Si usas botbuilder-teams
import { TeamsActivityHandler } from 'botbuilder';

// OPCIÓN 2: Si usas solo botbuilder
// import { ActivityHandler } from 'botbuilder';

/**
 * DialogBot - Clase base simplificada
 */
export default class DialogBot extends TeamsActivityHandler {
    // Si usas OPCIÓN 2, cambia la línea anterior por:
    // export default class DialogBot extends ActivityHandler {
    
    constructor(conversationState, userState) {
        super();

        if (!conversationState) {
            throw new Error('[DialogBot]: conversationState es requerido');
        }
        if (!userState) {
            throw new Error('[DialogBot]: userState es requerido');
        }

        this.conversationState = conversationState;
        this.userState = userState;

        // Configurar manejadores de eventos
        this.onMessage(this.handleMessage.bind(this));
        this.onMembersAdded(this.handleMembersAdded.bind(this));
        
        console.log('DialogBot inicializado correctamente');
    }

    /**
     * Maneja mensajes entrantes
     */
    async handleMessage(context, next) {
        try {
            if (!context || !context.activity) {
                console.warn('DialogBot: Contexto inválido');
                return await next();
            }

            if (!this.isValidActivity(context.activity)) {
                console.warn('DialogBot: Actividad no válida');
                return await next();
            }

        } catch (error) {
            console.error('DialogBot: Error en handleMessage:', error.message);
            await this.handleError(context, error);
        }

        await next();
    }

    /**
     * Valida si una actividad es procesable
     */
    isValidActivity(activity) {
        if (!activity.type || !activity.from || !activity.conversation) {
            return false;
        }

        const supportedTypes = ['message', 'invoke', 'event'];
        if (!supportedTypes.includes(activity.type)) {
            return false;
        }

        if (activity.type === 'message') {
            const hasText = activity.text && activity.text.trim().length > 0;
            const hasValue = activity.value && Object.keys(activity.value).length > 0;
            
            if (!hasText && !hasValue) {
                return false;
            }

            if (activity.text && activity.text.length > 4000) {
                console.warn('DialogBot: Mensaje muy largo');
                return false;
            }
        }

        return true;
    }

    /**
     * Maneja nuevos miembros
     */
    async handleMembersAdded(context, next) {
        try {
            for (const member of context.activity.membersAdded) {
                if (member.id !== context.activity.recipient.id) {
                    if (this.onMemberAdded && typeof this.onMemberAdded === 'function') {
                        await this.onMemberAdded(context, member);
                    }
                }
            }
        } catch (error) {
            console.error('DialogBot: Error en handleMembersAdded:', error.message);
            await this.handleError(context, error);
        }
        
        await next();
    }

    /**
     * Maneja errores
     */
    async handleError(context, error) {
        console.error('DialogBot: Error:', {
            error: error.message,
            activityType: context.activity?.type,
            userId: context.activity?.from?.id
        });

        try {
            const errorMessage = this.getErrorMessage(error);
            await context.sendActivity(errorMessage);
        } catch (handlingError) {
            console.error('DialogBot: Error manejando error:', handlingError.message);
        }
    }

    /**
     * Genera mensaje de error
     */
    getErrorMessage(error) {
        const errorMessage = error.message.toLowerCase();
        
        if (errorMessage.includes('authentication') || errorMessage.includes('unauthorized')) {
            return '🔒 **Error de autenticación**\n\nPor favor, ingresa tus credenciales nuevamente.';
        } else if (errorMessage.includes('timeout')) {
            return '⏰ **Tiempo de espera agotado**\n\nIntenta nuevamente.';
        } else if (errorMessage.includes('network') || errorMessage.includes('connection')) {
            return '🌐 **Error de conexión**\n\nProblemas de conectividad.';
        } else {
            return '❌ **Error inesperado**\n\nIntenta nuevamente.';
        }
    }

    /**
     * Override del método run para guardar estados
     */
    async run(context) {
        try {
            if (!context || !context.activity) {
                throw new Error('Contexto inválido');
            }

            this.ensureBotInContext(context);
            await super.run(context);
            await this.saveStates(context);

        } catch (error) {
            console.error('DialogBot: Error en run:', error.message);
            await this.handleError(context, error);
            throw error;
        }
    }

    /**
     * Asegura contexto del bot
     */
    ensureBotInContext(context) {
        if (!context.turnState.get('bot')) {
            context.turnState.set('bot', this);
        }
        if (!context.turnState.get('ConversationState')) {
            context.turnState.set('ConversationState', this.conversationState);
        }
        if (!context.turnState.get('UserState')) {
            context.turnState.set('UserState', this.userState);
        }
    }

    /**
     * Guarda estados
     */
    async saveStates(context) {
        const savePromises = [];
        
        if (this.conversationState) {
            savePromises.push(
                this.conversationState.saveChanges(context, false)
                    .catch(error => {
                        console.error('Error guardando estado conversación:', error.message);
                    })
            );
        }

        if (this.userState) {
            savePromises.push(
                this.userState.saveChanges(context, false)
                    .catch(error => {
                        console.error('Error guardando estado usuario:', error.message);
                    })
            );
        }

        await Promise.allSettled(savePromises);
    }

    /**
     * Verifica inicialización
     */
    isInitialized() {
        return !!(this.conversationState && this.userState);
    }
}