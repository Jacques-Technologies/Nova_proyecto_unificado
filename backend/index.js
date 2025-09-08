import express from "express";
import { config } from "./controllers/config/config.js";
import { logger } from "./services/log/logger.js";
import { pdfRoutes } from "./routes/pdf.routes.js";
import { generalConfigSocket } from "./services/socket.io/global.socket.js";
import { wordRoutes } from "./routes/wordRoutes.routes.js";
import cors from "cors";
let socketServer;

const app = express();

const httpServer = app.listen(config.PORT, async () => {
    socketServer = generalConfigSocket(httpServer);
    app.set('socketServer', socketServer)
    app.use(cors({ origin: '*' }));
    app.use(express.json());
    app.use(express.urlencoded({ extended: true }));

    //Get
    app.use('/api', pdfRoutes);
    app.use('/api', wordRoutes);
    // app.use('/api', embeding);


    logger.info(`Servidor activo en puerto ${config.PORT} en mode ${config.MODE} (PID ${process.pid})`);
})

export { socketServer }