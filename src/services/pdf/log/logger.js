import winston from 'winston';
import { config } from '../../controllers/config/config.js';

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

const prodLogger = winston.createLogger({
    levels: customLevelsOptions.levels,
    transports: [
        new winston.transports.Console({
            level: 'debug',
            format: winston.format.combine(
                winston.format.colorize(),
                winston.format.simple()
            )
        }),
        new winston.transports.File({
            level: 'info',
            filename: `${config.DIRNAME_LOG}/errors.log`,
            format: winston.format.simple()
        })
    ]
});

const addLogger = (req, res, next) => {
    // req.logger = devLogger;
    req.logger = config.MODE === 'dev' ? devLogger : prodLogger;
    // req.logger.info(`${new Date().toDateString()} ${req.method} ${req.url}`);
    next();
}

export const logger = config.MODE === 'dev' ? devLogger : prodLogger;

export default addLogger;
