import express, { type Express } from "express";
import cors from "cors";
import router from "./routes";
import path from "path";
import fs from "fs";

const app: Express = express();

const uploadDir = process.env.UPLOAD_DIR || "./uploads";
if (!fs.existsSync(uploadDir)) {
  fs.mkdirSync(uploadDir, { recursive: true });
}

app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));
app.use("/uploads", express.static(path.resolve(uploadDir)));

app.use("/api", router);

export default app;
