import multer from "multer";
import { cloudinary } from "./cloudinary.config.js";
import { CloudinaryStorage } from 'multer-storage-cloudinary';


const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: async (req, file) => {
        const userId = req.params.uid || 'default';
        return {
            folder: `documents/${userId}`,
            resource_type: 'raw',
            public_id: file.originalname,
        };
    }
});



// const storage = new CloudinaryStorage({
//     cloudinary: cloudinary,
//     params: async (req, file) => {
//         const userId = req.params ? req.params.uid : 'Default';
//         return {
//             folder: `documents_user${userId}`,
//             format: 'raw',
//             public_id: file.originalname,
//         }
//     },
// });

export const uploader = multer({ storage: storage });


