import multer from "multer";
import { cloudinary } from "./cloudinary.config.js";
import { CloudinaryStorage } from 'multer-storage-cloudinary';



const storage = new CloudinaryStorage({
    cloudinary: cloudinary,
    params: {
        folder: 'products',
        format: async (req, file) => 'webp' || 'png',
        public_id: (req, file) => file.originalname,
    },
});

export const uploader = multer({ storage: storage });


