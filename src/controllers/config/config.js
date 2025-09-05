import * as url from 'url';
import dotenv from 'dotenv';
import { Command } from 'commander';

//Configuracion de comand Line
const commandLine = new Command();
commandLine
    .option('--mode <SECRET>')
    .option('--port <PORT>')
    .option('--setup <APP_NAME>')
commandLine.parse();
const clOptions = commandLine.opts();
dotenv.config()
dotenv.config({ path: clOptions.mode === 'prod' ? '.env.prod' : '.env.devel' });

export const config = {
    KEY: process.env.KEY,
    PORT: process.env.PORT,
    // Directorio base de la aplicación.  Se utiliza para componer rutas relativas.
    DIRNAME: url.fileURLToPath(new URL('../../', import.meta.url)),
    // Directorio donde se almacenarán los logs.  Apunta a la carpeta
    // src/services/pdf/log, que contiene la configuración de winston.
    DIRNAME_LOG: url.fileURLToPath(new URL('../../services/pdf/log', import.meta.url)),
    // Carpeta donde se almacenan temporalmente los archivos PDF/Word cargados.
    get UPLOAD_DIR() { return `${this.DIRNAME}/public/pdf` },
    MODE: process.env.MODE,
    OPENAI_API_KEY: process.env.OPENAI_API_KEY,
    AZURE_KEY: process.env.AZURE_KEY
};