import 'reflect-metadata';
import { createApp } from './bootstrap';
import { config } from './common/config';

process.env.TZ = 'UTC'; // store and compute in UTC; Nairobi only for "today"/CPD year helpers

async function main() {
  const app = await createApp();
  app.enableShutdownHooks();
  await app.listen(config.port);
  console.log(`ICPD API on ${config.apiUrl}/api (docs: /api/docs)`);
}
main();
