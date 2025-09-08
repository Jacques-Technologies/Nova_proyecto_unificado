// mainDialog.js - Versión simplificada sin OAuth
// Este archivo es opcional ya que el login ahora se maneja directamente en TeamsBot

import ComponentDialog from 'botbuilder-dialogs';

/**
 * MainDialog - Versión simplificada para futuros diálogos personalizados
 * Ya no se usa para autenticación OAuth
 */
export default class MainDialog extends ComponentDialog {
    constructor() {
        super('MainDialog');
        
        console.log('✅ MainDialog simplificado inicializado');
        console.log('ℹ️ La autenticación ahora se maneja directamente en TeamsBot');
    }

    /**
     * Método run básico para compatibilidad
     */
    async run(context, accessor) {
        console.log('MainDialog.run - Método llamado pero no se requiere para login');
        // Este método ya no es necesario para el login
        // Se mantiene para compatibilidad con código existente
    }
}

module.exports.MainDialog = MainDialog;