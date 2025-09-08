import { Server } from "socket.io";
import { logger } from "../log/logger.js";
import cors from "cors";

export const generalConfigSocket = async (server) => {
    const io = new Server(server, {
        cors: {
            origin: '*'
        }
    }
    )
    const response = ''
    io.on('connect', client => {
        client.emit('data', response);
        client.on('disconnect', () => {
            logger.info(`Cliente desconectado, id ${client.id}`);
        });
    })
    io.on('connect', client => {
        logger.info(`Cliente conectado, id ${client.id} desde ${client.handshake.address}`);
    })
    return io

}