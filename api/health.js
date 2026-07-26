import 'dotenv/config';
import { healthPayload } from '../backend/pipeline.js';

/** GET /api/health — lets the UI warn when no API key is configured. */
export default function handler(req, res) {
  res.status(200).json(healthPayload());
}
