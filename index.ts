import express from "express";
import cors from "cors";
import axios from "axios";
import { createClient } from "redis";
import dotenv from "dotenv";
import rateLimit from "express-rate-limit";

dotenv.config();

const app = express();
const port = 3001;

// Middleware
app.use(cors());
app.use(express.json());

// Rate limiting: 100 request per 15 minutes per IP
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 100,
    message: "To many requests from this IP, please try again later.",
});

app.use(limiter);

// Redis client setup
const redisClient = createClient({
    url: "redis://localhost:6379",
});

redisClient.on("error", (err: any) => console.error("Redis Client Error", err));

(async () => {
    try {
        await redisClient.connect();
    } catch (err) {
        console.error("Failed to connect to Redis:", err);
    }
})();

// API endpoint to fetch images
app.get("/api/images", async (req: any, res: any) => {
    const { query = "nature", page = "1", per_page = "8" } = req.query;
    const cacheKey = `images:${query}-${page}`;

    if (typeof query !== "string" || query.length > 100) {
        return res.status(400).json({ error: "Invalid query parameter" });
    }

    const pageNum = parseInt(page as string, 10);
    const perPageNum = parseInt(per_page as string, 10);

    if (isNaN(pageNum) || pageNum < 1 || isNaN(perPageNum) || perPageNum < 1) {
        return res.status(400).json({ error: "Invalid page or per_page parameter" });
    }

    try {
      // Check cache
      const cachedData = await redisClient.get(cacheKey);

      if (cachedData) {
        return res.json(JSON.parse(cachedData));
      }

      if (!process.env.UNSPLASH_API_KEY) {
        throw new Error("Unsplash API key is not configured");
      }
        // Fetch from Unsplash
        const response = await axios.get(
          "https://api.unsplash.com/search/photos",
          {
            params: {
              query,
              page: pageNum,
              per_page: perPageNum,
              client_id: process.env.UNSPLASH_API_KEY,
            },
          }
        );

      const images = response.data.results.map((photo: any) => ({
        id: photo.id,
        url: photo.urls.regular,
        title: photo.alt_description || `Image ${photo.id}`,
        description: photo.description || `Description for Image ${photo.id}`,
      }));

      // Cache the result for 1 hour
      // Cache the result for 1 hour
      await redisClient.setEx(cacheKey, 3600, JSON.stringify(images));
      res.json(images);
    } catch (error: any) {
        console.error("Error fetching images:", error.message);
        if (axios.isAxiosError(error)) {
            return res.status(error.response?.status || 500).json({
                error: error.response?.data?.error || "Failed to fetch images from Unsplash",
            });
        }
        res.status(500).json({ error: "Internal Server Error" });
    }
});

app.listen(port, () => {
  console.log(`Backend server running on http://localhost:${port}`);
});