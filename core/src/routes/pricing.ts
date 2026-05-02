import { Router, type Request, type Response } from "express";
import { errorMessage } from "../utils/error.js";
import {
  DEFAULT_MODEL,
  getActivePricing,
} from "../services/pricingService.js";

const router = Router();

router.get("/", (_req: Request, res: Response) => {
  try {
    res.json({ defaultModel: DEFAULT_MODEL, pricing: getActivePricing() });
  } catch (err) {
    res.status(500).json({ error: errorMessage(err) });
  }
});

export default router;
