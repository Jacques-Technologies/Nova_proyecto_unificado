import multer from "multer";
import { config } from "../../controllers/config/config.js";

const diskStorage = multer.diskStorage({
    destination: (req, file, cb) => {
        cb(null, config.UPLOAD_DIR);
    },
    filename: (req, file, cb) => {
        cb(null, file.originalname)
    }
})
const storage = multer.memoryStorage();
export const upload = multer({ storage: storage, limits: { fileSize: 30 * 1024 * 1024 } }); // Límite de 30 MB
export const uploadToDisk = multer({
    storage: diskStorage,
    limits: { fileSize: 30 * 1024 * 1024 } // Límite de 30 MB
});
