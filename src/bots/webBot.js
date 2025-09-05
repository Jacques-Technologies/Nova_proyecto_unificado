// src/bots/webBot.js - Versión web del bot
//
// La versión web del bot reutiliza todas las funcionalidades del TeamsBot.
// Al extender TeamsBot no se requiere duplicar la lógica de autenticación,
// manejo de mensajes ni comandos.  Esto asegura que la experiencia sea
// idéntica para usuarios web y Teams.

const { TeamsBot } = require('./teamsBot');

class WebBot extends TeamsBot {}

module.exports = {
  WebBot
};