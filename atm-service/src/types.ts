export type BoundingBox = {
  north: number;
  south: number;
  east: number;
  west: number;
};

export type BatchDescriptor = {
  batchId: string;
  deviceId?: string;
  startTime: string;
  endTime: string;
  bbox: BoundingBox;
};

export type StoredBatchMetadata = BatchDescriptor & {
  hash: string;
  updatedAt: string;
  path: string;
};

export type Pm25Point = {
  lat: number;
  lon: number;
  value: number;
};

export type ProcessedBatch = StoredBatchMetadata & {
  points: Pm25Point[];
};
