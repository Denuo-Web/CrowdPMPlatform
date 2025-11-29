import type { IngestSmokeTestResponse } from "../lib/api";

export type SmokeHistoryItem = {
  id: string;
  createdAt: number;
  deviceIds: string[];
  response: IngestSmokeTestResponse;
};
