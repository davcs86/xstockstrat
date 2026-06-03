import { startMockBackend } from './mock-backend';

export default async function globalSetup() {
  await startMockBackend();
}
