import express from "express";
import cors from "cors";
import dotenv from "dotenv";
import { config } from "./controllers/config/config.js";
import { logger } from "./services/pdf/log/logger.js";
import { pdfRoutes } from "./routes/pdf.routes.js";
import { wordRoutes } from "./routes/wordRoutes.routes.js";
import { generalConfigSocket } from "./services/pdf/socket.io/global.socket.js";

// Cargar variables de entorno
dotenv.config();

/* Bot Framework imports.  The bot logic (TeamsBot) se mantiene en el proyecto
   Nova-main.  Se importa dinámicamente utilizando import para soportar CommonJS.
   Al importar un módulo CommonJS con la sintaxis ES Module, el contenido
   disponible se expone en la propiedad `default`.  Se extrae TeamsBot de dicho
   objeto más adelante. */
import botbuilder from "botbuilder";
// Importar las implementaciones de los bots desde la carpeta unificada.  El
// TeamsBot se encuentra en ../bots/teamsBot.js y el WebBot en ../bots/webBot.js
import TeamsBotModule from "./bots/teamsBot.js";
import WebBotModule from "./bots/webBot.js";

// Desestructurar componentes de botbuilder.  Importar desde el paquete completo
// simplifica la interoperabilidad entre CommonJS y ES Modules.
const {
    CloudAdapter,
    ConfigurationBotFrameworkAuthentication,
    MemoryStorage,
    ConversationState,
    UserState
} = botbuilder;

// Extraer las clases TeamsBot y WebBot de los módulos importados.  Si los
// módulos provienen de CommonJS, el objeto exportado estará en la propiedad
// `default`.
const TeamsBotExport = TeamsBotModule.default || TeamsBotModule;
const { TeamsBot } = TeamsBotExport;

const WebBotExport = WebBotModule.default || WebBotModule;
const { WebBot } = WebBotExport;

let socketServer;

// Crear instancia de la aplicación Express.
const app = express();

// Configurar middlewares globales.
app.use(cors({ origin: "*" }));
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Montar las rutas de procesamiento de archivos directamente en la raíz.
// Esto permite que los endpoints sean /sendPdf y /sendWord tal como se solicitó.
app.use("/", pdfRoutes);
app.use("/", wordRoutes);

// Endpoint raíz – simple respuesta indicando que el servidor está activo.
app.get("/", (req, res) => {
    res.status(200).send("Servidor unificado activo");
});

// Endpoint de salud – responde con un estado básico.
app.get("/health", (req, res) => {
    res.status(200).json({ status: "OK" });
});

// Configurar autenticación para Bot Framework.  Las credenciales deben estar
// definidas como variables de entorno.  Si MicrosoftAppType no se define, se
// utiliza SingleTenant por defecto, acorde a las recomendaciones de Azure.
const botFrameworkAuthentication = new ConfigurationBotFrameworkAuthentication({
    MicrosoftAppId: process.env.MicrosoftAppId,
    MicrosoftAppPassword: process.env.MicrosoftAppPassword,
    MicrosoftAppType: process.env.MicrosoftAppType || "SingleTenant",
    MicrosoftAppTenantId: process.env.MicrosoftAppTenantId
});

// Instanciar el adaptador para el bot.  Utilizamos un único adaptador para
// ambos bots (Teams y Web), ya que gestionan canales HTTP similares.
const adapter = new CloudAdapter(botFrameworkAuthentication);

// Crear instancias de almacenamiento y estados separados para Teams y Web,
// de modo que cada bot gestione su propio historial y contexto.
// --- Teams Bot ---
const storageTeams = new MemoryStorage();
const conversationStateTeams = new ConversationState(storageTeams);
const userStateTeams = new UserState(storageTeams);
const teamsBot = new TeamsBot(conversationStateTeams, userStateTeams);

// --- Web Bot ---
const storageWeb = new MemoryStorage();
const conversationStateWeb = new ConversationState(storageWeb);
const userStateWeb = new UserState(storageWeb);
const webBot = new WebBot(conversationStateWeb, userStateWeb);

// Endpoint para mensajes del bot en Teams.  Este utiliza el adaptador de Bot
// Framework para procesar la actividad y ejecutar el bot.
app.post("/api/messages/teams", async (req, res) => {
    await adapter.process(req, res, (context) => teamsBot.run(context));
});

// Endpoint para mensajes del bot vía web.  Por ahora utiliza la misma lógica
// que TeamsBot; se expone como alternativa para clientes web.
app.post("/api/messages/web", async (req, res) => {
    await adapter.process(req, res, (context) => webBot.run(context));
});

// Endpoint genérico para mensajes del bot.  Si no se especifica el tipo de canal,
// este endpoint procesará la actividad con la misma instancia de TeamsBot.  En
// proyectos futuros se podría inspeccionar `context.activity.channelId` para
// seleccionar el bot adecuado.
app.post("/api/messages", async (req, res) => {
    await adapter.process(req, res, (context) => teamsBot.run(context));
});

// Iniciar servidor HTTP y configuración de socket.io.
const httpServer = app.listen(config.PORT, async () => {
    // Configurar socket.io para permitir notificaciones en tiempo real si fuese
    // necesario.  El método generalConfigSocket inicializa una instancia de
    // socket.io sobre el servidor HTTP.
    socketServer = generalConfigSocket(httpServer);
    app.set("socketServer", socketServer);

    // Registrar en log que el servidor está listo.
    logger.info(
        `Servidor activo en puerto ${config.PORT} en modo ${config.MODE} (PID ${process.pid})`
    );
});

export { socketServer };