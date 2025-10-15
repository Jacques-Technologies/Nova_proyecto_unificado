import winston from 'winston';
import { config } from '../../controllers/config/config.js';
import fs from 'fs';
import path from 'path';

// Crear directorio de logs si no existe
if (config.DIRNAME_LOG) {
    try {
        fs.mkdirSync(config.DIRNAME_LOG, { recursive: true });
    } catch (err) {
        console.warn('⚠️ No se pudo crear directorio de logs:', err.message);
    }
}

const customLevelsOptions = {
    levels: {
        error: 0,
        warn: 1,
        info: 2,
        http: 3,
        verbose: 4,
        debug: 5
    },
    colors: {
        error: 'red',
        warn: 'yellow',
        info: 'green',
        http: 'magenta',
        verbose: 'cyan',
        debug: 'blue'
    }
};
const devLogger = winston.createLogger({
    levels: customLevelsOptions.levels,
    transports: [
        new winston.transports.Console({
            level: 'debug',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        })
    ]
});

// Configurar file transport solo si el directorio existe
const transports = [
    new winston.transports.Console({
        level: 'debug',
        format: winston.format.combine(
            winston.format.colorize(),
            winston.format.simple()
        )
    })
];

// Intentar agregar file transport solo si el directorio fue creado exitosamente
if (config.DIRNAME_LOG && fs.existsSync(config.DIRNAME_LOG)) {
    try {
        transports.push(new winston.transports.File({
            level: 'info',
            filename: `${config.DIRNAME_LOG}/errors.log`,
            format: winston.format.simple()
        }));
        console.log('✅ File logger habilitado');
    } catch (err) {
        console.warn('⚠️ File logger deshabilitado:', err.message);
    }
} else {
    console.warn('⚠️ Directorio de logs no disponible - solo console logging');
}

const prodLogger = winston.createLogger({
    levels: customLevelsOptions.levels,
    transports: transports
});

const addLogger = (req, res, next) => {
    // req.logger = devLogger;
    req.logger = config.MODE === 'dev' ? devLogger : prodLogger;
    // req.logger.info(`${new Date().toDateString()} ${req.method} ${req.url}`);
    next();
}

export const logger = config.MODE === 'dev' ? devLogger : prodLogger;

export default addLogger;
