// import multer from "multer";
// import { config } from "../../controllers/config/config.js";

// const storge = multer.diskStorage({
//     destination: (req, file, cb) => {
//         cb(null, config.UPLOAD_DIR);
//     },
//     filename: (req, file, cb) => {
//         cb(null, file.originalname)
//     }
// })

// export const uploaderDoc = multer({ storage: storge })