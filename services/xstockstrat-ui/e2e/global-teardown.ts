import { stopMockBackend } from './mock-backend';
import { stopStubIdp } from './helpers/stubIdp';

export default async function globalTeardown() {
  await Promise.all([stopMockBackend(), stopStubIdp()]);
}
