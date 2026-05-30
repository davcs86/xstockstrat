import { dispatchConnect } from '@/app/lib/connectBff';

export const dynamic = 'force-dynamic';

export const GET = (req: Request) => dispatchConnect(req);
export const POST = (req: Request) => dispatchConnect(req);
