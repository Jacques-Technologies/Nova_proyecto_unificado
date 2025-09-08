// logoutDialog.js - Versión simplificada sin OAuth
// Este archivo es opcional ya que el logout ahora se maneja directamente en TeamsBot

const { ComponentDialog } = require('botbuilder-dialogs');

/**
 * LogoutDialog - Versión simplificada 
 * Ya no se usa para OAuth, el logout se maneja en TeamsBot
 */
class LogoutDialog extends ComponentDialog {
    constructor(id) {
        super(id || 'LogoutDialog');
        
        console.log('✅ LogoutDialog simplificado inicializado');
        console.log('ℹ️ El logout ahora se maneja directamente en TeamsBot');
    }

    /**
     * Método heredado para compatibilidad
     */
    async onBeginDialog(innerDc, options) {
        console.log('LogoutDialog.onBeginDialog - Ya no se requiere para logout');
        return await super.onBeginDialog(innerDc, options);
    }

    /**
     * Método heredado para compatibilidad
     */
    async onContinueDialog(innerDc) {
        console.log('LogoutDialog.onContinueDialog - Ya no se requiere para logout');
        return await super.onContinueDialog(innerDc);
    }
}

module.exports.LogoutDialog = LogoutDialog;