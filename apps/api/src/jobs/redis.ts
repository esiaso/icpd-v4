import IORedis from 'ioredis';
import { config } from '../common/config';

let shared: IORedis | null = null;

/** BullMQ needs maxRetriesPerRequest = null on its connections. */
export function redisConnection(): IORedis {
  if (!shared) shared = new IORedis(config.redisUrl, { maxRetriesPerRequest: null });
  return shared;
}
