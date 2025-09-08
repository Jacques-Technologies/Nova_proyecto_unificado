// Importa el paquete winston
import winston from 'winston';

// Define las opciones de niveles personalizados
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

// Asigna colores a los niveles
winston.addColors(customLevelsOptions.colors);

// Crea el logger con las opciones personalizadas
const logger = winston.createLogger({
    levels: customLevelsOptions.levels, // Usa los niveles personalizados
    transports: [
        new winston.transports.Console({
            level: 'debug', // El nivel debe coincidir con nuestra nueva configuración
            format: winston.format.combine(
                winston.format.colorize(), // Aplica colorización a la consola
                winston.format.simple()
            )
        }),
        new winston.transports.File({
            filename: './errors.log',
            level: 'warn', // Esta vez es 'warn' según la configuración predeterminada
            format: winston.format.simple()
        })
    ]
});

// Exporta el logger para que pueda ser utilizado en otros archivos
export default logger;

// // Ejemplo de uso
// logger.error('This is an error message');
// logger.warn('This is a warning message');
// logger.info('This is an info message');
// logger.http('This is an HTTP message');
// logger.verbose('This is a verbose message');
// logger.debug('This is a debug message');