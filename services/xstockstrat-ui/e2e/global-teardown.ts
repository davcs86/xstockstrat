import { stopMockBackend } from './mock-backend';

export default async function globalTeardown() {
  await stopMockBackend();
}
